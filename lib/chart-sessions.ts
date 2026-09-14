// ─────────────────────────────────────────────────────────────────────────
//  Equity sessions — which part of the US trading day a stock's bar belongs
//  to. Pure + client-safe: MarketChart shades the extended hours behind a
//  stock's intraday candles and quiets those candles, and the harness pins
//  the clock.
//
//  Why (Nate on /t/META 1H, 2026-09-14: "seems like it's missing data"): the
//  Robinhood 24/7 tape prints 16 hourly bars a trading day, 04:00–20:00 ET,
//  and 10 of them are pre- or post-market hours. Those carry a fraction of
//  the regular session's range (median 20–70 bp against 45–120) and volume
//  (6k–50k shares against 0.4M–1.5M). Drawn exactly like the regular bars,
//  they read as holes: a quiet hour is a 1px body on a 1px wick, and the 2px
//  moving average painted over it hides some whole. No bar is missing from
//  the feed; the chart never said which hours were quiet.
//
//  The clock is the exchange's (America/New_York through Intl, so daylight
//  saving is the zone database's job). A bar is REGULAR when any part of it
//  overlaps 9:30–16:00 on a weekday: the 09:00 hourly bar carries the opening
//  print. PRE is 04:00–9:30, POST 16:00–20:00, and everything else (the
//  overnight hours, weekends) is OVERNIGHT. Exchange holidays and half days
//  aren't modeled: a holiday has no bars, and a half day's afternoon reads
//  regular.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartSource, ChartTf } from './charts'

export type EquitySession = 'pre' | 'regular' | 'post' | 'overnight'

/** A frame's bar length in seconds. */
export const FRAME_SEC: Record<ChartTf, number> = { '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 }

/** Session edges in ET minutes after midnight. */
const PRE_OPEN = 4 * 60
const OPEN = 9 * 60 + 30
const CLOSE = 16 * 60
const POST_CLOSE = 20 * 60

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

let etFormat: Intl.DateTimeFormat | null = null
/** Bar open time → ET weekday + minute. A bar's time never changes, so every
 *  poll re-reads the same few hundred bars from here, not from Intl. */
const clockCache = new Map<number, { weekday: number; minute: number }>()
const CLOCK_CACHE_MAX = 20_000

function etClock(t: number): { weekday: number; minute: number } {
  const hit = clockCache.get(t)
  if (hit) return hit
  etFormat ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' })
  let weekday = 0
  let hour = 0
  let minute = 0
  for (const part of etFormat.formatToParts(new Date(t * 1000))) {
    if (part.type === 'weekday') weekday = WEEKDAYS.indexOf(part.value)
    else if (part.type === 'hour') hour = Number(part.value) % 24
    else if (part.type === 'minute') minute = Number(part.value)
  }
  const clock = { weekday, minute: hour * 60 + minute }
  if (clockCache.size >= CLOCK_CACHE_MAX) clockCache.clear()
  clockCache.set(t, clock)
  return clock
}

/** The session a bar opening at `t` (unix seconds) and lasting `spanSec` belongs to. */
export function equitySession(t: number, spanSec: number): EquitySession {
  const { weekday, minute } = etClock(t)
  if (weekday === 0 || weekday === 6) return 'overnight'
  const end = minute + Math.max(1, Math.round(spanSec / 60))
  const overlaps = (from: number, to: number) => minute < to && end > from
  if (overlaps(OPEN, CLOSE)) return 'regular'
  if (overlaps(PRE_OPEN, OPEN)) return 'pre'
  if (overlaps(CLOSE, POST_CLOSE)) return 'post'
  return 'overnight'
}

/** Sessions apply to a stock's intraday frames only: a daily bar is a whole
 *  session, and crypto and perps trade one continuous tape. The Yahoo
 *  fallback tape is still a stock's (source 'robinhood'), so it shades too. */
export function sessionsApply(source: ChartSource | null | undefined, tf: ChartTf): boolean {
  return source === 'robinhood' && tf !== '1d'
}

export interface SessionRun {
  /** First bar index of the run (inclusive). */
  from: number
  /** Last bar index of the run (inclusive). */
  to: number
}

/** Index runs of consecutive bars outside the regular session: one shaded
 *  band each. A Friday's post-market and the next Monday's pre-market sit
 *  side by side on the chart's bar axis, so they are one run. */
export function extendedRuns(sessions: readonly EquitySession[]): SessionRun[] {
  const runs: SessionRun[] = []
  let start = -1
  for (let i = 0; i <= sessions.length; i++) {
    const extended = i < sessions.length && sessions[i] !== 'regular'
    if (extended && start < 0) start = i
    else if (!extended && start >= 0) {
      runs.push({ from: start, to: i - 1 })
      start = -1
    }
  }
  return runs
}
