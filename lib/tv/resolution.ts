// Frames ↔ the library's resolution strings. Pure, pinned (scripts/tv-pins).
//
// The library names a frame by a string of its own: minutes are bare digits
// ("15", hours too: "60", "240"), seconds end in S, days in D. It upper-cases
// what it is given, so "15m" would be read as fifteen MONTHS: never hand it
// one of our keys.
//
// Our candles endpoint serves five venue frames and one print frame
// (lib/charts CHART_TFS). The library asks the datafeed only for those and
// builds the week and the month from daily bars on its own.

import { CHART_TFS, DEFAULT_CHART_TF, tfsForSource, type ChartSource, type ChartTf } from '@/lib/charts'

const TO_TV: Readonly<Record<ChartTf, string>> = { '10s': '10S', '1m': '1', '15m': '15', '1h': '60', '4h': '240', '1d': '1D' }
const FROM_TV: ReadonlyMap<string, ChartTf> = new Map((Object.keys(TO_TV) as ChartTf[]).map((k) => [TO_TV[k], k]))

/** Frames the library builds itself from our daily bars. */
export const TV_BUILT_RESOLUTIONS: readonly string[] = ['1W', '1M']

export function tvResolution(tf: ChartTf): string {
  return TO_TV[tf]
}

/** The library passes resolutions normalised ("1D", never "D"; "60", never
 *  "1H"), but a URL or a saved layout may not: accept the loose spellings. */
export function normalizeTvResolution(raw: string): string {
  const r = raw.trim().toUpperCase()
  if (r === 'D') return '1D'
  if (r === 'W') return '1W'
  if (r === 'M') return '1M'
  if (r === 'S') return '1S'
  return r
}

/** The frame a resolution is served from, or null when the datafeed does not
 *  serve it (a week, a month, a five-minute bar). */
export function tfOfResolution(raw: string): ChartTf | null {
  return FROM_TV.get(normalizeTvResolution(raw)) ?? null
}

/** The frame the PAGE is on while the library shows `raw`: a week or a month
 *  is drawn from daily bars, so the page's own readers (the header, `?tf=`,
 *  Ask the chart) stay on the day. */
export function pageTfOfResolution(raw: string): ChartTf {
  return tfOfResolution(raw) ?? DEFAULT_CHART_TF
}

/** Every resolution a source's menu offers, finest first. */
export function resolutionsForSource(source: ChartSource | null | undefined): string[] {
  return [...tfsForSource(source).map((t) => TO_TV[t.key]), ...TV_BUILT_RESOLUTIONS]
}

/** Every resolution any source offers (the datafeed's onReady list). */
export const ALL_TV_RESOLUTIONS: readonly string[] = [...CHART_TFS.map((t) => TO_TV[t.key]), ...TV_BUILT_RESOLUTIONS]

/** The minute multipliers a source serves natively, as the digit strings the
 *  library wants, ascending. */
export function intradayMultipliers(source: ChartSource | null | undefined): string[] {
  return tfsForSource(source)
    .map((t) => TO_TV[t.key])
    .filter((r) => /^\d+$/.test(r))
    .sort((a, b) => Number(a) - Number(b))
}

/** Does the source draw a seconds frame (the print frame)? */
export function hasSecondsFrame(source: ChartSource | null | undefined): boolean {
  return tfsForSource(source).some((t) => TO_TV[t.key].endsWith('S'))
}

/** Seconds in one bar of a served frame. */
export const TF_SECONDS: Readonly<Record<ChartTf, number>> = { '10s': 10, '1m': 60, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 }
