// The Tape view on /t/<sym> (2026-10-20, `?view=tape`): this instrument's
// prints as rows, newest first, the sentence that does the same thing on
// every row. Nate, on the Depth view: "can we add the tape view next to
// depth". The /live tape is every market; this one is the chart's own.
//
// Two sources, one ring:
//   · the venue's recent trades (/api/charts/trades — Coinbase or
//     Hyperliquid, lib/venue-trades) open the view full, and keep it moving
//     on a coin Dune's trial does not carry;
//   · Dune's prints off the chart's one relay stream (lib/chart-live
//     chartLiveFeed) take the live edge when the instrument has them.
// A row says which one drew it; nothing is invented (a venue row with no
// side says so). Pure — pinned in scripts/chart-tape-pins.ts.

import type { ChartPair } from './charts'
import type { Print } from './chart-live'
import { followAsk, venueTag, type FollowAsk, type TapeFill, type TapeSide, type TapeVenue } from './tape'

/** Rows the view keeps (newest first). */
export const CHART_TAPE_MAX = 200
/** The summary strip's window. */
export const CHART_TAPE_WINDOW_MS = 5 * 60_000
/** How often the venue's trades are re-read while the view is open. */
export const CHART_TAPE_POLL_MS = 5_000

export interface ChartTapeRow {
  id: string
  at: number
  price: number
  size: number
  usd: number
  /** The taker's side; null when the venue did not say. */
  side: TapeSide | null
  /** The market name the follow sentence is composed from. */
  market: string
  venue: TapeVenue
  chainId: number | null
  /** Where the row came from, short (`HL`, `BASE`, `COINBASE`). */
  tag: string
  from: 'venue' | 'dune'
}

/** A Dune print → a row. */
export function rowFromFill(f: TapeFill): ChartTapeRow | null {
  if (!(f.price > 0)) return null
  return { id: `d:${f.id}`, at: f.at, price: f.price, size: f.size, usd: f.usd > 0 ? f.usd : f.price * f.size, side: f.side, market: f.market, venue: f.venue, chainId: f.chainId, tag: venueTag(f.venue, f.chainId), from: 'dune' }
}

/** The venue's recent trades → rows. A Coinbase print follows as the spot
 *  buy (chainless: the swap layer picks the token's home chain); a
 *  Hyperliquid print as the perp. The id is the print's own content, so a
 *  re-read never doubles a row. */
export function rowsFromVenue(prints: readonly Print[], pair: Pick<ChartPair, 'symbol' | 'source' | 'pair'>): ChartTapeRow[] {
  const hl = pair.source === 'hyperliquid'
  if (!hl && pair.source !== 'coinbase') return []
  const out: ChartTapeRow[] = []
  for (const p of prints) {
    if (!(p.price > 0) || !Number.isFinite(p.at)) continue
    out.push({
      id: `v:${p.at}:${p.price}:${p.size}:${p.side ?? '-'}`,
      at: p.at,
      price: p.price,
      size: p.size,
      usd: p.price * p.size,
      side: p.side ?? null,
      market: hl ? pair.pair : pair.symbol.toUpperCase(),
      venue: hl ? 'hyperliquid' : 'dex',
      chainId: null,
      tag: hl ? 'HL' : 'COINBASE',
      from: 'venue',
    })
  }
  return out
}

/** The handoff (the chart's seedThenPrints rule): once Dune has printed,
 *  a venue row at or after its first print is the same trade seen twice —
 *  only the venue's rows BEFORE it stay. Null = Dune has not printed. */
export function venueBefore(rows: readonly ChartTapeRow[], firstDuneAt: number | null): ChartTapeRow[] {
  if (firstDuneAt == null) return rows as ChartTapeRow[]
  return rows.filter((r) => r.from === 'dune' || r.at < firstDuneAt)
}

/** Newest first, one row per id, at most `max`. */
export function mergeTapeRows(prev: readonly ChartTapeRow[], incoming: readonly ChartTapeRow[], max = CHART_TAPE_MAX): ChartTapeRow[] {
  if (incoming.length === 0) return prev as ChartTapeRow[]
  const seen = new Set<string>()
  const all = [...incoming, ...prev].sort((a, b) => b.at - a.at)
  const out: ChartTapeRow[] = []
  for (const r of all) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
    if (out.length >= max) break
  }
  return out
}

export interface ChartTapeSummary {
  count: number
  buyUsd: number
  sellUsd: number
  /** Buys' share of the sided dollars, 0..1; null with nothing sided. */
  buyShare: number | null
  largest: ChartTapeRow | null
}

/** The strip over the rows: the window's prints, the taker split, the largest. */
export function tapeSummary(rows: readonly ChartTapeRow[], now: number, windowMs = CHART_TAPE_WINDOW_MS): ChartTapeSummary {
  let count = 0
  let buyUsd = 0
  let sellUsd = 0
  let largest: ChartTapeRow | null = null
  for (const r of rows) {
    if (r.at < now - windowMs) continue
    count++
    if (r.side === 'buy') buyUsd += r.usd
    else if (r.side === 'sell') sellUsd += r.usd
    if (!largest || r.usd > largest.usd) largest = r
  }
  const sided = buyUsd + sellUsd
  return { count, buyUsd, sellUsd, buyShare: sided > 0 ? buyUsd / sided : null, largest }
}

/** The row's button: what this print did, in the sentence the chat runs
 *  (lib/tape followAsk). A row with no side has none. */
export function followRow(row: Pick<ChartTapeRow, 'market' | 'side' | 'venue' | 'chainId'>, usd?: number): FollowAsk | null {
  if (!row.side) return null
  return followAsk({ market: row.market, side: row.side, venue: row.venue, chainId: row.chainId }, usd)
}

/** The foot's words: which sources drew the rows on screen. */
export function tapeSourceWords(rows: readonly ChartTapeRow[], duneLabel: string | null, venueLabel: string): string {
  const dune = rows.some((r) => r.from === 'dune')
  const venue = rows.some((r) => r.from === 'venue')
  const d = `Dune · ${duneLabel ?? 'prints'}`
  const v = `${venueLabel} trades`
  return dune && venue ? `${v} + ${d}` : dune ? d : v
}
