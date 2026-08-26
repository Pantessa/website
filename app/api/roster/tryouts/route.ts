import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { isInternalRun } from '@/lib/internal-run'
import { cleanCapUsd } from '@/lib/roster'
import { cleanAgentKeyHash } from '@/lib/roster-client'
import { assertRosterOpen, bumpAndCheckRosterPost, clientIpFrom, ROSTER_RATE_WALL } from '@/lib/roster-policy'
import { captureReview, createTryout, fileMark } from '@/lib/roster-tryouts-exec'
import { PAPER_LABEL, tryoutReportCard, type TryoutCardMark, type TryoutQuote } from '@/lib/roster-tryouts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// M6 forward-paper tryouts (ROSTER-TRYOUTS-SPEC §1). PAPER IS STRUCTURAL:
// this surface reads/writes roster_tryouts + roster_tryout_marks and
// NOTHING else — no links, no intents, no inbox, no records. Every read
// carries the verbatim PAPER label.
//
// POST { wallet, agentKeyHash, mandate, capUsd? }         → create (flag-gated)
// POST { tryoutId, ask }                                  → file a paper mark
// GET  ?wallet=0x… | ?agent=<hash>                        → list + report cards;
//   the first read at ≥ review_at lazily captures the review (write-once,
//   the DCA due-detection pattern — no cron).

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export async function POST(req: NextRequest) {
  try {
    assertRosterOpen('create')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }
  let body: { wallet?: unknown; agentKeyHash?: unknown; mandate?: unknown; capUsd?: unknown; tryoutId?: unknown; ask?: unknown; internalRun?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const internal = isInternalRun(req.headers, body)

  // ── File a mark ──────────────────────────────────────────────────────────
  if (typeof body.tryoutId === 'string') {
    try {
      const mark = await fileMark(body.tryoutId, typeof body.ask === 'string' ? body.ask : '', internal)
      return NextResponse.json({
        paper: PAPER_LABEL,
        mark: { id: mark.id, seq: mark.seq, askText: mark.askText, venue: mark.venue, quoteAtPropose: mark.quoteAtPropose, periodKey: mark.periodKey },
        ...(internal ? { internal: true } : {}),
      })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  // ── Create a tryout ──────────────────────────────────────────────────────
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim().toLowerCase() : ''
  if (!WALLET_RE.test(wallet)) return NextResponse.json({ error: 'Bad wallet.' }, { status: 400 })
  const agentKeyHash = cleanAgentKeyHash(body.agentKeyHash)
  if (!agentKeyHash) return NextResponse.json({ error: "agentKeyHash must be the agent's public 16-hex handle — never its raw key." }, { status: 400 })
  const cap = cleanCapUsd(body.capUsd)
  if (typeof cap === 'object') return NextResponse.json({ error: cap.problem }, { status: 400 })
  const mandate = typeof body.mandate === 'string' ? body.mandate : ''
  if (mandate.length > 2000) return NextResponse.json({ error: 'A mandate is one plain sentence.' }, { status: 400 })
  try {
    const tryout = await createTryout({ wallet, agentKeyHash, mandate, capUsd: cap, internal })
    return NextResponse.json({ paper: PAPER_LABEL, tryout, ...(internal ? { internal: true } : {}) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim().toLowerCase()
  const agent = cleanAgentKeyHash(req.nextUrl.searchParams.get('agent'))
  if (!WALLET_RE.test(wallet) && !agent) return NextResponse.json({ error: 'Pass ?wallet=0x… or ?agent=<hash>.' }, { status: 400 })

  // §1.5-5: the PUBLIC per-agent read excludes our own stamped drills; the
  // owner's per-wallet read shows their own rows (drill wallets are ours).
  const scope = WALLET_RE.test(wallet) ? { wallet } : { agentKeyHash: agent!, isInternal: false }
  const rows = await prisma.rosterTryout
    .findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    .catch(() => [])

  // Lazy due-detection: the first read at ≥ review_at captures the review
  // (write-once inside; early is refused there, so due-only here).
  const now = Date.now()
  for (const t of rows) {
    if (t.status === 'running' && now >= t.reviewAt.getTime()) {
      await captureReview(t.id).catch(() => {})
    }
  }

  const fresh = await prisma.rosterTryout
    .findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { marks: { orderBy: { seq: 'asc' } } },
    })
    .catch(() => [])

  const since90d = new Date(now - 90 * 24 * 60 * 60 * 1000)
  const tryouts = await Promise.all(
    fresh.map(async (t) => {
      const kindCount90d = await prisma.rosterTryout
        .count({ where: { agentKeyHash: t.agentKeyHash, mandateKind: t.mandateKind, createdAt: { gte: since90d } } })
        .catch(() => 1)
      const marks: TryoutCardMark[] = t.marks.map((m) => ({
        seq: m.seq,
        askText: m.askText,
        proposedAt: m.proposedAt,
        venue: m.venue,
        quoteAtPropose: m.quoteAtPropose as unknown as TryoutQuote,
        quoteAtReview: (m.quoteAtReview as unknown as TryoutQuote) ?? null,
      }))
      return {
        id: t.id,
        wallet: t.wallet,
        agentKeyHash: t.agentKeyHash,
        mandateText: t.mandateText,
        mandateKind: t.mandateKind,
        capUsd: t.capUsd,
        status: t.status,
        startedAt: t.startedAt,
        reviewAt: t.reviewAt,
        reviewedAt: t.reviewedAt,
        marks,
        card: tryoutReportCard({
          mandateText: t.mandateText,
          startedAt: t.startedAt,
          reviewAt: t.reviewAt,
          reviewedAt: t.reviewedAt,
          marks,
          kindCount90d,
        }),
      }
    }),
  )
  return NextResponse.json({ paper: PAPER_LABEL, tryouts })
}
