import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import {
  assertRosterOpen,
  bumpAndCheckRosterPost,
  clientIpFrom,
  inboxDeclineConsentMessage,
  ROSTER_RATE_WALL,
  verifyRosterConsent,
} from '@/lib/roster-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The DECLINE verb (FIRST-HIRE sprint, premortem find #2): before this, an
// ignored inbox card blocked its manager FOREVER — the one-card-at-a-time
// stacking fence saw the undecided proposal and never proposed again.
// Declining closes the loop: the card leaves the inbox, the bound broker
// intent reads `declined` (the sender hears "no", not silence), and the
// stacking fence frees. DECLINES NEVER BENCH — the ideation judges' rule:
// a decline is a signal, not an offense.
//
// Auth (the lighter door per the sprint contract, both safe):
//   • SIWE session matching the recipient → one step, no popup.
//   • Otherwise a STATELESS personal_sign consent over {slug, wallet} —
//     idempotent + single-object + value-free, so replay is harmless; this
//     keeps declining open to connect-to-act recipients who never SIWE'd.
// An unauthenticated decline is REFUSED: /api/inbox is public by address,
// so slugs are readable — an open decline verb would let anyone clear a
// stranger's inbox (griefing the product loop, not stealing money).
//
// Exempt from the kill switch (like fire/unlist): saying NO never walls.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(req: NextRequest) {
  assertRosterOpen('decline') // no-op by contract — kept so the contract is visible here
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }
  let body: { slug?: unknown; wallet?: unknown; signature?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
  if (!slug || !WALLET_RE.test(wallet)) return NextResponse.json({ error: 'slug and wallet are required.' }, { status: 400 })
  const w = wallet.toLowerCase()

  const link = await prisma.intentLink.findUnique({ where: { id: slug } }).catch(() => null)
  if (!link) return NextResponse.json({ error: 'No such card.' }, { status: 404 })
  if ((link.recipient ?? '').toLowerCase() !== w) {
    return NextResponse.json({ error: 'Only the card\'s recipient can decline it.' }, { status: 403 })
  }
  if (link.revoked) return NextResponse.json({ declined: true, say: 'Already gone from your inbox.' })

  // ── Auth: session owner, or the stateless consent signature ─────────────
  const session = await getAuthAddress(req).catch(() => null)
  if (session?.toLowerCase() !== w) {
    if (body.signature == null) {
      return NextResponse.json(
        {
          error: 'Sign the decline consent (or sign in as the recipient).',
          consentText: inboxDeclineConsentMessage(slug, w),
        },
        { status: 401 },
      )
    }
    try {
      await verifyRosterConsent(inboxDeclineConsentMessage(slug, w), w, body.signature)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 401 })
    }
  }

  // ── The decline: card leaves the inbox; the sender hears "no". ─────────
  await prisma.intentLink.update({ where: { id: slug }, data: { revoked: true } })
  await prisma.brokerIntent
    .updateMany({ where: { linkSlug: slug, state: { in: ['open', 'handed_off'] } }, data: { state: 'declined' } })
    .catch(() => {})
  // DELIBERATELY NO SLOT WRITE: declines never bench (the judges' rule) —
  // the stacking fence frees because the card left the inbox, nothing more.
  return NextResponse.json({
    declined: true,
    say: 'Declined — the card left your inbox and the sender sees "declined", not silence. The agent is not penalized; it may propose differently next period.',
  })
}
