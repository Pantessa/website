// THE TOUR · EARN — the ladder's rules (squad landing, 2026-11-10; lane
// SIDES-A). Pure: no React, no fetch. The ladder is the Earn board's own
// (lib/earn yieldLadder: the best live rate per asset, familiar assets first,
// drawn highest first), and a row's sentence is the board's own composer for
// the amount picked (the row's `askFor`). Two sources, one shape:
//   • the server snapshot's rows (`data.earn`, lane DATA) — the first frame.
//     Each carries ONE sentence, composed at the board's default amount, so
//     it can be run at that amount only;
//   • the live route (GET /api/markets/earn), read while the panel is on
//     screen — every amount, through `askFor`.
// Nothing here ranks by hand or writes a sentence. Pinned by
// scripts/landing-sides-a-pins.ts; drawn by ../Earn.tsx.

import { EARN_AMOUNTS, EARN_DEFAULT_USD, rankEarnRows, rowsFromWire, yieldLadder, type EarnResponse, type EarnRow } from '@/lib/earn'
import type { TourEarnRow } from '@/lib/home-tour'

/** Bars on the ladder: the board's own count. */
export const LADDER_ROWS = 8
export const LADDER_AMOUNTS: readonly number[] = EARN_AMOUNTS
export const LADDER_DEFAULT_USD: number = EARN_DEFAULT_USD
/** The live route, and how often the panel re-reads it while on screen (the board's own minute). */
export const LADDER_URL = '/api/markets/earn'
export const LADDER_REFRESH_MS = 60_000

export interface LadderRow {
  /** Stable across both sources: asset, venue and chain. */
  id: string
  asset: string
  /** "Aave" · "Lido" · "Morpho". */
  venue: string
  chain: string
  /** Yearly rate, percent. */
  apy: number
  /** The sentence that takes it for the amount picked; null when it cannot be composed for that amount. */
  ask: string | null
}

export interface LadderLive {
  ladder: EarnRow[]
  /** Rows on the full board. */
  ways: number
  /** Venues that did not answer this read. */
  failed: string[]
  asOf: string | null
}

const idOf = (asset: string, venue: string, chain: string) => `${asset}|${venue}|${chain}`.toLowerCase()

/** The live route's body → the ladder, or NULL for a body that is not an answer. */
export function acceptLadder(body: unknown): LadderLive | null {
  const b = body as Partial<EarnResponse> | null
  if (!b || typeof b !== 'object' || !Array.isArray(b.rows)) return null
  const all = rankEarnRows(rowsFromWire(b.rows))
  return {
    ladder: yieldLadder(all, LADDER_ROWS),
    ways: all.length,
    failed: Array.isArray(b.failed) ? b.failed.filter((v): v is EarnRow['venue'] => typeof v === 'string') : [],
    asOf: typeof b.asOf === 'string' ? b.asOf : null,
  }
}

/** Live rows at an amount: the sentence is the board's own `askFor`. */
export function ladderFromLive(rows: readonly EarnRow[], usd: number): LadderRow[] {
  return rows
    .filter((r): r is EarnRow & { apyPct: number } => r.apyPct != null && Number.isFinite(r.apyPct) && r.apyPct > 0)
    .map((r) => ({ id: idOf(r.asset, r.venueLabel, r.chainLabel), asset: r.asset, venue: r.venueLabel, chain: r.chainLabel, apy: r.apyPct, ask: r.askFor(usd) }))
}

/** Snapshot rows at an amount: each row's own sentence, which exists at the
 *  board's default amount only (never re-written for another). */
export function ladderFromSeed(seed: readonly TourEarnRow[], usd: number): LadderRow[] {
  return seed
    .filter((r) => r && typeof r.asset === 'string' && Number.isFinite(r.apy) && r.apy > 0)
    .slice(0, LADDER_ROWS)
    .map((r) => ({ id: idOf(r.asset, r.venue, r.chain), asset: r.asset, venue: r.venue, chain: r.chain, apy: r.apy, ask: usd === LADDER_DEFAULT_USD && r.ask ? r.ask : null }))
}

/** A bar's width, percent of the ladder's best rate (a floor keeps a small rate visible). */
export function ladderBarPct(apy: number, best: number): number {
  if (!(best > 0) || !(apy > 0)) return 0
  return Math.max(4, Math.min(100, Math.round((apy / best) * 1000) / 10))
}

/** What an amount earns in a year at a rate that holds: dollars. */
export function yearlyUsd(usd: number, apy: number): number {
  if (!(usd > 0) || !(apy > 0)) return 0
  return (usd * apy) / 100
}

export function fmtYearly(n: number): string {
  return `$${n.toFixed(2)}`
}

export function fmtRate(apy: number): string {
  return `${apy.toFixed(2)}%`
}

/** "14:32 UTC" from the route's ISO stamp; '' for anything else. */
export function fmtAsOfUtc(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(11, 16)} UTC`
}
