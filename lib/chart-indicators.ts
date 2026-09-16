// ─────────────────────────────────────────────────────────────────────────
//  Chart overlays — the lines the engine draws on the candles: SMA 20 / 50
//  / 200, EMA 20, Bollinger bands, VWAP. Pure, client-safe, series-shaped
//  for the chart (one point per candle, `null` where the window isn't full
//  yet so the line starts honestly instead of at a fake flat value).
//
//  The rolling lines read a WARM-UP history, not just the bars on screen.
//  The chart's window is 180 bars (lib/candles-server MAX_CANDLES): over the
//  window alone an SMA 200 never draws and an SMA 50 starts a quarter of the
//  way in. So the candle route hands the chart the bars before its window
//  once (?warmup=1 → warmupBefore), every poll merges into that history
//  (mergeHistory), and a zoom-out prepends older pages (?before= →
//  prependHistory). The chart draws every held bar and computes each line
//  over the same bars; onWindow cuts a line back for a caller that draws a
//  window alone. VWAP stays a statistic of the live window.
//
//  TECH owns lib/technicals.ts (the gauges + tables); when its rows are
//  present the chart still draws lines from candles — a rating and a line
//  are different artifacts, and the line must match the bars on screen.
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'

export interface LinePoint {
  t: number
  v: number | null
}

export function sma(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c
    if (i >= period) sum -= candles[i - period].c
    out.push({ t: candles[i].t, v: i >= period - 1 ? sum / period : null })
  }
  return out
}

export function ema(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  let seed = 0
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].c
    if (i < period - 1) {
      seed += c
      out.push({ t: candles[i].t, v: null })
      continue
    }
    if (prev === null) {
      seed += c
      prev = seed / period
    } else {
      prev = c * k + prev * (1 - k)
    }
    out.push({ t: candles[i].t, v: prev })
  }
  return out
}

export interface BollingerBands {
  upper: LinePoint[]
  middle: LinePoint[]
  lower: LinePoint[]
}

export function bollinger(candles: Candle[], period = 20, mult = 2): BollingerBands {
  const middle = sma(candles, period)
  const upper: LinePoint[] = []
  const lower: LinePoint[] = []
  for (let i = 0; i < candles.length; i++) {
    const m = middle[i].v
    if (m === null) {
      upper.push({ t: candles[i].t, v: null })
      lower.push({ t: candles[i].t, v: null })
      continue
    }
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (candles[j].c - m) ** 2
    const sd = Math.sqrt(sq / period)
    upper.push({ t: candles[i].t, v: m + mult * sd })
    lower.push({ t: candles[i].t, v: m - mult * sd })
  }
  return { upper, middle, lower }
}

/** Session-less VWAP over the loaded series (typical price × volume). Null
 *  wherever cumulative volume is still zero — a tape without volume draws
 *  nothing rather than a line equal to the close. */
export function vwap(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = []
  let pv = 0
  let vol = 0
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3
    const v = Number.isFinite(c.v) && c.v > 0 ? c.v : 0
    pv += tp * v
    vol += v
    out.push({ t: c.t, v: vol > 0 ? pv / vol : null })
  }
  return out
}

/** Does the series carry any volume at all? (Robinhood 24/7 rows sometimes
 *  ship volume 0 — VWAP is offered only when there's something to weight.) */
export function hasVolume(candles: Candle[]): boolean {
  return candles.some((c) => Number.isFinite(c.v) && c.v > 0)
}

/** The bars a warm-up hands over: the deep series' bars strictly older than
 *  the window's first bar, the newest `n` of them (fewer when the tape is
 *  that short — the line then starts where the history honestly lets it). */
export function warmupBefore(deep: Candle[], window: Candle[], n: number): Candle[] {
  if (window.length === 0 || n <= 0) return []
  const first = window[0].t
  const older = deep.filter((c) => c.t < first)
  return older.length > n ? older.slice(-n) : older
}

/** Merge a newer run of bars into the overlay history. The newer run is the
 *  authority from its first bar on (the live bar's OHLC keeps moving); the
 *  history keeps only what is older. The two must OVERLAP: when the history
 *  ends before the run starts (a tab that slept through a whole window),
 *  bars in between may be missing — a venue's calendar is the only way to
 *  tell adjacency from a hole — so `gap` is set, the result is the run
 *  alone, and the caller warms up again. `cap` keeps the newest bars. */
export function mergeHistory(history: Candle[], newer: Candle[], cap: number): { bars: Candle[]; gap: boolean } {
  const keep = (bars: Candle[]) => (bars.length > cap ? bars.slice(-cap) : bars)
  if (newer.length === 0) return { bars: keep(history), gap: false }
  if (history.length === 0) return { bars: keep(newer), gap: false }
  const first = newer[0].t
  if (history[history.length - 1].t < first) return { bars: keep(newer), gap: true }
  return { bars: keep(history.filter((c) => c.t < first).concat(newer)), gap: false }
}

/** Cut a line back to the window on screen — its first candle to its last —
 *  so a history-long line never widens the chart's time scale. */
export function onWindow(points: LinePoint[], window: Candle[]): LinePoint[] {
  if (window.length === 0) return []
  const first = window[0].t
  const last = window[window.length - 1].t
  return points.filter((p) => p.t >= first && p.t <= last)
}

/** Prepend an OLDER page (the candle route's ?before=) to the history. The
 *  history keeps every bar it already holds; the page adds only bars
 *  strictly older than its first. The cap never costs the newest bars: a
 *  page that would overflow gives up its OLDEST instead, and `full` says the
 *  history takes no more (the chart stops paging and fits what it holds). */
export function prependHistory(older: Candle[], history: Candle[], cap: number): { bars: Candle[]; added: number; full: boolean } {
  if (history.length === 0) return { bars: history, added: 0, full: false }
  const first = history[0].t
  const room = Math.max(0, cap - history.length)
  const fresh = older.filter((c) => c.t < first)
  const add = fresh.length > room ? fresh.slice(fresh.length - room) : fresh
  return { bars: add.length ? add.concat(history) : history, added: add.length, full: history.length + add.length >= cap }
}

export type OverlayKey = 'sma20' | 'sma50' | 'sma200' | 'ema20' | 'bb' | 'vwap' | 'vp'

/** The overlay bar, in order. `swatch` is the toggle's legend color: the same
 *  token the canvas paints that line with (MarketChart readTokens), so the
 *  chip and the line can never disagree about which one is blue. */
export const OVERLAYS: { key: OverlayKey; label: string; title: string; swatch: string }[] = [
  { key: 'sma20', label: 'SMA 20', title: '20-bar simple moving average', swatch: 'var(--accent)' },
  { key: 'sma50', label: 'SMA 50', title: '50-bar simple moving average', swatch: 'var(--chart-ma-50)' },
  { key: 'sma200', label: 'SMA 200', title: '200-bar simple moving average — on the 1D chart, the 200-day', swatch: 'var(--chart-ma-200)' },
  { key: 'ema20', label: 'EMA 20', title: '20-bar exponential moving average', swatch: 'color-mix(in srgb, var(--fg) 70%, transparent)' },
  { key: 'bb', label: 'BB', title: 'Bollinger bands (20, 2σ)', swatch: 'var(--muted-2)' },
  { key: 'vwap', label: 'VWAP', title: 'Volume-weighted average price over the loaded bars', swatch: 'var(--sell)' },
  { key: 'vp', label: 'VP', title: 'Volume profile — the bars on screen binned by price, drawn at the right edge; the brightest row is where most volume traded', swatch: 'var(--mk-flat)' },
]

/** The symbol page opens on the trend pair: the 50 (blue) and the 200
 *  (yellow). The chat's chart overlay keeps a clean tape. */
export const DEFAULT_SYMBOL_OVERLAYS: OverlayKey[] = ['sma50', 'sma200', 'vp']
