// THE TOUR · CHARTS — the miniature's rules (squad landing, 2026-11-10; lane
// SIDES-A). Pure: no React, no fetch. Which three markets the miniature
// shows, which sides each can honestly open, the sizes, and the sentence —
// ALWAYS composed by the order ticket's own composer (lib/order-ticket), so a
// sentence here is one the symbol page's ticket would send. Pinned by
// scripts/landing-sides-a-pins.ts; drawn by ../Charts.tsx (and reused by
// ../Links.tsx for the sentence a link carries).

import { chartPairFor, type ChartPair } from '@/lib/charts'
import { TICKET_DEFAULT_USD, TICKET_LEVERAGE_PRESETS, TICKET_USD_PRESETS, composeTicketAsk, fmtTicketUnits, freshTicket, ticketSidesFor, usdWord, type TicketCompose } from '@/lib/order-ticket'
import type { TourQuote } from '@/lib/home-tour/types'
import type { ReadPoint } from '@/lib/read'

/** A stock, a coin and a perp: one of each kind of market the app charts. */
export const MINI_SYMBOLS = ['AAPL', 'ETH', 'HYPE'] as const

/** The miniature only OPENS: a buy, or a leveraged long where a perp exists.
 *  (A sell, a stop or a stake needs something in the wallet first.) */
export type MiniSide = 'buy' | 'long'
const MINI_SIDES: readonly MiniSide[] = ['buy', 'long']

/** The long's leverage: the ticket's own second preset. */
export const MINI_LEVERAGE: number = TICKET_LEVERAGE_PRESETS[1]
/** The sizes: the ticket's own presets from its default up. */
export const MINI_SIZES: readonly number[] = TICKET_USD_PRESETS.filter((n) => n >= TICKET_DEFAULT_USD)
export const MINI_DEFAULT_USD: number = TICKET_DEFAULT_USD

export type MiniKind = 'stock' | 'coin' | 'perp'

export interface MiniMarketMeta {
  symbol: string
  pair: ChartPair
  kind: MiniKind
  /** "Tokenized stock" · "Coin" · "Perp". */
  kindWords: string
  /** Where an order on it runs, in the product's words. */
  venueWords: string
  sides: MiniSide[]
}

export function miniSides(pair: ChartPair): MiniSide[] {
  const offered = ticketSidesFor(pair)
  return MINI_SIDES.filter((s) => offered.includes(s))
}

export function miniSideLabel(side: MiniSide): string {
  return side === 'long' ? `Long ${MINI_LEVERAGE}x` : 'Buy'
}

/** The three markets, each with the sides its own ticket offers. A symbol
 *  the chart table does not know, or one with no opening side, is left out. */
export function miniMarkets(symbols: readonly string[] = MINI_SYMBOLS): MiniMarketMeta[] {
  const out: MiniMarketMeta[] = []
  for (const symbol of symbols) {
    const pair = chartPairFor(symbol)
    if (!pair) continue
    const sides = miniSides(pair)
    if (sides.length === 0) continue
    const kind: MiniKind = pair.source === 'robinhood' ? 'stock' : pair.source === 'hyperliquid' ? 'perp' : 'coin'
    out.push({
      symbol: pair.symbol,
      pair,
      kind,
      kindWords: kind === 'stock' ? 'Tokenized stock' : kind === 'perp' ? 'Perp' : 'Coin',
      venueWords: kind === 'stock' ? 'Robinhood Chain' : kind === 'perp' ? 'Hyperliquid' : sides.includes('long') ? 'Spot, or a Hyperliquid perp' : 'Spot',
      sides,
    })
  }
  return out
}

/** The sentence for a market, a side and a size: the order ticket's own. */
export function miniTicket(pair: ChartPair, side: MiniSide, usd: number, last: number | null): TicketCompose {
  return composeTicketAsk(pair, { ...freshTicket(pair, side, { usd, last }), leverage: side === 'long' ? MINI_LEVERAGE : 1 }, last)
}

/** A sentence split around its amount, so the part a size changes can be
 *  shown as the part that changed. Null when the amount is not in it. */
export function splitAtAmount(ask: string, usd: number): { before: string; amount: string; after: string } | null {
  const amount = usdWord(usd)
  const i = ask.indexOf(`${amount} `)
  if (i < 0) return null
  return { before: ask.slice(0, i), amount, after: ask.slice(i + amount.length) }
}

/** "0.0717" units of the symbol for a spot buy at a live price; null without
 *  one, and null for a perp (its size is the venue's to state). */
export function miniUnits(side: MiniSide, usd: number, last: number | null): string | null {
  if (side !== 'buy' || last == null || !(last > 0)) return null
  return fmtTicketUnits(usd / last)
}

// ── The read behind a market: one cached route ───────────────────────────────

export interface MiniMarket {
  last: number
  /** Percent over 24 hours; null when the route did not state one. */
  chg: number | null
  /** Hourly closes, oldest first. */
  points: ReadPoint[]
}

/** The hourly candles route for a symbol (the symbol page's own, cached on the server). */
export function miniMarketUrl(symbol: string): string {
  return `/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1h`
}

/** That route's body → the miniature's market, or NULL for anything that is
 *  not an answer (an error body, fewer than two bars, a non-positive close). */
export function acceptMiniMarket(body: unknown): MiniMarket | null {
  const b = body as { candles?: unknown; last?: unknown; changePct24h?: unknown; error?: unknown } | null
  if (!b || typeof b !== 'object' || b.error || !Array.isArray(b.candles)) return null
  const points: ReadPoint[] = []
  for (const c of b.candles as { t?: unknown; c?: unknown }[]) {
    if (c && typeof c.t === 'number' && typeof c.c === 'number' && Number.isFinite(c.t) && Number.isFinite(c.c) && c.c > 0) points.push([c.t, c.c])
  }
  if (points.length < 2) return null
  const last = typeof b.last === 'number' && Number.isFinite(b.last) && b.last > 0 ? b.last : points[points.length - 1][1]
  const chg = typeof b.changePct24h === 'number' && Number.isFinite(b.changePct24h) ? b.changePct24h : null
  return { last, chg, points }
}

// ── The first frame: the server's snapshot (round 3) ─────────────────────────

/** The server snapshot's quotes (lib/home-tour TourQuote: the same loader the
 *  candles route serves, read at render) → the miniature's markets by symbol,
 *  so the first paint is complete before any browser read. A quote with no
 *  price or fewer than two closes is left out (that market shows its dash and
 *  is read in the browser, as before). The line is drawn by ORDER (lib/read
 *  readChart), so a close's place stands in for its hour. */
export function miniMarketsOfQuotes(quotes: readonly TourQuote[] | null | undefined): Record<string, MiniMarket> {
  const out: Record<string, MiniMarket> = {}
  if (!Array.isArray(quotes)) return out
  for (const q of quotes) {
    const closes: readonly unknown[] = q && Array.isArray(q.closes) ? q.closes : []
    if (!q || typeof q.symbol !== 'string') continue
    const points: ReadPoint[] = []
    closes.forEach((c, i) => {
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) points.push([i, c])
    })
    if (points.length < 2) continue
    const last = typeof q.last === 'number' && Number.isFinite(q.last) && q.last > 0 ? q.last : points[points.length - 1][1]
    out[q.symbol] = { last, chg: typeof q.changePct === 'number' && Number.isFinite(q.changePct) ? q.changePct : null, points }
  }
  return out
}

// ── The sentence a link carries (../Links.tsx) ───────────────────────────────

/** The Links example is a swap with a dollar side on Base: a Uniswap swap,
 *  where the link fee and the creator's half inside the reader's transaction
 *  are certain (lib/fees `native-swap-uniswap`; /docs/creator-earnings "Paid
 *  inside the swap"). A stock buy was the first example, but a stock that
 *  settles through the fallback venue carries the ordinary swap fee. */
export const LINK_SWAP = { sell: 'ETH', buy: 'USDC', chain: 'Base' } as const

/** That sentence for a size. NOTE: no composer in the product writes a swap
 *  sentence (the order ticket writes Buy / Sell / Long), so this is the swap
 *  layer's own example phrasing — the sentence the Ask side offers
 *  (lib/home-tour/ask.ts, served-audited) — with the ticket's dollar word.
 *  Pinned at every size through the chat ladder the sentence audit runs
 *  (scripts/ask-ladder simulateLadder) and against the Ask side's sentence. */
export function linkSwapAsk(usd: number): string {
  return `Swap ${usdWord(usd)} of ${LINK_SWAP.sell} to ${LINK_SWAP.buy} on ${LINK_SWAP.chain}`
}
