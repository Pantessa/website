// What the /x splash draws for each scanned account: its tally, a small price
// line with a dot per call, and two of its calls in its own words.
//
// Read through unstable_cache (five minutes per handle and market), because
// /x is a cached page and the candle loader reads uncached: inside a cached
// page a bare read is refused, and inside this cache it is allowed. The
// background re-check for deleted posts is left out here (it belongs to a
// record's own page); a summary never claims more than the record does: the
// tally, the headline and the coverage line are the record's own.
import { unstable_cache } from 'next/cache'
import { loadCandleSeries } from '@/lib/candles-server'
import { defaultRecordDeps, readRecord } from '@/lib/called-it/record'
import { moveLine, type CallStance, type CallVerdict, type CalledCall, type CalledTally } from '@/lib/called-it/spec'
import type { PlottedRow } from '@/lib/called-it/store'

export interface SummaryDot {
  /** Percent across (time) and down (price) the plot. */
  x: number
  y: number
  verdict: CallVerdict
  picked: boolean
}

export interface SummaryQuote {
  postId: string
  text: string
  postedAt: number
  verdict: CallVerdict
  stance: CallStance
  /** The record's own words for the move ("-22.4% in 30 days"). */
  move: string
}

export interface PlotSummary {
  handle: string
  symbol: string
  name: string | null
  avatarUrl: string | null
  followers: number | null
  verified: boolean
  scannedAt: number
  tally: CalledTally
  headline: string
  coverage: string | null
  /** An SVG path in a 100 by 100 box (x = time, y = price, top is high). Empty when the chart did not answer. */
  line: string
  dots: SummaryDot[]
  quotes: SummaryQuote[]
}

const LINE_POINTS = 110
const round = (n: number) => Math.round(n * 100) / 100

/** Pure: closes and calls → the line and the dots, both in the same 100 by 100 box. Exported for the pin. */
export function sparkOf(closes: readonly { t: number; c: number }[], calls: readonly Pick<CalledCall, 'barTime' | 'priceAt' | 'verdict' | 'picked'>[], fromSec: number): { line: string; dots: SummaryDot[] } {
  const pts = closes.filter((p) => p.t >= fromSec && p.c > 0)
  if (pts.length < 2) return { line: '', dots: [] }
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const prices = [...pts.map((p) => p.c), ...calls.map((c) => c.priceAt).filter((v) => v > 0)]
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const span = hi - lo || 1
  const x = (t: number) => round(Math.min(100, Math.max(0, ((t - t0) / (t1 - t0 || 1)) * 100)))
  // 8% of air above and below, so a dot at the high or the low is never cut by the box.
  const y = (c: number) => round(8 + (1 - (c - lo) / span) * 84)
  const step = Math.max(1, Math.ceil(pts.length / LINE_POINTS))
  const kept = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  const line = `M${kept.map((p) => `${x(p.t)} ${y(p.c)}`).join('L')}`
  const dots = calls.filter((c) => c.barTime >= t0 && c.priceAt > 0).map((c) => ({ x: x(c.barTime), y: y(c.priceAt), verdict: c.verdict, picked: c.picked }))
  return { line, dots }
}

/** Pure: the two calls a tile quotes. The strongest hit and the strongest miss when both exist, else the two strongest. Exported for the pin. */
export function quotesOf(calls: readonly CalledCall[]): SummaryQuote[] {
  const counted = calls.filter((c) => c.origin === 'scan')
  const by = [...counted].sort((a, b) => b.impact - a.impact)
  const hit = by.find((c) => c.verdict === 'right')
  const miss = by.find((c) => c.verdict === 'wrong')
  const chosen = [hit, miss].filter((c): c is CalledCall => !!c)
  for (const c of by) {
    if (chosen.length >= 2) break
    if (!chosen.includes(c)) chosen.push(c)
  }
  return chosen
    .slice(0, 2)
    .sort((a, b) => a.postedAt - b.postedAt)
    .map((c) => ({ postId: c.postId, text: c.text, postedAt: c.postedAt, verdict: c.verdict, stance: c.stance, move: moveLine(c) }))
}

async function summarize(handle: string, symbol: string): Promise<Omit<PlotSummary, 'name' | 'avatarUrl' | 'verified' | 'scannedAt'> | null> {
  const answer = await readRecord({ handle, symbol }, { ...defaultRecordDeps(), refreshGone: undefined })
  if (answer.body.status !== 'ready') return null
  const rec = answer.body.record
  if (!rec.scanned || rec.tally.total === 0) return null
  let closes: { t: number; c: number }[] = []
  try {
    const loaded = await loadCandleSeries(rec.symbol, '1d', { deep: true })
    closes = loaded ? loaded.series.candles.map((c) => ({ t: c.t, c: c.c })) : []
  } catch {
    closes = []
  }
  const { line, dots } = sparkOf(closes, rec.calls.filter((c) => c.origin === 'scan'), Math.floor(rec.window.from / 1000))
  return { handle: rec.handle, symbol: rec.symbol, followers: rec.profile.followers, tally: rec.tally, headline: rec.words.headline, coverage: rec.words.coverage, line, dots, quotes: quotesOf(rec.calls) }
}

const cachedSummary = unstable_cache(async (handle: string, symbol: string) => summarize(handle, symbol), ['called-splash-summary-v1'], { revalidate: 300 })

/** One summary per listed row, in the list's order. A row whose record cannot be read is left out; this never throws. */
export async function readSummaries(rows: readonly PlottedRow[]): Promise<PlotSummary[]> {
  const out = await Promise.all(
    rows.map(async (r) => {
      try {
        const s = await cachedSummary(r.handle, r.symbol)
        return s ? { ...s, name: r.name, avatarUrl: r.avatarUrl, verified: r.verified, scannedAt: r.scannedAt } : null
      } catch {
        return null
      }
    }),
  )
  return out.filter((s): s is PlotSummary => s !== null)
}

/** The record the hero shows: among the newest few, the one with the most judged calls on BOTH sides of right and wrong. */
export function featuredOf(list: readonly PlotSummary[]): PlotSummary | null {
  const pool = list.slice(0, 8).filter((s) => s.line && s.quotes.length > 0)
  if (!pool.length) return null
  const score = (s: PlotSummary) => Math.min(s.tally.right, s.tally.wrong) * 3 + s.tally.right + s.tally.wrong
  return [...pool].sort((a, b) => score(b) - score(a) || b.scannedAt - a.scannedAt)[0]
}
