import { NextRequest, NextResponse } from 'next/server'
import { parseWalletSendBody } from '@/lib/wallet-send'
import { buildTransferArtifact } from '@/lib/transfer-exec'
import { bumpAndCheckWalletSend, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/wallet/send — the Wallet panel's Send door.
//
//   { from, chainId, token, amount | 'all', to }  →
//   200 { summary, note, guardrails, blocked, refusal?, tx?, buildPath }
//   422 { problem, field? }                         (nothing buildable)
//   429 { problem }                                 (the hourly IP fence)
//
// The SAME guarded transfer the chat builds for "send 5 USDC on base to
// 0x…" (lib/transfer-exec): calldata encoded here, re-decoded by an
// independent guard, the live balance read before offering, the spend
// policy gated at TRANSFER_POLICY_HOST. A blocked build still returns 200
// with `blocked: true` and no `tx` — the panel shows the failed check by
// name (and the policy fix-it when that is the check) instead of a dead
// end.
//
// Connect-to-act (#553): no SIWE. `from` is client-named, and that is fine
// here — the artifact is a transfer OUT of `from`, signable only by the
// wallet that holds `from`'s key; a stranger naming someone else's address
// gets a tx they cannot sign and a balance they cannot spend. What the
// route must NOT do is anything with a side effect keyed on `from` — it
// doesn't: the one write (a blocked-policy ledger note inside the builder)
// is the same one the chat lane makes. The IP fence caps the RPC cost of
// a loop.

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ problem: 'Send a JSON body.' }, { status: 400 })
  }
  const parsed = parseWalletSendBody(body)
  if ('problem' in parsed) return NextResponse.json(parsed, { status: 422 })

  if (await bumpAndCheckWalletSend(clientIpFrom(req.headers))) {
    return NextResponse.json({ problem: 'That is a lot of sends to review in one hour from this connection — it reopens within the hour.' }, { status: 429 })
  }

  try {
    const built = await buildTransferArtifact(parsed.segment, parsed.from)
    if ('problem' in built) return NextResponse.json({ problem: built.problem }, { status: 422 })
    if (built.blocked) {
      return NextResponse.json({
        summary: built.summary,
        note: built.note,
        guardrails: built.guardrails,
        blocked: true,
        refusal: built.refusal ?? 'A safety check failed — nothing was built.',
        buildPath: 'native-transfer',
      })
    }
    return NextResponse.json({
      summary: built.summary,
      note: built.note,
      guardrails: built.guardrails,
      blocked: false,
      tx: built.tx,
      buildPath: 'native-transfer',
    })
  } catch (e) {
    console.warn('[wallet/send] build failed:', (e as Error).message?.slice(0, 200))
    return NextResponse.json({ problem: `Couldn't build the transfer: ${(e as Error).message}` }, { status: 422 })
  }
}
