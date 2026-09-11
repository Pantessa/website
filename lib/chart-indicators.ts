// ─────────────────────────────────────────────────────────────────────────
//  Chart overlays — the four the engine draws on the candles: SMA, EMA,
//  Bollinger bands, VWAP. Pure, client-safe, series-shaped for the chart
//  (one point per candle, `null` where the window isn't full yet so the
//  line starts honestly instead of at a fake flat value).
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

export type OverlayKey = 'sma20' | 'sma50' | 'ema20' | 'bb' | 'vwap'

export const OVERLAYS: { key: OverlayKey; label: string; title: string }[] = [
  { key: 'sma20', label: 'SMA 20', title: '20-bar simple moving average' },
  { key: 'sma50', label: 'SMA 50', title: '50-bar simple moving average' },
  { key: 'ema20', label: 'EMA 20', title: '20-bar exponential moving average' },
  { key: 'bb', label: 'BB', title: 'Bollinger bands (20, 2σ)' },
  { key: 'vwap', label: 'VWAP', title: 'Volume-weighted average price over the loaded bars' },
]
