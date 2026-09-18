// The Growth page's math — pure, so the harness pins it without a database.
//
// /api/admin/growth reads signed turns grouped by (day, source, build path,
// stamped fee tier, owed creator, tester) and everything money-shaped on the
// page is a fold over those rows: the window tiles, the daily source mix, the
// fee split by venue, and what each creator is owed.
//
// One rulebook with the public surfaces: a dollar earns a fee only on a
// FEE_BEARING build path, at netFeeBpsForTurn's rate, and a creator's half is
// owed only where a creator exists (their link, or a wallet they referred).
// lib/links-board feeSummary credits house links to "creators" too; this view
// is the books, so it doesn't.

import { CREATOR_FEE_SPLIT, FEE_BEARING_BUILD_PATHS, netFeeBpsForTurn } from './fees'
import { UNATTRIBUTED_VENUE, venueOfBuildPath } from './build-path'

export const GROWTH_SOURCES = ['link', 'chat', 'embed', 'standing'] as const
export type GrowthSource = (typeof GROWTH_SOURCES)[number]

export const GROWTH_WINDOWS = [7, 30, 90] as const

/** One grouped row of real, receipt-counted signed turns. */
export interface GrowthTurnRow {
  /** UTC day, `YYYY-MM-DD`. */
  day: string
  source: GrowthSource
  buildPath: string | null
  feeBps: number | null
  /** The creator owed a share of this row's fee: the link's creator, or the
   *  creator who first referred the signing wallet. Null = nobody (organic,
   *  or a house link). */
  creator: string | null
  tester: boolean
  usd: number
  n: number
}

export interface FeeSplit {
  volumeUsd: number
  trades: number
  feeBearingUsd: number
  /** Net fee that reaches Pantessa's side of the venue split, before creators. */
  feeUsd: number
  creatorUsd: number
  pantessaUsd: number
}

const ZERO: FeeSplit = { volumeUsd: 0, trades: 0, feeBearingUsd: 0, feeUsd: 0, creatorUsd: 0, pantessaUsd: 0 }

const feeBearing = (path: string | null): path is string => !!path && FEE_BEARING_BUILD_PATHS.has(path)

/** What one row contributes. Fee-free paths move volume and nothing else. */
export function splitOfRow(r: GrowthTurnRow): FeeSplit {
  if (!feeBearing(r.buildPath)) return { ...ZERO, volumeUsd: r.usd, trades: r.n }
  const feeUsd = r.usd * (netFeeBpsForTurn(r.buildPath, r.feeBps) / 10_000)
  const creatorUsd = r.creator ? feeUsd * CREATOR_FEE_SPLIT : 0
  return { volumeUsd: r.usd, trades: r.n, feeBearingUsd: r.usd, feeUsd, creatorUsd, pantessaUsd: feeUsd - creatorUsd }
}

function add(a: FeeSplit, b: FeeSplit): FeeSplit {
  return {
    volumeUsd: a.volumeUsd + b.volumeUsd,
    trades: a.trades + b.trades,
    feeBearingUsd: a.feeBearingUsd + b.feeBearingUsd,
    feeUsd: a.feeUsd + b.feeUsd,
    creatorUsd: a.creatorUsd + b.creatorUsd,
    pantessaUsd: a.pantessaUsd + b.pantessaUsd,
  }
}

export function sumSplit(rows: GrowthTurnRow[]): FeeSplit {
  return rows.reduce((s, r) => add(s, splitOfRow(r)), ZERO)
}

/** `YYYY-MM-DD` for `offset` days before `now` (UTC). */
export function dayKey(now: number, offset = 0): string {
  return new Date(now - offset * 86_400_000).toISOString().slice(0, 10)
}

/** Rows inside the last `days` days, and the `days` before that. A window of
 *  N days is today plus the N−1 before it. */
export function windowRows(rows: GrowthTurnRow[], days: number, now: number) {
  const start = dayKey(now, days - 1)
  const prevStart = dayKey(now, 2 * days - 1)
  return {
    current: rows.filter((r) => r.day >= start),
    previous: rows.filter((r) => r.day >= prevStart && r.day < start),
  }
}

/** Change vs the previous window. Null when there's no base to compare to —
 *  "+∞%" off a zero week is noise, not growth. */
export function deltaPct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}

export interface VenueFeeRow extends FeeSplit {
  venue: string
  /** Blended net rate on the fee-bearing dollars, in bps. */
  effectiveBps: number | null
}

/** The fee table: one row per venue, biggest volume first. Volume on a path
 *  with no venue (legacy rows, job steps stamped without a path) lands on
 *  `unattributed` so the table always sums to the headline. */
export function feesByVenue(rows: GrowthTurnRow[]): VenueFeeRow[] {
  const by = new Map<string, FeeSplit>()
  for (const r of rows) {
    const venue = venueOfBuildPath(r.buildPath) ?? UNATTRIBUTED_VENUE
    by.set(venue, add(by.get(venue) ?? ZERO, splitOfRow(r)))
  }
  return [...by.entries()]
    .map(([venue, s]) => ({
      venue,
      ...s,
      effectiveBps: s.feeBearingUsd > 0 ? (s.feeUsd / s.feeBearingUsd) * 10_000 : null,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
}

export interface GrowthDayPoint {
  day: string
  link: number
  chat: number
  embed: number
  standing: number
  totalUsd: number
  cumulativeUsd: number
  pantessaUsd: number
  creatorUsd: number
  cumulativeFeeUsd: number
  trades: number
}

/** A dense daily series over the window (every day present, zeros included),
 *  with cumulative lines that carry everything before the window so "total so
 *  far" reads true when the window clips history. */
export function dailySeries(rows: GrowthTurnRow[], days: number, now: number): GrowthDayPoint[] {
  const start = dayKey(now, days - 1)
  const base = sumSplit(rows.filter((r) => r.day < start))
  let cumulativeUsd = base.volumeUsd
  let cumulativeFeeUsd = base.feeUsd
  const out: GrowthDayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now, i)
    const p: GrowthDayPoint = {
      day, link: 0, chat: 0, embed: 0, standing: 0,
      totalUsd: 0, cumulativeUsd: 0, pantessaUsd: 0, creatorUsd: 0, cumulativeFeeUsd: 0, trades: 0,
    }
    for (const r of rows) {
      if (r.day !== day) continue
      const s = splitOfRow(r)
      p[r.source] += r.usd
      p.totalUsd += s.volumeUsd
      p.pantessaUsd += s.pantessaUsd
      p.creatorUsd += s.creatorUsd
      p.trades += s.trades
      cumulativeFeeUsd += s.feeUsd
    }
    cumulativeUsd += p.totalUsd
    p.cumulativeUsd = cumulativeUsd
    p.cumulativeFeeUsd = cumulativeFeeUsd
    out.push(p)
  }
  return out
}

/** Volume by source, in GROWTH_SOURCES order. */
export function sourceMix(rows: GrowthTurnRow[]): { source: GrowthSource; usd: number; trades: number }[] {
  return GROWTH_SOURCES.map((source) => {
    const mine = rows.filter((r) => r.source === source)
    return { source, usd: mine.reduce((s, r) => s + r.usd, 0), trades: mine.reduce((s, r) => s + r.n, 0) }
  })
}

/** Lifetime volume + earnings owed per creator (their links and the wallets
 *  they referred, both already folded into `creator` by the query). */
export function earningsByCreator(rows: GrowthTurnRow[]): Map<string, { volumeUsd: number; trades: number; earnedUsd: number }> {
  const by = new Map<string, { volumeUsd: number; trades: number; earnedUsd: number }>()
  for (const r of rows) {
    if (!r.creator) continue
    const cur = by.get(r.creator) ?? { volumeUsd: 0, trades: 0, earnedUsd: 0 }
    const s = splitOfRow(r)
    by.set(r.creator, { volumeUsd: cur.volumeUsd + s.volumeUsd, trades: cur.trades + s.trades, earnedUsd: cur.earnedUsd + s.creatorUsd })
  }
  return by
}

/** How far an account got. Ordered: each stage implies the ones before it. */
export const ACCOUNT_STAGES = ['signed-up', 'asked', 'built', 'traded'] as const
export type AccountStage = (typeof ACCOUNT_STAGES)[number]

export function accountStage(a: { turns: number; built: number; signed: number }): AccountStage {
  if (a.signed > 0) return 'traded'
  if (a.built > 0) return 'built'
  if (a.turns > 0) return 'asked'
  return 'signed-up'
}
