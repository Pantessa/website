// ─────────────────────────────────────────────────────────────────────────
//  Technical ratings — computed from OUR OWN tape (the candles the chart
//  already draws), never fetched. PURE: no I/O, no Date, client-safe. The
//  /api/charts/technicals route feeds it the same series /api/charts/candles
//  serves, the TechnicalsTab draws the three gauges from its output, and the
//  verdict chips it composes are asks the existing parsers accept (swap /
//  dca / spot-guard / HL guardian / HL open) — the gauge is a button.
//
//  The indicator set and the buy/sell rules mirror the ones TradingView
//  publishes for its "Technical Ratings" indicator (help center article
//  43000614331, read 2026-09-11) so a reader who knows that gauge reads
//  ours the same way. Every rule is in the table below; every indicator is
//  unit-pinned against a hand-computed fixture in scripts/test-api.ts
//  (`// ── MARKETS/TECH ──`).
//
//  ┌──────────────────────────────┬──────────────────────────────────────────────┬──────────────────────────────────────────────┐
//  │ Indicator (params)           │ BUY when                                     │ SELL when                                    │
//  ├──────────────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────┤
//  │ RSI (14)                     │ RSI < 30 and RSI > RSI[1]                    │ RSI > 70 and RSI < RSI[1]                    │
//  │ Stochastic %K (14,3,3)       │ %K < 20, %D < 20, %K > %D                    │ %K > 80, %D > 80, %K < %D                    │
//  │ CCI (20)                     │ CCI < −100 and CCI > CCI[1]                  │ CCI > 100 and CCI < CCI[1]                   │
//  │ ADX (14,14)                  │ +DI > −DI, ADX > 20, ADX > ADX[1]            │ +DI < −DI, ADX > 20, ADX < ADX[1]            │
//  │ Awesome Oscillator (5,34)    │ crosses over 0, or AO > 0 two bars & rising  │ crosses under 0, or AO < 0 two bars & falling│
//  │ Momentum (10)                │ MOM > MOM[1]                                 │ MOM < MOM[1]                                 │
//  │ MACD level (12,26,9)         │ MACD > signal                                │ MACD < signal                                │
//  │ Stoch RSI fast (3,3,14,14)   │ downtrend, K < 20, D < 20, K > D             │ uptrend, K > 80, D > 80, K < D               │
//  │ Williams %R (14)             │ %R < −80 and %R > %R[1]                      │ %R > −20 and %R < %R[1]                      │
//  │ Bull Bear Power (13)         │ uptrend, bear < 0, bear > bear[1]            │ downtrend, bull > 0, bull < bull[1]          │
//  │ Ultimate Oscillator (7,14,28)│ UO > 70                                      │ UO < 30                                      │
//  ├──────────────────────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────┤
//  │ EMA / SMA 10,20,30,50,100,200│ MA < price                                   │ MA > price                                   │
//  │ VWMA (20), Hull MA (9)       │ MA < price                                   │ MA > price                                   │
//  │ Ichimoku Base (9,26,52,26)   │ leadA > leadB, base > leadA, conv > base,    │ leadA < leadB, base < leadA, conv < base,    │
//  │                              │ price > conv                                 │ price < conv                                 │
//  └──────────────────────────────┴──────────────────────────────────────────────┴──────────────────────────────────────────────┘
//  "uptrend"/"downtrend" (Stoch RSI, Bull Bear Power) = the 13-period EMA
//  rising / falling on the bar (Elder's own trend filter for Bull Bear
//  Power; TradingView's article names the trend without defining it).
//  Anything else is NEUTRAL. An indicator with too few bars to compute is
//  OMITTED (listed in `omitted`) rather than counted as neutral — a short
//  tape must not read as a calm one.
//
//  Gauge score = (buy − sell) / n over the indicators that computed
//  (= the mean of +1/0/−1 votes). Summary = the mean of the two gauge
//  scores (TradingView's "All"). Bands: ≤ −0.5 strong sell · ≤ −0.1 sell ·
//  < 0.1 neutral · < 0.5 buy · else strong buy.
//
//  Pivots (five families, the period BEFORE the current one — daily pivots
//  under intraday frames, monthly under the daily frame):
//    Classic    P=(H+L+C)/3  R1=2P−L  S1=2P−H  R2=P+(H−L)  S2=P−(H−L)  R3=H+2(P−L)  S3=L−2(H−P)
//    Fibonacci  P=(H+L+C)/3  R1/S1=P±0.382(H−L)  R2/S2=P±0.618(H−L)  R3/S3=P±(H−L)
//    Camarilla  P=(H+L+C)/3  R1/S1=C±1.1(H−L)/12  R2/S2=C±1.1(H−L)/6  R3/S3=C±1.1(H−L)/4
//    Woodie     P=(H+L+2·O)/4 (O = the CURRENT period's open)  R1=2P−L  S1=2P−H  R2=P+(H−L)  S2=P−(H−L)  R3=H+2(P−L)  S3=L−2(H−P)
//    DM         X = H+2L+C (C<O) · 2H+L+C (C>O) · H+L+2C (C=O);  P=X/4  R1=X/2−L  S1=X/2−H  (no R2/R3)
// ─────────────────────────────────────────────────────────────────────────

import type { Candle, ChartSource, ChartTf } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'

export type Signal = 'buy' | 'neutral' | 'sell'
export type Rating = 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy'

export interface Gauge {
  rating: Rating
  /** −1..1 — the mean vote. */
  score: number
  buy: number
  neutral: number
  sell: number
}

export interface Row {
  name: string
  value: number
  signal: Signal
}

export interface Pivots {
  p: number
  r1: number
  s1: number
  r2?: number
  s2?: number
  r3?: number
  s3?: number
}

export type PivotFamily = 'classic' | 'fibonacci' | 'camarilla' | 'woodie' | 'dm'

export interface PivotSet {
  /** What the levels were derived from (the previous completed period). */
  period: 'day' | 'month'
  /** Unix seconds — the start of the period the levels are built from. */
  from: number
  classic: Pivots
  fibonacci: Pivots
  camarilla: Pivots
  woodie: Pivots
  dm: Pivots
}

export interface Technicals {
  summary: Gauge
  oscillators: Gauge
  movingAverages: Gauge
  rows: { oscillators: Row[]; movingAverages: Row[] }
  /** Indicators the tape was too short for — never counted as neutral. */
  omitted: string[]
  pivots: PivotSet | null
  /** Bars the verdict was computed over. */
  bars: number
  /** Last close (the price every MA row is compared to). */
  last: number
}

export const RATING_LABELS: Record<Rating, string> = {
  strong_sell: 'Strong sell',
  sell: 'Sell',
  neutral: 'Neutral',
  buy: 'Buy',
  strong_buy: 'Strong buy',
}

// ── Series primitives (all return arrays aligned to the input; NaN before
//    the indicator has enough bars) ────────────────────────────────────────

const NaNs = (n: number): number[] => new Array<number>(n).fill(NaN)

/** NaN-aware: a window that contains a NaN (an upstream indicator's warm-up)
 *  yields NaN instead of poisoning every later bar. */
export function sma(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  if (n <= 0) return out
  let sum = 0
  let run = 0 // consecutive finite values ending at i
  for (let i = 0; i < src.length; i++) {
    if (!Number.isFinite(src[i])) {
      sum = 0
      run = 0
      continue
    }
    sum += src[i]
    run++
    if (run > n) {
      sum -= src[i - n]
      run = n
    }
    if (run >= n) out[i] = sum / n
  }
  return out
}

/** EMA seeded with the SMA of the first n bars (TradingView's ta.ema). */
export function ema(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  if (n <= 0 || src.length < n) return out
  const alpha = 2 / (n + 1)
  let seed = 0
  for (let i = 0; i < n; i++) seed += src[i]
  out[n - 1] = seed / n
  for (let i = n; i < src.length; i++) out[i] = alpha * src[i] + (1 - alpha) * out[i - 1]
  return out
}

/** Wilder's smoothing (RMA), SMA-seeded — RSI, ADX and ATR run on it. */
export function rma(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  if (n <= 0 || src.length < n) return out
  let seed = 0
  for (let i = 0; i < n; i++) seed += src[i]
  out[n - 1] = seed / n
  for (let i = n; i < src.length; i++) out[i] = (out[i - 1] * (n - 1) + src[i]) / n
  return out
}

export function wma(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  if (n <= 0) return out
  const denom = (n * (n + 1)) / 2
  for (let i = n - 1; i < src.length; i++) {
    let acc = 0
    for (let k = 0; k < n; k++) acc += src[i - k] * (n - k)
    out[i] = acc / denom
  }
  return out
}

export function hull(src: number[], n: number): number[] {
  const half = wma(src, Math.floor(n / 2))
  const full = wma(src, n)
  const diff = src.map((_, i) => 2 * half[i] - full[i])
  return wma(diff, Math.max(1, Math.round(Math.sqrt(n))))
}

export function vwma(close: number[], volume: number[], n: number): number[] {
  const pv = close.map((c, i) => c * (volume[i] || 0))
  const a = sma(pv, n)
  const b = sma(volume.map((v) => v || 0), n)
  return a.map((x, i) => (b[i] > 0 ? x / b[i] : NaN))
}

function highest(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  for (let i = n - 1; i < src.length; i++) {
    let m = -Infinity
    for (let k = 0; k < n; k++) m = Math.max(m, src[i - k])
    out[i] = m
  }
  return out
}

function lowest(src: number[], n: number): number[] {
  const out = NaNs(src.length)
  for (let i = n - 1; i < src.length; i++) {
    let m = Infinity
    for (let k = 0; k < n; k++) m = Math.min(m, src[i - k])
    out[i] = m
  }
  return out
}

function sum(src: number[], n: number): number[] {
  return sma(src, n).map((x) => x * n)
}

export function rsi(close: number[], n = 14): number[] {
  const gains = close.map((c, i) => (i === 0 ? 0 : Math.max(c - close[i - 1], 0)))
  const losses = close.map((c, i) => (i === 0 ? 0 : Math.max(close[i - 1] - c, 0)))
  // The first bar has no change; smooth from bar 1 like ta.rsi does.
  const g = rma(gains.slice(1), n)
  const l = rma(losses.slice(1), n)
  const out = NaNs(close.length)
  for (let i = 0; i < g.length; i++) {
    if (Number.isNaN(g[i]) || Number.isNaN(l[i])) continue
    out[i + 1] = l[i] === 0 ? 100 : g[i] === 0 ? 0 : 100 - 100 / (1 + g[i] / l[i])
  }
  return out
}

export function stochastic(high: number[], low: number[], close: number[], n = 14, kSmooth = 3, dSmooth = 3): { k: number[]; d: number[] } {
  const hh = highest(high, n)
  const ll = lowest(low, n)
  const raw = close.map((c, i) => {
    const range = hh[i] - ll[i]
    return Number.isNaN(range) ? NaN : range === 0 ? 50 : ((c - ll[i]) / range) * 100
  })
  const k = sma(raw, kSmooth)
  const d = sma(k, dSmooth)
  return { k, d }
}

export function cci(high: number[], low: number[], close: number[], n = 20): number[] {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3)
  const avg = sma(tp, n)
  const out = NaNs(close.length)
  for (let i = n - 1; i < tp.length; i++) {
    let dev = 0
    for (let k = 0; k < n; k++) dev += Math.abs(tp[i - k] - avg[i])
    dev /= n
    out[i] = dev === 0 ? 0 : (tp[i] - avg[i]) / (0.015 * dev)
  }
  return out
}

export function adx(high: number[], low: number[], close: number[], diLen = 14, adxLen = 14): { adx: number[]; plusDi: number[]; minusDi: number[] } {
  const len = close.length
  const tr = NaNs(len)
  const pdm = NaNs(len)
  const mdm = NaNs(len)
  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1]
    const down = low[i - 1] - low[i]
    pdm[i] = up > down && up > 0 ? up : 0
    mdm[i] = down > up && down > 0 ? down : 0
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))
  }
  const trS = rma(tr.slice(1), diLen)
  const pS = rma(pdm.slice(1), diLen)
  const mS = rma(mdm.slice(1), diLen)
  const plusDi = NaNs(len)
  const minusDi = NaNs(len)
  const dx = NaNs(len)
  for (let i = 0; i < trS.length; i++) {
    if (Number.isNaN(trS[i])) continue
    const p = trS[i] === 0 ? 0 : (100 * pS[i]) / trS[i]
    const m = trS[i] === 0 ? 0 : (100 * mS[i]) / trS[i]
    plusDi[i + 1] = p
    minusDi[i + 1] = m
    dx[i + 1] = p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)
  }
  const firstDx = dx.findIndex((x) => !Number.isNaN(x))
  const out = NaNs(len)
  if (firstDx >= 0) {
    const a = rma(dx.slice(firstDx), adxLen)
    for (let i = 0; i < a.length; i++) out[i + firstDx] = a[i]
  }
  return { adx: out, plusDi, minusDi }
}

export function awesome(high: number[], low: number[]): number[] {
  const hl2 = high.map((h, i) => (h + low[i]) / 2)
  const fast = sma(hl2, 5)
  const slow = sma(hl2, 34)
  return fast.map((f, i) => f - slow[i])
}

export function momentum(close: number[], n = 10): number[] {
  return close.map((c, i) => (i >= n ? c - close[i - n] : NaN))
}

export function macd(close: number[], fast = 12, slow = 26, signal = 9): { macd: number[]; signal: number[] } {
  const f = ema(close, fast)
  const s = ema(close, slow)
  const line = f.map((x, i) => x - s[i])
  const firstValid = line.findIndex((x) => !Number.isNaN(x))
  const sig = NaNs(close.length)
  if (firstValid >= 0) {
    const e = ema(line.slice(firstValid), signal)
    for (let i = 0; i < e.length; i++) sig[i + firstValid] = e[i]
  }
  return { macd: line, signal: sig }
}

export function stochRsi(close: number[], kSmooth = 3, dSmooth = 3, rsiLen = 14, stochLen = 14): { k: number[]; d: number[] } {
  const r = rsi(close, rsiLen)
  const firstValid = r.findIndex((x) => !Number.isNaN(x))
  const k = NaNs(close.length)
  const d = NaNs(close.length)
  if (firstValid < 0) return { k, d }
  const rr = r.slice(firstValid)
  const hh = highest(rr, stochLen)
  const ll = lowest(rr, stochLen)
  const raw = rr.map((x, i) => {
    const range = hh[i] - ll[i]
    return Number.isNaN(range) ? NaN : range === 0 ? 50 : ((x - ll[i]) / range) * 100
  })
  const kk = sma(raw, kSmooth)
  const dd = sma(kk, dSmooth)
  for (let i = 0; i < kk.length; i++) {
    k[i + firstValid] = kk[i]
    d[i + firstValid] = dd[i]
  }
  return { k, d }
}

export function williamsR(high: number[], low: number[], close: number[], n = 14): number[] {
  const hh = highest(high, n)
  const ll = lowest(low, n)
  return close.map((c, i) => {
    const range = hh[i] - ll[i]
    return Number.isNaN(range) ? NaN : range === 0 ? -50 : ((hh[i] - c) / range) * -100
  })
}

export function bullBearPower(high: number[], low: number[], close: number[], n = 13): { bull: number[]; bear: number[]; ema: number[] } {
  const e = ema(close, n)
  return { bull: high.map((h, i) => h - e[i]), bear: low.map((l, i) => l - e[i]), ema: e }
}

export function ultimateOscillator(high: number[], low: number[], close: number[], a = 7, b = 14, c = 28): number[] {
  const len = close.length
  const bp = NaNs(len)
  const tr = NaNs(len)
  for (let i = 1; i < len; i++) {
    const pc = close[i - 1]
    bp[i] = close[i] - Math.min(low[i], pc)
    tr[i] = Math.max(high[i], pc) - Math.min(low[i], pc)
  }
  const bp1 = bp.slice(1)
  const tr1 = tr.slice(1)
  const avg = (n: number) => {
    const sb = sum(bp1, n)
    const st = sum(tr1, n)
    return sb.map((x, i) => (st[i] > 0 ? x / st[i] : NaN))
  }
  const a1 = avg(a)
  const a2 = avg(b)
  const a3 = avg(c)
  const out = NaNs(len)
  for (let i = 0; i < a1.length; i++) {
    const v = (100 * (4 * a1[i] + 2 * a2[i] + a3[i])) / 7
    out[i + 1] = v
  }
  return out
}

export function ichimoku(high: number[], low: number[], conv = 9, base = 26, span = 52): { conversion: number[]; base: number[]; leadA: number[]; leadB: number[] } {
  const mid = (n: number) => {
    const hh = highest(high, n)
    const ll = lowest(low, n)
    return hh.map((h, i) => (h + ll[i]) / 2)
  }
  const c = mid(conv)
  const b = mid(base)
  const leadA = c.map((x, i) => (x + b[i]) / 2)
  const leadB = mid(span)
  return { conversion: c, base: b, leadA, leadB }
}

// ── Rating ────────────────────────────────────────────────────────────────

export function bandOf(score: number): Rating {
  if (score <= -0.5) return 'strong_sell'
  if (score <= -0.1) return 'sell'
  if (score < 0.1) return 'neutral'
  if (score < 0.5) return 'buy'
  return 'strong_buy'
}

export function gaugeOf(signals: Signal[]): Gauge {
  const buy = signals.filter((s) => s === 'buy').length
  const sell = signals.filter((s) => s === 'sell').length
  const neutral = signals.length - buy - sell
  const score = signals.length ? (buy - sell) / signals.length : 0
  return { rating: bandOf(score), score, buy, neutral, sell }
}

const last = (a: number[]) => a[a.length - 1]
const prev = (a: number[]) => a[a.length - 2]
const ok = (...xs: number[]) => xs.every((x) => Number.isFinite(x))
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp

/** Decimals a printed level keeps — ticks on a $0.02 coin are not $1 ticks. */
export function priceDecimals(price: number): number {
  const a = Math.abs(price)
  if (a >= 1000) return 2
  if (a >= 1) return 2
  if (a >= 0.01) return 4
  return 6
}

/** A price the parsers accept verbatim: NO thousands separator (a "$2,410"
 *  reads as $2 to the spot-guard grammar), trailing zeros trimmed. */
export function askPrice(price: number): string {
  return String(round(price, priceDecimals(price)))
}

interface Ctx {
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

function oscillatorRows(x: Ctx): { rows: Row[]; omitted: string[] } {
  const rows: Row[] = []
  const omitted: string[] = []
  const push = (name: string, value: number, signal: Signal, ready: boolean) => {
    if (!ready) omitted.push(name)
    else rows.push({ name, value: round(value, 4), signal })
  }
  const sig = (buy: boolean, sell: boolean): Signal => (buy ? 'buy' : sell ? 'sell' : 'neutral')

  const r = rsi(x.close, 14)
  push('RSI (14)', last(r), sig(last(r) < 30 && last(r) > prev(r), last(r) > 70 && last(r) < prev(r)), ok(last(r), prev(r)))

  const st = stochastic(x.high, x.low, x.close, 14, 3, 3)
  const k = last(st.k)
  const d = last(st.d)
  push('Stochastic %K (14, 3, 3)', k, sig(k < 20 && d < 20 && k > d, k > 80 && d > 80 && k < d), ok(k, d))

  const c = cci(x.high, x.low, x.close, 20)
  push('CCI (20)', last(c), sig(last(c) < -100 && last(c) > prev(c), last(c) > 100 && last(c) < prev(c)), ok(last(c), prev(c)))

  const a = adx(x.high, x.low, x.close, 14, 14)
  const ad = last(a.adx)
  push(
    'ADX (14)',
    ad,
    sig(
      last(a.plusDi) > last(a.minusDi) && ad > 20 && ad > prev(a.adx),
      last(a.plusDi) < last(a.minusDi) && ad > 20 && ad < prev(a.adx),
    ),
    ok(ad, prev(a.adx), last(a.plusDi), last(a.minusDi)),
  )

  const ao = awesome(x.high, x.low)
  const ao0 = last(ao)
  const ao1 = prev(ao)
  const ao2 = ao[ao.length - 3]
  push(
    'Awesome Oscillator',
    ao0,
    sig(
      (ao1 <= 0 && ao0 > 0) || (ao0 > 0 && ao1 > 0 && ao0 > ao1 && ao1 < ao2),
      (ao1 >= 0 && ao0 < 0) || (ao0 < 0 && ao1 < 0 && ao0 < ao1 && ao1 > ao2),
    ),
    ok(ao0, ao1, ao2),
  )

  const m = momentum(x.close, 10)
  push('Momentum (10)', last(m), sig(last(m) > prev(m), last(m) < prev(m)), ok(last(m), prev(m)))

  const md = macd(x.close, 12, 26, 9)
  push('MACD Level (12, 26)', last(md.macd), sig(last(md.macd) > last(md.signal), last(md.macd) < last(md.signal)), ok(last(md.macd), last(md.signal)))

  const trendEma = ema(x.close, 13)
  const up = last(trendEma) > prev(trendEma)
  const down = last(trendEma) < prev(trendEma)
  const trendReady = ok(last(trendEma), prev(trendEma))

  const sr = stochRsi(x.close, 3, 3, 14, 14)
  const sk = last(sr.k)
  const sd = last(sr.d)
  push('Stochastic RSI Fast (3, 3, 14, 14)', sk, sig(down && sk < 20 && sd < 20 && sk > sd, up && sk > 80 && sd > 80 && sk < sd), ok(sk, sd) && trendReady)

  const w = williamsR(x.high, x.low, x.close, 14)
  push('Williams %R (14)', last(w), sig(last(w) < -80 && last(w) > prev(w), last(w) > -20 && last(w) < prev(w)), ok(last(w), prev(w)))

  const bb = bullBearPower(x.high, x.low, x.close, 13)
  const bull = last(bb.bull)
  const bear = last(bb.bear)
  push(
    'Bull Bear Power',
    bull + bear,
    sig(up && bear < 0 && bear > prev(bb.bear), down && bull > 0 && bull < prev(bb.bull)),
    ok(bull, bear, prev(bb.bull), prev(bb.bear)) && trendReady,
  )

  const uo = ultimateOscillator(x.high, x.low, x.close, 7, 14, 28)
  push('Ultimate Oscillator (7, 14, 28)', last(uo), sig(last(uo) > 70, last(uo) < 30), ok(last(uo)))

  return { rows, omitted }
}

function movingAverageRows(x: Ctx): { rows: Row[]; omitted: string[] } {
  const rows: Row[] = []
  const omitted: string[] = []
  const price = last(x.close)
  const maRow = (name: string, series: number[]) => {
    const v = last(series)
    if (!Number.isFinite(v)) omitted.push(name)
    else rows.push({ name, value: round(v, 6), signal: v < price ? 'buy' : v > price ? 'sell' : 'neutral' })
  }
  for (const n of [10, 20, 30, 50, 100, 200]) {
    maRow(`Exponential Moving Average (${n})`, ema(x.close, n))
    maRow(`Simple Moving Average (${n})`, sma(x.close, n))
  }
  const ich = ichimoku(x.high, x.low, 9, 26, 52)
  const conv = last(ich.conversion)
  const base = last(ich.base)
  const la = last(ich.leadA)
  const lb = last(ich.leadB)
  if (!ok(conv, base, la, lb)) omitted.push('Ichimoku Base Line (9, 26, 52, 26)')
  else {
    const buy = la > lb && base > la && conv > base && price > conv
    const sell = la < lb && base < la && conv < base && price < conv
    rows.push({ name: 'Ichimoku Base Line (9, 26, 52, 26)', value: round(base, 6), signal: buy ? 'buy' : sell ? 'sell' : 'neutral' })
  }
  maRow('Volume Weighted Moving Average (20)', vwma(x.close, x.volume, 20))
  maRow('Hull Moving Average (9)', hull(x.close, 9))
  return { rows, omitted }
}

// ── Pivots ────────────────────────────────────────────────────────────────

export function classicPivots(h: number, l: number, c: number): Pivots {
  const p = (h + l + c) / 3
  return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) }
}

export function fibonacciPivots(h: number, l: number, c: number): Pivots {
  const p = (h + l + c) / 3
  const r = h - l
  return { p, r1: p + 0.382 * r, s1: p - 0.382 * r, r2: p + 0.618 * r, s2: p - 0.618 * r, r3: p + r, s3: p - r }
}

export function camarillaPivots(h: number, l: number, c: number): Pivots {
  const p = (h + l + c) / 3
  const r = (h - l) * 1.1
  return { p, r1: c + r / 12, s1: c - r / 12, r2: c + r / 6, s2: c - r / 6, r3: c + r / 4, s3: c - r / 4 }
}

export function woodiePivots(h: number, l: number, currentOpen: number): Pivots {
  const p = (h + l + 2 * currentOpen) / 4
  return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) }
}

export function dmPivots(h: number, l: number, c: number, o: number): Pivots {
  const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c
  return { p: x / 4, r1: x / 2 - l, s1: x / 2 - h }
}

const DAY = 86400
/** Period key of a candle open time: UTC day or UTC month. */
function periodKey(t: number, period: 'day' | 'month'): number {
  if (period === 'day') return Math.floor(t / DAY) * DAY
  const d = new Date(t * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

/** The five pivot families from the last COMPLETED period on the tape.
 *  Intraday frames use daily pivots, the daily frame monthly (the usual
 *  auto choice). Null when the tape holds no completed earlier period. */
export function pivotsFor(candles: Candle[], tf: ChartTf): PivotSet | null {
  if (candles.length < 2) return null
  const period: 'day' | 'month' = tf === '1d' ? 'month' : 'day'
  const lastKey = periodKey(candles[candles.length - 1].t, period)
  let h = -Infinity
  let l = Infinity
  let c = NaN
  let o = NaN
  let from = NaN
  let currentOpen = NaN
  let prevKey = NaN
  for (const k of candles) {
    const key = periodKey(k.t, period)
    if (key === lastKey) {
      if (Number.isNaN(currentOpen)) currentOpen = k.o
      continue
    }
    if (key !== prevKey) {
      // a new earlier period starts — reset (we want the LAST one before now)
      prevKey = key
      h = k.h
      l = k.l
      o = k.o
      from = key
    } else {
      h = Math.max(h, k.h)
      l = Math.min(l, k.l)
    }
    c = k.c
  }
  if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(currentOpen)) return null
  const roundAll = (p: Pivots): Pivots => {
    const dp = priceDecimals(c)
    const r: Pivots = { p: round(p.p, dp), r1: round(p.r1, dp), s1: round(p.s1, dp) }
    if (p.r2 !== undefined) r.r2 = round(p.r2, dp)
    if (p.s2 !== undefined) r.s2 = round(p.s2, dp)
    if (p.r3 !== undefined) r.r3 = round(p.r3, dp)
    if (p.s3 !== undefined) r.s3 = round(p.s3, dp)
    return r
  }
  return {
    period,
    from,
    classic: roundAll(classicPivots(h, l, c)),
    fibonacci: roundAll(fibonacciPivots(h, l, c)),
    camarilla: roundAll(camarillaPivots(h, l, c)),
    woodie: roundAll(woodiePivots(h, l, currentOpen)),
    dm: roundAll(dmPivots(h, l, c, o)),
  }
}

// ── The verdict ───────────────────────────────────────────────────────────

/** Fewest bars a verdict is allowed to stand on (the 200-period MAs need
 *  200; below this the oscillators alone would be voting). */
export const MIN_BARS = 40

export function computeTechnicals(candles: Candle[], tf: ChartTf): Technicals | null {
  const clean = candles.filter((k) => [k.o, k.h, k.l, k.c].every(Number.isFinite))
  if (clean.length < MIN_BARS) return null
  const x: Ctx = {
    high: clean.map((k) => k.h),
    low: clean.map((k) => k.l),
    close: clean.map((k) => k.c),
    volume: clean.map((k) => (Number.isFinite(k.v) ? k.v : 0)),
  }
  const osc = oscillatorRows(x)
  const ma = movingAverageRows(x)
  const oscillators = gaugeOf(osc.rows.map((r) => r.signal))
  const movingAverages = gaugeOf(ma.rows.map((r) => r.signal))
  const score = (oscillators.score + movingAverages.score) / 2
  const summary: Gauge = {
    rating: bandOf(score),
    score,
    buy: oscillators.buy + movingAverages.buy,
    neutral: oscillators.neutral + movingAverages.neutral,
    sell: oscillators.sell + movingAverages.sell,
  }
  return {
    summary,
    oscillators,
    movingAverages,
    rows: { oscillators: osc.rows, movingAverages: ma.rows },
    omitted: [...osc.omitted, ...ma.omitted],
    pivots: pivotsFor(clean, tf),
    bars: clean.length,
    last: last(x.close),
  }
}

// ── Chips — the verdict as a button ───────────────────────────────────────
// Every ask below is a sentence an EXISTING parser claims natively (pinned
// through scripts/ask-ladder.ts): swap ("Buy $25 of AAPL"), dca, spot-guard
// ("Protect my spot ETH with a 5% stop" / "… if it drops to $S1"), the HL
// guardian ("Protect my HYPE long …") and HL opens ("Long $25 of HYPE on
// Hyperliquid"). Perp-only coins and coins whose real home is another chain
// (lib/token-home) take the Hyperliquid forms — a spot chip for SOL would
// book a Base squat.

export type ChipKind = 'buy' | 'sell' | 'stop' | 'limit' | 'dca' | 'protect'
export interface ChartAction {
  kind: ChipKind
  ask: string
  /** The words on the button. */
  label: string
}

export interface ChipInput {
  symbol: string
  source: ChartSource
  rating: Rating
  /** Classic S1 — the level a neutral verdict's stop sits under. */
  support?: number | null
}

export function verdictChips(input: ChipInput): ChartAction[] {
  const sym = input.symbol.toUpperCase()
  const perp = input.source === 'hyperliquid' || !!tokenHome(sym)
  const s1 = input.support != null && Number.isFinite(input.support) && input.support > 0 ? askPrice(input.support) : null
  const buy: ChartAction = perp
    ? { kind: 'buy', ask: `Long $25 of ${sym} on Hyperliquid`, label: `Long $25 of ${sym}` }
    : { kind: 'buy', ask: `Buy $25 of ${sym}`, label: `Buy $25 of ${sym}` }
  const sell: ChartAction = perp
    ? { kind: 'sell', ask: `Short $50 of ${sym} on Hyperliquid`, label: `Short $50 of ${sym}` }
    : { kind: 'sell', ask: `Sell $50 of ${sym}`, label: `Sell $50 of ${sym}` }
  const protectPct: ChartAction = perp
    ? { kind: 'protect', ask: `Protect my ${sym} long with a 5% stop`, label: 'Protect with a 5% stop' }
    : { kind: 'protect', ask: `Protect my spot ${sym} with a 5% stop`, label: 'Protect with a 5% stop' }
  const dca: ChartAction | null = perp ? null : { kind: 'dca', ask: `DCA $10 into ${sym} weekly`, label: 'DCA $10 weekly' }
  const stopAtS1: ChartAction | null = s1
    ? perp
      ? { kind: 'stop', ask: `Protect my ${sym} long with a stop at $${s1}`, label: `Stop under S1 · $${s1}` }
      : { kind: 'stop', ask: `Protect my spot ${sym} if it drops to $${s1}`, label: `Stop under S1 · $${s1}` }
    : null
  switch (input.rating) {
    case 'strong_sell':
    case 'sell':
      return [sell, protectPct]
    case 'strong_buy':
    case 'buy':
      return dca ? [buy, dca] : [buy, protectPct]
    default:
      return [stopAtS1 ?? protectPct, ...(dca ? [dca] : [])]
  }
}

// ── The wire shape of GET /api/charts/technicals (README "Technicals") ──
export interface TechnicalsApi {
  symbol: string
  label: string | null
  source: ChartSource | null
  /** The upstream that actually served the tape (stocks fall back to Yahoo). */
  feed: string | null
  feedLabel: string | null
  tf: ChartTf
  /** Frames the candle proxy serves — the honest timeframe strip. */
  tfs: ChartTf[]
  asOf: number
  bars: number
  last: number | null
  summary: Gauge
  oscillators: Gauge
  movingAverages: Gauge
  rows: { oscillators: Row[]; movingAverages: Row[] }
  omitted: string[]
  pivots: Omit<PivotSet, 'period' | 'from'> | null
  pivotPeriod: PivotSet['period'] | null
  pivotFrom: number | null
  chips: ChartAction[]
}

/** A named refusal from the same route (chartless / feed down / short tape). */
export interface TechnicalsRefusal {
  symbol: string
  tf: ChartTf
  tfs: ChartTf[]
  error: 'no chart source' | 'feed unavailable' | 'tape too short'
  reason: string
  chips: []
}
