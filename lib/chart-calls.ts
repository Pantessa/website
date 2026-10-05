// ─────────────────────────────────────────────────────────────────────────
//  A CALL — a chart post read as a public, stamped claim (/c/<id>).
//
//  The post already carries everything a call needs and nothing the author
//  can dress up afterwards:
//    · WHEN   the server's own `createdAt` (never a client clock)
//    · WHAT   the chart state, strict-parsed at write and immutable since
//             (there is no edit route — a changed mind is a new post)
//    · PRICE  read from OUR tape: the close of the last bar that had fully
//             closed before the post. Never a number the poster typed, and
//             never a bar that was still open — a still-open bar's close is
//             the future, and a call must not be flattered with hindsight.
//    · PROOF  the author's own receipt-VERIFIED fills on the symbol
//             (embed_turns.verification = 'verified': the chain confirmed the
//             transaction, its sender and its target). A fill before the
//             stamp is a position held when the call was made.
//
//  The page states the move since the stamp and lets the reader judge it. It
//  never scores a call "right": a line on a chart is not always a direction.
//
//  Pure + client-safe. Pinned by scripts/chart-calls-pins.ts.
// ─────────────────────────────────────────────────────────────────────────

import type { Candle } from './charts'
import type { ChartLine, ChartState } from './chart-state'
import { X_MENTION } from './social'
import { absoluteUrl } from './site-url'

/** The frames the stamp is read on, finest first, with their bar length. */
export const STAMP_FRAMES = [
  { tf: '15m', sec: 900, label: '15-minute' },
  { tf: '1h', sec: 3600, label: 'hourly' },
  { tf: '1d', sec: 86400, label: 'daily' },
] as const

export type StampTf = (typeof STAMP_FRAMES)[number]['tf']

export interface CallStamp {
  /** The tape's price at the call: the last fully closed bar's close. */
  price: number
  /** That bar's open time (unix seconds) and the frame it was read on. */
  barT: number
  tf: StampTf
}

/**
 * The close of the last bar that had FULLY closed at `callT`. A bar that
 * opened before the call and closed after it is skipped (its close postdates
 * the call). A bar older than `maxAgeBars` bars is no stamp at all: a tape
 * with a hole at the call is "no price", never the nearest old one.
 */
export function stampFromBars(candles: Candle[], callT: number, tf: StampTf, maxAgeBars = 6): CallStamp | null {
  const sec = STAMP_FRAMES.find((f) => f.tf === tf)!.sec
  let best: Candle | null = null
  for (const c of candles) {
    if (c.t + sec <= callT && (!best || c.t > best.t)) best = c
  }
  if (!best || !(best.c > 0)) return null
  // Weekends and closed sessions are real gaps on a stock tape: allow the
  // daily frame a long weekend, the finer frames a few bars.
  const reach = tf === '1d' ? 5 * sec : maxAgeBars * sec
  if (callT - (best.t + sec) > reach) return null
  return { price: best.c, barT: best.t, tf }
}

export function movePct(then: number, now: number): number | null {
  return then > 0 && now > 0 ? ((now - then) / then) * 100 : null
}

export function fmtMove(pct: number): string {
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`
}

export function fmtCallPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 5, 2026 · 14:02 UTC" — one clock for every reader. */
export function fmtCallTime(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

/** "3d 4h", "12 min", "just now" — how long a call has stood. */
export function fmtSpan(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return 'under a minute'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}

/** Where a verified fill sits against the stamp. */
export function fillTiming(fillT: number, callT: number): { when: 'before' | 'after'; words: string } {
  const before = fillT <= callT
  return { when: before ? 'before' : 'after', words: `${fmtSpan(Math.abs(callT - fillT))} ${before ? 'before' : 'after'} the call` }
}

/** One verified fill in words: "Bought $25.00 of ETH · Uniswap v3 · Base".
 *  (lib/chart-fills has the chart's own label, but that module is client-only
 *  and the call page is rendered on the server.) */
export function fillWords(f: { side: 'buy' | 'sell'; usd: number | null; venue: string; chain: string | null }, symbol: string): string {
  const amt = f.usd != null && Number.isFinite(f.usd) ? ` $${f.usd >= 100 ? Math.round(f.usd).toLocaleString('en-US') : f.usd.toFixed(2)}` : ''
  return `${f.side === 'buy' ? 'Bought' : 'Sold'}${amt} of ${symbol} · ${f.venue}${f.chain ? ` · ${f.chain}` : ''}`
}

/** The public address of a call. */
export const callPath = (id: string) => `/c/${id}`
export const callUrl = (id: string) => absoluteUrl(callPath(id))

const TWEET_TITLE_MAX = 180

/** The post that goes on X for a stamped call: cashtag, the claim, the page. */
export function callTweetHref(call: { id: string; symbol: string; title: string; verified?: boolean }): string {
  const title = call.title.length > TWEET_TITLE_MAX ? `${call.title.slice(0, TWEET_TITLE_MAX - 1).trimEnd()}…` : call.title
  const text = `$${call.symbol} — ${title}\n\nTime and price stamped${call.verified ? ', position verified on-chain' : ''} on ${X_MENTION}:`
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url: callUrl(call.id) }).toString()}`
}

/** A plain chart share (no call published): the symbol page is the link. */
export function chartTweetHref(symbol: string, tfLabel: string): string {
  const text = `$${symbol} · ${tfLabel} — charted on ${X_MENTION}, where the chart is the order ticket:`
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url: absoluteUrl(`/t/${symbol}`) }).toString()}`
}

// ── the social card's chart (one SVG string; satori draws it as an <img>) ───

export interface CallCardSvgOptions {
  width: number
  height: number
  up: string
  down: string
  grid: string
  ink: string
  accent: string
  sell: string
  /** Trailing candles to draw. */
  count?: number
}

const sellish = (l: ChartLine) => (l.kind === 'h' || l.kind === 'zone') && (l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect')

/**
 * Candles with the call's own lines over them and the stamp as a vertical
 * rule. The price scale is the candles', stretched only as far as a drawn
 * level that sits close to them: the tape stays readable, and a target far
 * above it runs off the top of the picture (it is on the page, in full).
 * No text.
 */
export function callCardSvg(candles: Candle[], state: ChartState | null, callT: number, o: CallCardSvgOptions): string {
  const w = o.width
  const h = o.height
  const pad = { l: 10, r: 10, t: 14, b: 12 }
  const rows = candles.slice(-(o.count ?? 70))
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" stroke="${o.grid}" stroke-width="1"/>`).join('')
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  if (rows.length < 2) return `${open}${grid}</svg>`
  let lo = Infinity
  let hi = -Infinity
  for (const c of rows) {
    if (c.l < lo) lo = c.l
    if (c.h > hi) hi = c.h
  }
  const cLo = lo
  const cHi = hi
  const reach = (cHi - cLo) * 0.6
  const inReach = (p: number) => p >= cLo - reach && p <= cHi + reach
  const lines = state?.lines ?? []
  for (const l of lines) {
    const ps = l.kind === 'h' || l.kind === 'note' ? [l.price] : [l.p1, l.p2]
    for (const p of ps) {
      if (!inReach(p)) continue
      if (p < lo) lo = p
      if (p > hi) hi = p
    }
  }
  if (!(hi > lo)) hi = lo + 1
  const y = (p: number) => pad.t + ((hi - p) / (hi - lo)) * (h - pad.t - pad.b)
  const slot = (w - pad.l - pad.r) / rows.length
  const bar = rows.length > 1 ? Math.max(1, rows[rows.length - 1].t - rows[rows.length - 2].t) : 86400
  const x = (t: number) => pad.l + ((t - rows[0].t) / bar) * slot + slot / 2
  const bodyW = Math.max(2, Math.min(13, slot * 0.62))
  const parts: string[] = [grid]

  const onScale = (p: number) => p >= lo && p <= hi
  for (const l of lines) {
    // A zone shows when any of it is on the scale; the frame clips the rest.
    if (l.kind !== 'zone' || Math.min(l.p1, l.p2) > hi || Math.max(l.p1, l.p2) < lo) continue
    const top = y(Math.max(l.p1, l.p2))
    parts.push(`<rect x="0" y="${top.toFixed(1)}" width="${w}" height="${Math.max(2, y(Math.min(l.p1, l.p2)) - top).toFixed(1)}" fill="${sellish(l) ? o.sell : o.accent}" opacity="0.16"/>`)
  }
  rows.forEach((c, i) => {
    const cx = pad.l + slot * i + slot / 2
    const col = c.c >= c.o ? o.up : o.down
    const top = y(Math.max(c.o, c.c))
    const bh = Math.max(1.5, y(Math.min(c.o, c.c)) - top)
    parts.push(
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`,
      `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${col}"/>`,
    )
  })
  for (const l of lines) {
    if (l.kind === 'h' && onScale(l.price)) {
      const yy = y(l.price).toFixed(1)
      parts.push(`<line x1="0" x2="${w}" y1="${yy}" y2="${yy}" stroke="${sellish(l) ? o.sell : l.action ? o.accent : o.ink}" stroke-width="2"${l.action ? '' : ' stroke-dasharray="8 6"'} opacity="0.95"/>`)
    } else if (l.kind === 'trend') {
      parts.push(`<line x1="${x(l.t1).toFixed(1)}" y1="${y(l.p1).toFixed(1)}" x2="${x(l.t2).toFixed(1)}" y2="${y(l.p2).toFixed(1)}" stroke="${o.ink}" stroke-width="2.5" stroke-linecap="round"/>`)
    } else if (l.kind === 'note' && onScale(l.price)) {
      parts.push(`<circle cx="${x(l.t).toFixed(1)}" cy="${y(l.price).toFixed(1)}" r="6" fill="${o.accent}"/>`)
    }
  }
  // the stamp: where on this tape the call was made
  if (callT >= rows[0].t && callT <= rows[rows.length - 1].t + bar) {
    const cx = Math.max(pad.l, Math.min(w - pad.r, x(callT) - slot / 2)).toFixed(1)
    parts.push(
      `<line x1="${cx}" x2="${cx}" y1="0" y2="${h}" stroke="${o.ink}" stroke-width="2" stroke-dasharray="3 7" opacity="0.7"/>`,
      `<path d="M ${cx} 0 l -9 0 l 9 13 l 9 -13 z" fill="${o.ink}"/>`,
    )
  }
  return `${open}${parts.join('')}</svg>`
}
