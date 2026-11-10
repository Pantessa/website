// Index data, parsed (2026-11-09) — the PURE half of the look-only index
// source (lib/charts `index`): what the data host's chart payload means as
// candles and as a quote. No fetch, no clock it is not handed; pinned on
// measured payloads (scripts/macro-pins.ts). lib/candles-server fetches and
// calls `indexCandlesOf`; lib/quotes fetches and calls `indexQuoteOf`.
//
// What the host sends, measured 2026-11-09 on the six symbols:
//   • bars on the EXCHANGE's own grid — the Nasdaq 100's hours open at
//     09:30 New York (:30 past, not :00), the 10-year's at 07:20 Chicago —
//     and a native 4-hour bar on that grid (09:30 and 13:30), so nothing
//     here is bucketed from finer bars;
//   • slots with no trade as nulls (the dollar index's weekend) — dropped;
//   • while the market prints, ONE extra element at the end: a price POINT
//     (open = high = low = close, volume 0) stamped with the time of the
//     last print — 09:43:06, off every grid. After the close the same point
//     carries the official close. Drawn as it comes it is a stray candle
//     whose time moves on every poll, so it is folded into the bar before it
//     (that bar's close IS the latest price; its range stretches to hold it);
//   • a daily bar stamped at the session's open (14:30Z for New York) —
//     re-stamped to midnight UTC of the session's own date, the convention
//     the coin and stock feeds use, so a daily compare line shares its days.
//
// The quote's change is stated against the close of the session BEFORE the
// one the price printed in (lib/quotes yahooQuoteOf has the measurement
// behind that rule), and its session is read off the data: a print inside
// the last INDEX_LIVE_WINDOW_MS means the index is trading — no exchange
// calendar is modelled, so a holiday reads closed by itself.

import type { Candle } from '@/lib/charts'

/** The chart payload fields the index source reads. */
export interface IndexChartPayload {
  meta?: {
    regularMarketPrice?: number
    regularMarketTime?: number
    exchangeTimezoneName?: string
    regularMarketDayHigh?: number
    regularMarketDayLow?: number
  }
  timestamp?: number[]
  indicators?: {
    quote?: {
      open?: (number | null)[]
      high?: (number | null)[]
      low?: (number | null)[]
      close?: (number | null)[]
      volume?: (number | null)[]
    }[]
  }
}

/** A print older than this is outside the index's session (the data is
 *  delayed up to 15 minutes, so a trading index is at most that far behind). */
export const INDEX_LIVE_WINDOW_MS = 20 * 60_000

const DAY_SEC = 86_400

/** Unix seconds → 'YYYY-MM-DD' on the exchange's calendar (New York when the zone is unknown). */
export function exchangeDayOf(timeZone: string | undefined): (t: number) => string {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' } as const
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'America/New_York' })
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'America/New_York' })
  }
  return (t) => {
    const parts = fmt.formatToParts(new Date(t * 1000))
    const part = (type: string) => parts.find((p) => p.type === type)?.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** A bar with no range and no volume: the host's price point, not a bar. */
function isPoint(c: Candle): boolean {
  return c.o === c.h && c.h === c.l && c.l === c.c && !(c.v > 0)
}

/**
 * The payload as candles on the frame's own grid, oldest first. `sec` is the
 * frame's bar length (900 · 3600 · 14400 · 86400). Rows with a hole are
 * dropped; the trailing price point is folded into the bar before it when
 * the two share an exchange day, and otherwise snapped onto that bar's grid
 * (the first print of a session, before its first bar exists) so its time is
 * stable from poll to poll; daily bars are re-stamped to midnight UTC of
 * their session date. Never throws on a malformed payload: [] instead.
 */
export function indexCandlesOf(result: IndexChartPayload | null | undefined, sec: number): Candle[] {
  const q = result?.indicators?.quote?.[0]
  const ts = result?.timestamp
  if (!q || !Array.isArray(ts)) return []
  const rows: Candle[] = []
  ts.forEach((t, i) => {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (!num(t) || !num(o) || !num(h) || !num(l) || !num(c) || !(c > 0)) return
    const v = q.volume?.[i]
    rows.push({ t, o, h, l, c, v: num(v) && v > 0 ? v : 0 })
  })
  rows.sort((a, b) => a.t - b.t)
  if (rows.length === 0) return rows
  const dayOf = exchangeDayOf(result?.meta?.exchangeTimezoneName)

  if (sec >= DAY_SEC) {
    // One bar a session, stamped on its date. Two rows on one date (the
    // host's live daily bar beside a closing point) collapse onto it.
    const byDay = new Map<number, Candle>()
    for (const r of rows) {
      const [y, m, d] = dayOf(r.t).split('-').map(Number)
      const t = Math.floor(Date.UTC(y, m - 1, d) / 1000)
      const cur = byDay.get(t)
      if (!cur) byDay.set(t, { ...r, t })
      else {
        cur.h = Math.max(cur.h, r.h)
        cur.l = Math.min(cur.l, r.l)
        cur.c = r.c
        cur.v += r.v
      }
    }
    return [...byDay.values()].sort((a, b) => a.t - b.t)
  }

  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  if (prev && isPoint(last)) {
    if (dayOf(prev.t) === dayOf(last.t)) {
      // The latest price, or the official close: it belongs to the bar before it.
      rows.pop()
      prev.h = Math.max(prev.h, last.c)
      prev.l = Math.min(prev.l, last.c)
      prev.c = last.c
    } else {
      // A new session's first print: a bar of its own, on the grid the bars before it keep.
      last.t = prev.t + Math.floor((last.t - prev.t) / sec) * sec
    }
  }
  // Two rows can land on one slot after the snap; the later one wins the close.
  const out: Candle[] = []
  for (const r of rows) {
    const tail = out[out.length - 1]
    if (tail && tail.t === r.t) {
      tail.h = Math.max(tail.h, r.h)
      tail.l = Math.min(tail.l, r.l)
      tail.c = r.c
      tail.v += r.v
    } else out.push(r)
  }
  return out
}

export interface IndexQuote {
  last: number
  /** The close of the session before the one `last` printed in; null when the bars hold no earlier session. */
  prev: number | null
  /** When the price printed, ms. */
  asOf: number
  /** The index is trading now (a print inside the live window). */
  live: boolean
  /** The printing session's range, when the host states one around the last. */
  dayHigh: number | null
  dayLow: number | null
}

/**
 * A DAILY payload (interval 1d, a week of bars) as a quote. The last is the
 * host's own regular-market price; `prev` is the close of the last daily bar
 * dated BEFORE the day that price printed, on the exchange's calendar — so
 * it holds while today's bar has no close yet (an index 15 minutes behind
 * its open) and across a weekend. Null when the payload carries no price.
 */
export function indexQuoteOf(result: IndexChartPayload | null | undefined, nowMs: number): IndexQuote | null {
  const meta = result?.meta
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const bars = (result?.timestamp ?? [])
    .map((t, i) => ({ t, c: closes[i] }))
    .filter((b): b is { t: number; c: number } => num(b.t) && num(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t)
  const last = Number(meta?.regularMarketPrice ?? bars[bars.length - 1]?.c)
  const printedAt = meta?.regularMarketTime || bars[bars.length - 1]?.t
  if (!num(last) || !(last > 0) || !printedAt) return null
  const dayOf = exchangeDayOf(meta?.exchangeTimezoneName)
  const session = dayOf(printedAt)
  const before = bars.filter((b) => dayOf(b.t) < session)
  const prev = before.length > 0 ? before[before.length - 1].c : null
  const hi = meta?.regularMarketDayHigh
  const lo = meta?.regularMarketDayLow
  // The host's day range is only printed when it brackets the price it came with.
  const ranged = num(hi) && num(lo) && lo > 0 && hi >= lo && last <= hi * 1.0001 && last >= lo * 0.9999
  return {
    last,
    prev,
    asOf: printedAt * 1000,
    live: nowMs - printedAt * 1000 < INDEX_LIVE_WINDOW_MS,
    dayHigh: ranged ? (hi as number) : null,
    dayLow: ranged ? (lo as number) : null,
  }
}
