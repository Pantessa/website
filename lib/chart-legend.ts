// The chart's on-plot readout and its keyboard, as pure rules (pinned in
// scripts/gtm-chart-pins.ts). MarketChart and ChartLegend are the callers.
//
//  - legendOf: the O/H/L/C line for the bar under the crosshair (or the newest
//    bar when nothing is hovered). The move is close-over-PREVIOUS-close, the
//    number every tape prints; the first held bar has no previous close, so it
//    reads open-to-close and says nothing it cannot back.
//  - tidyPrice: a price picked off a pixel, cut to what the axis can show. A
//    level dropped at $2,650.3718264 would print that tail into the order.
//  - awayFromLive: whether the newest bar has left the view (the "Live" button).
//  - chartKey: what a key press means while the pointer is over a chart.

import type { Candle, ChartTf } from './charts'

export interface LegendRead {
  t: number
  o: number
  h: number
  l: number
  c: number
  /** Close vs the previous bar's close (vs this bar's open on the first bar). */
  chg: number
  chgPct: number
  /** Up, down, or flat: by the bar's own body, the candle's color. */
  dir: 'up' | 'down' | 'flat'
  /** Null when the feed carries no volume for the bar. */
  vol: number | null
  /** True when this is the newest bar (still forming). */
  live: boolean
}

export function legendOf(bars: readonly Candle[], t: number | null): LegendRead | null {
  if (!bars.length) return null
  let i = bars.length - 1
  if (t !== null) {
    const at = bars.findIndex((b) => b.t === t)
    if (at >= 0) i = at
  }
  const b = bars[i]
  const base = i > 0 ? bars[i - 1].c : b.o
  const chg = b.c - base
  return {
    t: b.t,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    chg,
    chgPct: base > 0 ? (chg / base) * 100 : 0,
    dir: b.c > b.o ? 'up' : b.c < b.o ? 'down' : 'flat',
    vol: Number.isFinite(b.v) && b.v > 0 ? b.v : null,
    live: i === bars.length - 1,
  }
}

/** "+1.24%" / "−0.66%" / "0.00%": a real minus sign, never a hyphen. */
export function fmtLegendPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—'
  const abs = Math.abs(pct).toFixed(2)
  if (abs === '0.00') return '0.00%'
  return `${pct > 0 ? '+' : '−'}${abs}%`
}

/** 1,234 → "1.23K", 48_200_000 → "48.2M". Three significant digits. */
export function fmtLegendVol(v: number): string {
  if (!Number.isFinite(v) || v < 0) return '—'
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, unit] of units) {
    if (v >= size) return `${Number((v / size).toPrecision(3))}${unit}`
  }
  return String(Number(v.toPrecision(3)))
}

/** The bar's time, in the frame's grain: a day for 1D, the minute (UTC) under it. */
export function fmtLegendTime(t: number, tf: ChartTf): string {
  const d = new Date(t * 1000)
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (tf === '1d') return day
  const hm = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${hm} UTC`
}

/** A price read off a pixel, cut to the precision the axis prints
 *  (fmtPrice's ladder): whole dollars from $1,000, cents from $1, four
 *  places from a cent, three significant digits under it. Null for a price
 *  no order can carry. */
export function tidyPrice(p: number | null | undefined): number | null {
  if (p === null || p === undefined || !Number.isFinite(p) || p <= 0) return null
  if (p >= 1000) return Math.round(p)
  if (p >= 1) return Math.round(p * 100) / 100
  if (p >= 0.01) return Math.round(p * 10000) / 10000
  return Number(p.toPrecision(3))
}

/** The newest bar sits right of the view: more than one whole bar past the
 *  visible range's right end (a half-hidden last bar is still "live"). */
export function awayFromLive(visibleTo: number | null | undefined, barCount: number): boolean {
  if (visibleTo === null || visibleTo === undefined || !Number.isFinite(visibleTo) || barCount <= 0) return false
  return visibleTo < barCount - 2
}

export type ChartKey =
  | { kind: 'tf'; tf: ChartTf }
  | { kind: 'pan'; bars: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'live' }

export interface KeyPress {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** Bars a single arrow press travels, as a share of what is on screen. */
export const PAN_SHARE = 0.12
export const ZOOM_IN = 0.8
export const ZOOM_OUT = 1.25

/** What a key means over a chart. Null for anything with Cmd/Ctrl/Alt held
 *  (the browser's and the drawing layer's shortcuts stay theirs) and for
 *  every key not listed (the up and down arrows stay the page's scroll). `frames` is the chart's own frame list, in order:
 *  1 is the first frame, 2 the second. */
export function chartKey(e: KeyPress, frames: readonly ChartTf[], visibleBars: number): ChartKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  const step = Math.max(1, Math.round(Math.max(0, visibleBars) * PAN_SHARE))
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'pan', bars: -step * (e.shiftKey ? 4 : 1) }
    case 'ArrowRight':
      return { kind: 'pan', bars: step * (e.shiftKey ? 4 : 1) }
    case '+':
    case '=':
      return { kind: 'zoom', factor: ZOOM_IN }
    case '-':
    case '_':
      return { kind: 'zoom', factor: ZOOM_OUT }
    case 'End':
    case 'l':
    case 'L':
      return { kind: 'live' }
  }
  if (/^[1-9]$/.test(e.key)) {
    const tf = frames[Number(e.key) - 1]
    return tf ? { kind: 'tf', tf } : null
  }
  return null
}

/** A zoom about the RIGHT edge (the newest bar on screen stays put): the new
 *  left end of the visible range. Never fewer than `minBars` on screen. */
export function zoomedFrom(from: number, to: number, factor: number, minBars = 12): number {
  const span = Math.max(minBars, (to - from) * factor)
  return to - span
}

/** The pointer to the "+" on the price axis shows until the "+" has been used
 *  once in this browser. Kept here, not in the chart: the chart itself
 *  remembers nothing between visits (its view always opens on candles). */
const PLUS_HINT_KEY = 'pantessa.chart.plus'
export function plusHintSeen(): boolean {
  try {
    return window.localStorage.getItem(PLUS_HINT_KEY) === '1'
  } catch {
    return false
  }
}
export function markPlusHintSeen(): void {
  try {
    window.localStorage.setItem(PLUS_HINT_KEY, '1')
  } catch {
    /* no storage: the hint shows again next visit */
  }
}
