// ─────────────────────────────────────────────────────────────────────────
//  Performance tiles — 1W / 1M / 3M / 6M / YTD / 1Y percent change read off
//  a candle series. Pure; the symbol page (SHELL) renders what this returns
//  and never computes its own.
//
//  Honesty rule: a window the series does not reach is `pct: null` AND
//  named in `unavailable` — the candles proxy serves at most 180 bars, so a
//  1h series can answer 1W and nothing longer, a 1d series answers through
//  6M (180 days) and refuses 1Y by name. The tile shows "—", never a number
//  computed from the oldest bar we happen to have (that would be "since
//  ~6 months ago" wearing a "1Y" label).
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'

export type PerfWindow = '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y'

export interface PerfTile {
  key: PerfWindow
  /** Percent change from the window's base close to the latest close; null
   *  when the series does not reach back that far. */
  pct: number | null
  /** Unix seconds of the base candle the change was measured from. */
  from: number | null
  /** The base close. */
  base: number | null
}

export interface PerformanceTiles {
  tiles: PerfTile[]
  /** Windows the series could not answer, in order — for the caption. */
  unavailable: PerfWindow[]
  /** Latest close the tiles compare against. */
  last: number | null
  /** How far back the series reaches (unix seconds), for the caption. */
  since: number | null
}

const DAY = 86_400
const WINDOWS: PerfWindow[] = ['1W', '1M', '3M', '6M', 'YTD', '1Y']

/** The cutoff a window measures from. Calendar months are approximated as
 *  30 days (a tile, not an accountant); YTD is Jan 1 00:00 UTC of the
 *  latest candle's year. */
export function perfWindowCutoff(key: PerfWindow, nowSec: number): number {
  switch (key) {
    case '1W':
      return nowSec - 7 * DAY
    case '1M':
      return nowSec - 30 * DAY
    case '3M':
      return nowSec - 90 * DAY
    case '6M':
      return nowSec - 180 * DAY
    case '1Y':
      return nowSec - 365 * DAY
    case 'YTD': {
      const y = new Date(nowSec * 1000).getUTCFullYear()
      return Math.floor(Date.UTC(y, 0, 1) / 1000)
    }
  }
}

/** Tolerance: the base candle may open up to one bar-width (or a day,
 *  whichever is larger) AFTER the cutoff — a weekend gap on a stock tape
 *  must not turn "1W" into unavailable. */
function barWidth(candles: Candle[]): number {
  if (candles.length < 2) return DAY
  let min = Infinity
  for (let i = 1; i < Math.min(candles.length, 12); i++) {
    const d = candles[i].t - candles[i - 1].t
    if (d > 0 && d < min) min = d
  }
  return Number.isFinite(min) ? min : DAY
}

/**
 * Compute the tiles. `candles` ascending by time (the proxy's contract);
 * `nowSec` defaults to the latest candle's open time so a stale series
 * measures against itself, not the wall clock.
 */
export function performanceTiles(candles: Candle[], nowSec?: number): PerformanceTiles {
  const clean = candles.filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c) && c.c > 0)
  if (clean.length < 2) {
    return { tiles: WINDOWS.map((key) => ({ key, pct: null, from: null, base: null })), unavailable: [...WINDOWS], last: clean.length ? clean[clean.length - 1].c : null, since: clean.length ? clean[0].t : null }
  }
  const lastCandle = clean[clean.length - 1]
  const now = nowSec ?? lastCandle.t
  const first = clean[0]
  const slack = Math.max(barWidth(clean), DAY) * 1.5
  const tiles: PerfTile[] = []
  const unavailable: PerfWindow[] = []
  for (const key of WINDOWS) {
    const cutoff = perfWindowCutoff(key, now)
    // The series must START at or before the cutoff (within slack) — else
    // the window is deeper than what we hold.
    if (first.t > cutoff + slack) {
      tiles.push({ key, pct: null, from: null, base: null })
      unavailable.push(key)
      continue
    }
    // Base = the last candle at/before the cutoff; if none (cutoff falls
    // inside the slack before the first bar), the first bar.
    let base: Candle = first
    for (const c of clean) {
      if (c.t <= cutoff) base = c
      else break
    }
    const pct = ((lastCandle.c - base.c) / base.c) * 100
    tiles.push({ key, pct: Number.isFinite(pct) ? pct : null, from: base.t, base: base.c })
    if (!Number.isFinite(pct)) unavailable.push(key)
  }
  return { tiles, unavailable, last: lastCandle.c, since: first.t }
}

/** "+4.2%" / "−1.8%" / "—". */
export function fmtPct(pct: number | null, digits = 1): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${Math.abs(pct).toFixed(digits)}%`
}
