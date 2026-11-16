// THE BOARD (squad called-gtm, contract): every scanned account on a market,
// or every market of one account, summarized as BoardEntry rows.
//
// Reads the PUBLIC list only (app/x/_lib/plotted readPlotted over store
// listPlotted: finished scans with at least one call, never an internal run,
// never a hidden handle) and each row's own record (readRecord). A row whose
// record cannot be read is left out; this never throws.
//
// Each entry is held five minutes per handle and market (unstable_cache), so
// a cached page and a public API route can both read it. The background
// re-check for deleted posts is left to the record's own page.
import { unstable_cache } from 'next/cache'
import { loadCandleSeries } from '@/lib/candles-server'
import { defaultRecordDeps, readRecord } from './record'
import { moveLine, type CalledCall } from './spec'
import { bestCallOf, boardCallOf, hitRateWords, rankEntries, type BoardCall, type BoardDot, type BoardEntry } from './gtm'
import { readPlotted } from '@/app/x/_lib/plotted'

const LINE_POINTS = 110
const round = (n: number) => Math.round(n * 100) / 100

/** Pure: closes and calls → the line and the dots in one 100 by 100 box (8% of air above and below). Exported for the pin. */
export function boardSpark(closes: readonly { t: number; c: number }[], calls: readonly Pick<CalledCall, 'postId' | 'barTime' | 'priceAt' | 'verdict'>[], fromSec: number): { line: string; dots: BoardDot[] } {
  const pts = closes.filter((p) => p.t >= fromSec && p.c > 0)
  if (pts.length < 2) return { line: '', dots: [] }
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const prices = [...pts.map((p) => p.c), ...calls.map((c) => c.priceAt).filter((v) => v > 0)]
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const span = hi - lo || 1
  const x = (t: number) => round(Math.min(100, Math.max(0, ((t - t0) / (t1 - t0 || 1)) * 100)))
  const y = (c: number) => round(8 + (1 - (c - lo) / span) * 84)
  const step = Math.max(1, Math.ceil(pts.length / LINE_POINTS))
  const kept = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  const line = `M${kept.map((p) => `${x(p.t)} ${y(p.c)}`).join('L')}`
  const dots = calls.filter((c) => c.barTime >= t0 && c.priceAt > 0).map((c) => ({ x: x(c.barTime), y: y(c.priceAt), verdict: c.verdict, postId: c.postId }))
  return { line, dots }
}

/** Pure: the strongest miss the scan found, or null. */
export function worstCallOf(calls: readonly CalledCall[]): CalledCall | null {
  const misses = calls.filter((c) => c.origin === 'scan' && c.verdict === 'wrong')
  return misses.length ? [...misses].sort((a, b) => b.impact - a.impact || b.postedAt - a.postedAt)[0] : null
}

type Core = Omit<BoardEntry, 'name' | 'avatarUrl' | 'verified' | 'scannedAt'>

async function summarize(handle: string, symbol: string): Promise<Core | null> {
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
  const scanned = rec.calls.filter((c) => c.origin === 'scan')
  const { line, dots } = boardSpark(closes, scanned, Math.floor(rec.window.from / 1000))
  const call = (c: CalledCall | null): BoardCall | null => (c ? boardCallOf(c, moveLine(c)) : null)
  return {
    handle: rec.handle,
    symbol: rec.symbol,
    followers: rec.profile.followers,
    tally: rec.tally,
    headline: rec.words.headline,
    coverage: rec.words.coverage,
    hitRate: hitRateWords(rec.tally),
    line,
    dots,
    best: call(bestCallOf(scanned)),
    worst: call(worstCallOf(scanned)),
  }
}

const cachedEntry = unstable_cache(async (handle: string, symbol: string) => summarize(handle, symbol), ['called-board-entry-v1'], { revalidate: 300 })

export interface BoardQuery {
  /** One market: every scanned account on it. */
  symbol?: string
  /** One account: every market it is scanned on. */
  handle?: string
  /** Rows read from the list (each is a record read on a cold cache). Default 12, never above 24. */
  limit?: number
}

export interface BoardAnswer {
  entries: BoardEntry[]
  /** The list did not load. A page says so; it never invents rows. */
  failed: boolean
}

/** The board, ranked (gtm rankEntries). Never throws. */
export async function readBoard(q: BoardQuery = {}): Promise<BoardAnswer> {
  const limit = Math.max(1, Math.min(24, Math.floor(q.limit ?? 12)))
  const list = await readPlotted({ limit: 50, handle: q.handle })
  const rows = list.rows.filter((r) => (!q.symbol || r.symbol === q.symbol.toUpperCase()) && (!q.handle || r.handle === q.handle)).slice(0, limit)
  const out = await Promise.all(
    rows.map(async (r): Promise<BoardEntry | null> => {
      try {
        const s = await cachedEntry(r.handle, r.symbol)
        return s ? { ...s, name: r.name, avatarUrl: r.avatarUrl, verified: r.verified, scannedAt: r.scannedAt } : null
      } catch {
        return null
      }
    }),
  )
  return { entries: rankEntries(out.filter((e): e is BoardEntry => e !== null)), failed: list.failed }
}
