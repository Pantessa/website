// THE TOUR · lane SIDES-B's pure rules (squad landing, 2026-11-10). Every
// number the Autopilots panel prints is worked out here from a rule the
// product itself runs — and each helper is pinned against that rule's own
// function in scripts/landing-sides-b-pins.ts, so a change over there turns
// the pin red instead of leaving the landing telling an old story.
//
// Pure and client-safe: no fetch, no clock it isn't handed, no DOM.

/** The cadences a recurring buy takes (lib/dca DcaCadence, restated so this
 *  file imports nothing; the pin checks the two lists agree). */
export type Cadence = 'day' | 'week' | 'month'

/**
 * When the NEXT period of a recurring buy opens.
 *
 * The product's rule (lib/dca periodKeyFor): periods are UTC calendar
 * periods — a UTC day, an ISO-8601 week (Monday 00:00 UTC), a UTC month.
 * The first period is due the moment a schedule is created (lib/dca-exec:
 * "The first period is due NOW"); a missed period lapses, there is no
 * catch-up. So the next buy unlocks at the first instant whose period key
 * differs from now's. Pinned: periodKeyFor(next − 1 ms) is still this
 * period, periodKeyFor(next) is the following one.
 */
export function nextPeriodStart(cadence: Cadence, at: Date): Date {
  const y = at.getUTCFullYear()
  const m = at.getUTCMonth()
  const d = at.getUTCDate()
  if (cadence === 'day') return new Date(Date.UTC(y, m, d + 1))
  if (cadence === 'month') return new Date(Date.UTC(y, m + 1, 1))
  // ISO week: Monday opens it. getUTCDay(): Sunday = 0 → the 7th day.
  const dow = at.getUTCDay() || 7
  return new Date(Date.UTC(y, m, d + (8 - dow)))
}

/** The next `n` period openings after `at`, in order. */
export function nextPeriodStarts(cadence: Cadence, at: Date, n: number): Date[] {
  const out: Date[] = []
  let cursor = at
  for (let i = 0; i < n; i++) {
    cursor = nextPeriodStart(cadence, cursor)
    out.push(cursor)
  }
  return out
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** "Mon 16 Nov" — a UTC date, spelled without a locale (the server and every
 *  browser print the same string). */
export function fmtUtcDay(at: Date): string {
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** "in 5d 9h" · "in 9h 12m" · "in 12m" · "now". Never negative. */
export function fmtCountdown(ms: number): string {
  if (!(ms > 0)) return 'now'
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / (24 * 60))
  const h = Math.floor((mins % (24 * 60)) / 60)
  const m = mins % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  return m > 0 ? `in ${m}m` : 'in under a minute'
}

/**
 * The price a percent stop closes at.
 *
 * The product's rule (lib/hl-guardian evaluatePolicy): a percent stop is
 * measured FROM ENTRY — a long's stop sits `pct` percent below its entry
 * price and fires when the mark is at or under it; a short's sits above and
 * fires at or over it. Null for a number the guardian would refuse.
 */
export function stopLevel(entry: number, pct: number, side: 'long' | 'short' = 'long'): number | null {
  if (!Number.isFinite(entry) || !(entry > 0) || !Number.isFinite(pct) || !(pct > 0) || pct >= 100) return null
  return side === 'long' ? entry * (1 - pct / 100) : entry * (1 + pct / 100)
}

/**
 * The two prices a percent-move alert fires at.
 *
 * The product's rule (lib/watchlists alertFires, condition `pct_move`): the
 * alert remembers the price it was armed at and fires when the price is
 * `pct` percent away from it in EITHER direction.
 */
export function alertBand(base: number, pct: number): { up: number; down: number } | null {
  if (!Number.isFinite(base) || !(base > 0) || !Number.isFinite(pct) || !(pct > 0) || pct >= 100) return null
  return { up: base * (1 + pct / 100), down: base * (1 - pct / 100) }
}

/** The chains a short wallet is scanned on when a buy needs funding from
 *  elsewhere (lib/funding-plan FUNDING_SCAN_CHAINS: Base, Arbitrum, Optimism,
 *  Ethereum — restated because that module pulls viem's clients into a client
 *  bundle; the pin checks the two lists are equal). */
export const FUND_FROM_CHAIN_IDS = [8453, 42161, 10, 1] as const

/** A line for the small price chart: an SVG path through `points` scaled into
 *  a w × h box whose vertical range also has to hold `levels` (the entry and
 *  the stop sit outside the day's range more often than not). Returns the
 *  path and a y() for the level lines; null with fewer than two points. */
export function levelChart(points: readonly (readonly [number, number])[], levels: readonly number[], w = 320, h = 96, pad = 8): { d: string; y: (v: number) => number } | null {
  const vals = points.map((p) => p[1]).filter((v) => Number.isFinite(v))
  if (vals.length < 2) return null
  const all = [...vals, ...levels.filter((v) => Number.isFinite(v))]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const span = hi - lo || 1
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2)
  const step = w / (vals.length - 1)
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return { d, y }
}

/** "just now" · "12m ago" · "3h ago" · "2d ago" — a post's age. */
export function fmtAge(ms: number): string {
  if (!(ms >= 60_000)) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
