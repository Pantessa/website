// ─────────────────────────────────────────────────────────────────────────
//  The call page's order ticket — Buy / Sell, Market / Limit, a dollar size,
//  a limit price — composed into ONE sentence the chat's native layers
//  already parse. The ticket never builds anything itself: the sentence is
//  sent through the ask door and the guarded card quotes, builds and asks
//  the wallet to sign. Every row comes from lib/symbol-venues (ladder-pinned)
//  or lib/symbol-venues limitAtLevel, so the ticket can only say what the
//  product can do.
//
//  Pure + client-safe. Pinned by scripts/chart-calls-pins.ts.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartPair } from './charts'
import type { ChartLine } from './chart-state'
import { SPOT_CHAINS, limitAtLevel, venuesFor } from './symbol-venues'

export type TicketSide = 'buy' | 'sell'
export type TicketMode = 'market' | 'limit'

export const TICKET_USD_PRESETS = [10, 25, 50, 100, 250] as const
export const TICKET_USD_MIN = 1
export const TICKET_USD_MAX = 100_000

export interface TicketShape {
  /** What the two sides are called here: Buy/Sell on spot, Long/Short where only a perp lists. */
  sides: { buy: string; sell: string }
  /** The symbol has a CoW book somewhere: a limit order can rest. */
  limit: boolean
  /** The chain word the limit order names (the first spot chain with a book). */
  limitChain: string | null
  /** A perp-only symbol: both sides open a position, nothing is "held". */
  perpOnly: boolean
}

/** What the ticket can offer for this symbol. */
export function ticketShape(symbol: string, pair: ChartPair, last: number | null): TicketShape {
  const rows = venuesFor(symbol, pair, { usd: 50, last: last ?? undefined })
  const spot = rows.some((r) => (r.kind === 'spot' || r.kind === 'stock') && r.side === 'buy')
  const perp = rows.some((r) => r.kind === 'perp')
  const limitRow = rows.find((r) => r.kind === 'limit')
  const limitChain = limitRow ? (SPOT_CHAINS.find((c) => c.id === limitRow.chainId)?.word ?? null) : null
  return {
    sides: spot ? { buy: 'Buy', sell: 'Sell' } : { buy: 'Long', sell: 'Short' },
    limit: !!limitRow && !!limitChain,
    limitChain,
    perpOnly: !spot && perp,
  }
}

export interface TicketInput {
  symbol: string
  pair: ChartPair
  side: TicketSide
  mode: TicketMode
  usd: number
  /** Limit mode only. */
  price: number | null
  last: number | null
}

export type TicketVerdict = { ok: true; ask: string; words: string } | { ok: false; reason: string }

/** A dollar size the grammars accept: whole dollars, or cents under $10. */
export function cleanUsd(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < TICKET_USD_MIN || raw > TICKET_USD_MAX) return null
  return raw >= 10 ? Math.round(raw) : Math.round(raw * 100) / 100
}

/** The sentence the ticket sends, or why it cannot. */
export function composeTicket(input: TicketInput): TicketVerdict {
  const usd = cleanUsd(input.usd)
  if (usd === null) return { ok: false, reason: `Size it between $${TICKET_USD_MIN} and $${TICKET_USD_MAX.toLocaleString('en-US')}.` }
  const rows = venuesFor(input.symbol, input.pair, { usd, last: input.last ?? undefined })
  if (input.mode === 'limit') {
    if (input.last === null || !(input.last > 0)) return { ok: false, reason: 'No live price to rest a limit against yet.' }
    if (input.price === null || !(input.price > 0)) return { ok: false, reason: 'Name the limit price.' }
    const limitRow = rows.find((r) => r.kind === 'limit')
    const chain = limitRow ? SPOT_CHAINS.find((c) => c.id === limitRow.chainId)?.word : null
    if (!chain) return { ok: false, reason: 'No order book for a resting limit on this symbol — use Market.' }
    const at = limitAtLevel(input.symbol, chain, usd, input.price, input.last)
    if (!at) return { ok: false, reason: 'A limit at the market price is a market order — use Market, or move the price.' }
    if (at.side !== input.side) {
      return { ok: false, reason: input.side === 'buy' ? 'A buy limit rests UNDER the market; set a price below the last.' : 'A sell limit rests OVER the market; set a price above the last.' }
    }
    return { ok: true, ask: at.ask, words: at.hint }
  }
  const pick = (kind: 'stock' | 'spot' | 'perp') => rows.find((r) => r.kind === kind && r.side === input.side)
  const row = pick('stock') ?? pick('spot') ?? pick('perp')
  if (!row) return { ok: false, reason: `No venue ${input.side === 'buy' ? 'buys' : 'sells'} ${input.symbol} here yet.` }
  return { ok: true, ask: row.ask, words: row.note ?? (row.kind === 'perp' ? 'Opens on Hyperliquid at the account\'s leverage.' : `Swaps on ${row.venue === 'uniswap' ? 'Uniswap v3' : row.venue}; the card quotes the pool before you sign.`) }
}

/** The drawn level the ticket opens on: the nearest level under the last
 *  price for a buy, over it for a sell; else 1% off the market. */
export function defaultLimitPrice(lines: ChartLine[], side: TicketSide, last: number | null): number | null {
  if (last === null || !(last > 0)) return null
  const prices: number[] = []
  for (const l of lines) {
    if (l.kind === 'h') prices.push(l.price)
    else if (l.kind === 'zone') prices.push(l.p1, l.p2)
  }
  const candidates = prices.filter((p) => (side === 'buy' ? p < last : p > last))
  if (candidates.length) return side === 'buy' ? Math.max(...candidates) : Math.min(...candidates)
  return side === 'buy' ? last * 0.99 : last * 1.01
}
