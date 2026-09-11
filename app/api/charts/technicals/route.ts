import { NextRequest, NextResponse } from 'next/server'
import { CHART_FEED_LABELS, normalizeChartSymbol, type ChartTf } from '@/lib/charts'
import { loadCandleSeries, resolveTf, CANDLE_TFS } from '@/lib/candles-server'
import { computeTechnicals, verdictChips, type ChartAction, type Gauge, type PivotSet, type Row } from '@/lib/technicals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/charts/technicals?symbol=AAPL&tf=1d — the three gauges (summary ·
// oscillators · moving averages), their rows, five pivot families and the
// verdict chips, computed by lib/technicals from the SAME candle loader the
// chart uses (imported, never HTTP-hopped; a deep load so the 200-bar MAs
// exist). Cached 30s per symbol+tf. Contract: squad-markets README
// "Technicals". Chartless symbols refuse by name; a feed miss is a named
// refusal too — never a 500.

const TTL_MS = 30_000

export interface TechnicalsResponse {
  symbol: string
  label: string | null
  source: string | null
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

interface Refusal {
  symbol: string
  tf: ChartTf
  tfs: ChartTf[]
  error: 'no chart source' | 'feed unavailable' | 'tape too short'
  reason: string
  chips: []
}

const cache = new Map<string, { at: number; body: TechnicalsResponse }>()

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  const tf = resolveTf(req.nextUrl.searchParams.get('tf') ?? '1d')
  const noStore = { headers: { 'cache-control': 'no-store' } }
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400, headers: noStore.headers })
  }
  const symbol = normalizeChartSymbol(symbolRaw)
  const key = `${symbol}:${tf}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, noStore)

  let loaded: Awaited<ReturnType<typeof loadCandleSeries>>
  try {
    loaded = await loadCandleSeries(symbol, tf, { deep: true })
  } catch {
    const body: Refusal = { symbol, tf, tfs: CANDLE_TFS, error: 'feed unavailable', reason: `${symbol}'s candle feed isn't answering right now — the verdict waits for the tape. Try again in a moment.`, chips: [] }
    return NextResponse.json(body, noStore)
  }
  if (!loaded) {
    const body: Refusal = { symbol, tf, tfs: CANDLE_TFS, error: 'no chart source', reason: `${symbol || 'That symbol'} has no candle feed here, so there is nothing to rate — stablecoins chart flat by design, and only listed stocks, Coinbase majors and Hyperliquid perps carry a tape.`, chips: [] }
    return NextResponse.json(body, noStore)
  }
  const { pair, series } = loaded
  const tech = computeTechnicals(series.candles, tf)
  if (!tech) {
    const body: Refusal = { symbol: pair.symbol, tf, tfs: CANDLE_TFS, error: 'tape too short', reason: `${pair.label} has only ${series.candles.length} ${tf} bars on the tape — too few for an honest verdict.`, chips: [] }
    return NextResponse.json(body, noStore)
  }
  const { period, from, ...families } = tech.pivots ?? { period: null, from: null }
  const body: TechnicalsResponse = {
    symbol: pair.symbol,
    label: pair.label,
    source: pair.source,
    feed: series.feed,
    feedLabel: CHART_FEED_LABELS[series.feed] ?? series.feed,
    tf,
    tfs: CANDLE_TFS,
    asOf: Date.now(),
    bars: tech.bars,
    last: tech.last,
    summary: tech.summary,
    oscillators: tech.oscillators,
    movingAverages: tech.movingAverages,
    rows: tech.rows,
    omitted: tech.omitted,
    pivots: tech.pivots ? (families as Omit<PivotSet, 'period' | 'from'>) : null,
    pivotPeriod: period,
    pivotFrom: from,
    chips: verdictChips({ symbol: pair.symbol, source: pair.source, rating: tech.summary.rating, support: tech.pivots?.classic.s1 ?? null }),
  }
  cache.set(key, { at: Date.now(), body })
  return NextResponse.json(body, noStore)
}
