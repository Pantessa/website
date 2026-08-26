// lib/roster-tryouts.ts — M6 forward-paper tryouts, the PURE half
// (ROSTER-TRYOUTS-SPEC §1). Grammar, quotas, and the report-card copy
// contract live here so the harness pins the exact strings; I/O (DB +
// venue quotes) lives in lib/roster-tryouts-exec.ts.
//
// The judge kills are the walls: forward-only, PAPER structural (its own
// tables and nothing else), two server-computed quotes with ZERO
// cross-quote arithmetic, no "would have made $X" in any wording. The
// render function below is the only place card copy is composed — the
// banned-phrase pin runs against IT, not against a page.
//
// SPEC GAPS hit while building (fail-closed picks, flagged for Ideation
// in squad-overnight-2026-08-25/uiux.md):
//   G1 — §1.1-4 names quote fns for swaps only; 'protect' and 'yield'
//        mandates have NO defined executor quote fn → marks for those
//        kinds REFUSE BY NAME (shape + dca marks ship).
//   G2 — §1.3 "mints the report card as an inbox item" contradicts
//        §1.1-2 "never inbox items" (an inbox item IS an intent_link on
//        the merged M5 rails) → NO inbox mint; the card lives on the
//        tryouts API + the /agents record page.

import { parseDcaCreate, periodKeyFor, type DcaCadence } from '@/lib/dca'

export const TRYOUT_DAYS = 7
/** §1.5-3: concurrent running tryouts per agent per mandate kind. */
export const TRYOUT_MAX_RUNNING_PER_KIND = 3
/** §1.4 header label — VERBATIM on every surface (card, page, API). */
export const PAPER_LABEL =
  'Paper tryout — simulated proposals; no transactions occurred. Hypothetical activity, not a prediction, not advice.'

/** Kinds whose executor exposes a read-only quote path today (G1). */
export const MARKABLE_KINDS = new Set(['shape', 'dca'])

/** The mark grammar: the manager's canonical proposal sentence — one
 *  $-priced same-chain swap, one side the chain stable. Narrow ON PURPOSE:
 *  what parses here is exactly what the real executor compiles, and the
 *  stored ask is grammar-constrained (T2-safe to render). */
const MARK_ASK_RE =
  /^Swap \$(\d+(?:\.\d+)?) of ([A-Za-z]{2,12}) to ([A-Za-z]{2,12}) on (base|ethereum|arbitrum|robinhood)$/

export interface ParsedMarkAsk {
  amountUsd: number
  sellToken: string
  buyToken: string
  chainWord: 'base' | 'ethereum' | 'arbitrum' | 'robinhood'
  /** The non-stable side — what the venue quote prices. */
  quoteToken: string
  side: 'sell' | 'buy'
}

const STABLES = new Set(['USDC', 'USDG', 'USDT', 'DAI'])

export function parseMarkAsk(raw: string): ParsedMarkAsk | { problem: string } {
  const m = raw.trim().match(MARK_ASK_RE)
  if (!m) {
    return {
      problem:
        'A paper mark is the canonical proposal sentence — exactly "Swap $X of TOKEN to TOKEN on <chain>". Anything else would not round-trip the executor grammar.',
    }
  }
  const [, usd, a, b, chain] = m
  const sellToken = a.toUpperCase()
  const buyToken = b.toUpperCase()
  const sellStable = STABLES.has(sellToken)
  const buyStable = STABLES.has(buyToken)
  if (sellStable === buyStable) {
    return { problem: 'One side of a paper mark must be the chain stable (the settlement rail) — stable↔stable and token↔token marks refuse.' }
  }
  const amountUsd = Number(usd)
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { problem: 'The mark needs a positive dollar size.' }
  return {
    amountUsd,
    sellToken,
    buyToken,
    chainWord: chain.toLowerCase() as ParsedMarkAsk['chainWord'],
    quoteToken: sellStable ? buyToken : sellToken,
    side: sellStable ? 'buy' : 'sell',
  }
}

/** §1.5-4: the mandate's OWN cadence bounds marks. DCA → its period key;
 *  everything else → one per UTC day. */
export function markPeriodKey(mandateKind: string, mandateText: string, at = new Date()): string {
  if (mandateKind === 'dca') {
    const dca = parseDcaCreate(mandateText)
    const cadence: DcaCadence = dca && !('problem' in dca) ? dca.cadence : 'day'
    return periodKeyFor(cadence, at)
  }
  return periodKeyFor('day', at)
}

// ── The quote shape (spec §1.2) and its render — NUMBERS side by side,
//    never arithmetic across them ─────────────────────────────────────────

export interface TryoutQuote {
  pair: string // 'ETH/USDC'
  side: 'buy' | 'sell'
  amountIn: number // the mark's $ size
  quoteOut: number // USD per one whole token, from the executor's quote fn
  unit: string // 'USD per ETH'
}

export function renderQuote(q: TryoutQuote): string {
  return `${q.quoteOut} ${q.unit}`
}

export interface TryoutCardMark {
  seq: number
  askText: string
  proposedAt: Date
  venue: string
  quoteAtPropose: TryoutQuote
  quoteAtReview: TryoutQuote | null
}

export interface TryoutCardInput {
  mandateText: string
  startedAt: Date
  reviewAt: Date
  reviewedAt: Date | null
  marks: TryoutCardMark[]
  /** K — the agent's tryouts of this kind in the last 90 days (§1.5-3). */
  kindCount90d: number
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/** §1.4 — the ONE copy composer, exact contract. Facts only: both quote
 *  numbers render side by side; nothing is ever computed across them. */
export function tryoutReportCard(t: TryoutCardInput): string {
  const lines = [
    PAPER_LABEL,
    `Tryout: "${t.mandateText}" · ${day(t.startedAt)}–${day(t.reviewAt)}`,
    `${t.marks.length} paper proposal${t.marks.length === 1 ? '' : 's'}. This agent has run ${t.kindCount90d} tryout${t.kindCount90d === 1 ? '' : 's'} of this mandate kind in the last 90 days (all shown on your tryouts page).`,
  ]
  for (const m of t.marks) {
    lines.push(`#${m.seq} — proposed "${m.askText}" on ${day(m.proposedAt)} · venue: ${m.venue}`)
    lines.push(
      `  quote then: ${renderQuote(m.quoteAtPropose)} · quote at review: ${
        m.quoteAtReview ? renderQuote(m.quoteAtReview) : 'not yet captured'
      }${t.reviewedAt ? ` (review captured ${t.reviewedAt.toISOString()})` : ''}`,
    )
  }
  return lines.join('\n')
}

/** §1.4's banned list — exported so the harness pins the composer against
 *  it. "%" is banned as quote-pair arithmetic; mandate text may legally
 *  carry tile percents, so the pin checks the QUOTE LINES, not the header. */
export const TRYOUT_BANNED_PHRASES = ['would have', 'made', 'kept', 'earned', 'gained', '+$', 'return', 'profit'] as const
