// lib/decline-client.ts — the Decline flow, client half (doors run).
//
// QA proved both server paths on /api/roster/decline; this is the missing
// UI's ONE shared driver (inbox card + /i runtime): try the light door
// first (a SIWE session declines in one POST), and when the server answers
// 401 + consentText, personal_sign the EXACT bytes it returned and retry —
// the client never composes consent text (CONTRACTS v1 discipline).
// Throws with the server's own words so every surface shows the same
// refusal verbatim.

export async function declineCard(
  slug: string,
  wallet: string,
  signMessageAsync: (args: { message: string }) => Promise<string>,
): Promise<string> {
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/roster/decline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, data: (await res.json()) as { declined?: boolean; say?: string; consentText?: string; error?: string } }
  }
  const first = await post({ slug, wallet })
  if (first.data.declined) return first.data.say ?? 'Declined.'
  if (first.status === 401 && first.data.consentText) {
    const signature = await signMessageAsync({ message: first.data.consentText })
    const second = await post({ slug, wallet, signature })
    if (second.data.declined) return second.data.say ?? 'Declined.'
    throw new Error(second.data.error ?? 'Decline failed.')
  }
  throw new Error(first.data.error ?? 'Decline failed.')
}
