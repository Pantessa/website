import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { agentHandleFor } from '@/lib/agent-record'
import { getMultichainPortfolio } from '@/lib/alchemy'
import { openIntent } from '@/lib/broker-exec'
import { inboxFor } from '@/lib/inbox'
import { rosterEnabled } from '@/lib/roster-policy'
import { decideManagerMove, undecidedProposalFor } from '@/lib/roster-manager'
import { MOSAIC_CHAIN_LABELS, mosaicStableFor, parseMosaicAsk, type MosaicChainWord, type MosaicHolding } from '@/lib/mosaic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The house manager's heartbeat (FIRST-HIRE sprint, premortem find #1):
// before this, the Rebalancer only ran when a human typed `manager:once` —
// a stranger who hired got eternal silence. Vercel cron hits this every 5
// minutes; for each HIRED shape slot bound to the HOUSE identity it runs
// the same decide→open path the script runs.
//
// SECURITY SEMANTICS (the inverse of manager:once's default):
//   • Auth: CRON_SECRET bearer, guardian pattern — no secret set = 401
//     always (fail closed, never open).
//   • LIVE by default: a real stranger's proposal must NOT be stamped
//     is_internal — openIntent runs with internal:false unconditionally;
//     the cron path ignores x-yf-internal-run entirely (a header on a cron
//     call must not be able to hide a real user's proposal from the books).
//   • is_internal SLOTS are skipped: drill hires are ours; `manager:once`
//     (stamped by default) remains their door. The cron never mixes lanes.
//   • HOUSE_MANAGER_KEY unset or roster disabled = silent no-op (200,
//     skipped) — the schedule may fire before the env exists.
//   • Within band ⇒ proposes NOTHING ("a good employee does not invent
//     work"); one-card-at-a-time stacking fence honored before any RPC.
//   • Every wall is the SERVER's own (cap at open, §4.4 budget, benched/
//     fired) — surfaced per-slot, never retried around.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

type SlotResult = { slot: string; wallet: string; verdict: string; url?: string }

async function workSlot(slot: {
  id: string
  walletAddress: string
  mandateText: string
  mandateKind: string
  agentKeyHash: string | null
  capUsd: number
  status: string
}, managerKey: string, myHash: string): Promise<SlotResult> {
  const base = { slot: slot.id, wallet: slot.walletAddress }
  // One card at a time — the stacking fence before any RPC is spent.
  const inbox = await inboxFor(slot.walletAddress).catch(() => null)
  if (inbox === null) return { ...base, verdict: 'inbox-unreadable' }
  if (undecidedProposalFor(inbox, slot.id)) return { ...base, verdict: 'waiting-on-card' }

  const parsed = parseMosaicAsk(slot.mandateText)
  if (!parsed || 'problem' in parsed) return { ...base, verdict: 'mandate-unparseable' }
  const portfolio = await getMultichainPortfolio(slot.walletAddress).catch(() => null)
  if (!portfolio) return { ...base, verdict: 'wallet-unreadable' }

  // Chain scoping — the script's own rule (mosaic exec shell semantics).
  const named = new Set(parsed.slices.map((s) => s.token))
  const chainUsd = (word: MosaicChainWord) =>
    portfolio.holdings.reduce((a, h) => {
      if (h.chain !== MOSAIC_CHAIN_LABELS[word]) return a
      const sym = h.symbol.toUpperCase()
      if (!named.has(sym) && sym !== mosaicStableFor(word)) return a
      return a + (h.valueUsd ?? 0)
    }, 0)
  const chainWord: MosaicChainWord =
    parsed.chainWord ??
    (['base', 'ethereum', 'arbitrum', 'robinhood'] as MosaicChainWord[]).reduce(
      (best, w) => (chainUsd(w) > chainUsd(best) ? w : best),
      'base' as MosaicChainWord,
    )
  const holdings: MosaicHolding[] = portfolio.holdings
    .filter((h) => h.chain === MOSAIC_CHAIN_LABELS[chainWord])
    .map((h) => ({ symbol: h.symbol.toUpperCase(), balance: parseFloat(h.balance) || 0, priceUsd: h.priceUsd, valueUsd: h.valueUsd, native: h.native }))

  const verdict = decideManagerMove({ slot, myAgentKeyHash: myHash, chainWord, holdings })
  if (verdict.kind !== 'propose') return { ...base, verdict: verdict.kind }

  // LIVE, unconditionally: strangers' proposals are real rows on the books.
  try {
    const out = await openIntent(
      { ask: verdict.ask, wallet: slot.walletAddress, agent: 'Pantessa Rebalancer', agentKey: managerKey },
      { internal: false },
    )
    return { ...base, verdict: 'proposed', url: out.roster?.url }
  } catch (e) {
    return { ...base, verdict: `walled: ${(e as Error).message.slice(0, 140)}` }
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const managerKey = process.env.HOUSE_MANAGER_KEY
  if (!managerKey) return NextResponse.json({ live: true, skipped: 'HOUSE_MANAGER_KEY unset — no house identity, silent no-op.' })
  if (!rosterEnabled()) return NextResponse.json({ live: true, skipped: 'ROSTER_ENABLED off — the roster is dark.' })

  const myHash = agentHandleFor(managerKey)
  // Drill hires (is_internal) are worked by `manager:once`, never the cron.
  const slots = await prisma.rosterSlot
    .findMany({
      where: { agentKeyHash: myHash, status: 'hired', mandateKind: 'shape', isInternal: false },
      select: { id: true, walletAddress: true, mandateText: true, mandateKind: true, agentKeyHash: true, capUsd: true, status: true },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    })
    .catch(() => [])

  const results: SlotResult[] = []
  for (const slot of slots) {
    try {
      results.push(await workSlot(slot, managerKey, myHash))
    } catch (e) {
      results.push({ slot: slot.id, wallet: slot.walletAddress, verdict: `error: ${(e as Error).message.slice(0, 140)}` })
    }
  }
  return NextResponse.json({ live: true, managerHash: myHash, slots: slots.length, results })
}

export const POST = GET
