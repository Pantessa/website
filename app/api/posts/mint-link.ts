import { NextRequest } from 'next/server'
import { POST as mintIntentLink } from '@/app/api/intent-links/route'
import { attachLink } from '@/lib/chart-posts'

// Mint a post's primary action as an intent link THROUGH THE EXISTING DOOR.
// The /api/intent-links handler is called in-process with a request that
// carries the caller's own headers (cookie → the same SIWE session via
// next/headers, the internal-run stamp, the platform IP), so every rule that
// door enforces — plan cap, brand denylist on bylines, content-origin fence,
// is_internal stamping, creator attribution — applies to a post's link
// exactly as to a studio mint. Nothing here re-implements minting; a refusal
// from that door is returned by name and the post survives without a link.

export type MintResult = { ok: true; slug: string; url: string } | { ok: false; error: string; status: number }

export async function mintPostLink(req: NextRequest, postId: string, ask: string): Promise<MintResult> {
  const headers = new Headers()
  for (const name of ['cookie', 'authorization', 'x-yf-internal-run', 'x-forwarded-for', 'x-real-ip']) {
    const v = req.headers.get(name)
    if (v) headers.set(name, v)
  }
  headers.set('content-type', 'application/json')
  const inner = new NextRequest(new URL('/api/intent-links', req.url), { method: 'POST', headers, body: JSON.stringify({ ask }) })
  try {
    const res = await mintIntentLink(inner)
    const data = (await res.json().catch(() => ({}))) as { slug?: string; url?: string; error?: string }
    if (!res.ok || !data.slug) return { ok: false, error: data.error ?? `Could not mint the link (${res.status}).`, status: res.status || 500 }
    await attachLink(postId, data.slug)
    return { ok: true, slug: data.slug, url: data.url ?? `/i/${data.slug}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not mint the link.', status: 500 }
  }
}
