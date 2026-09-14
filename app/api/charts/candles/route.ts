import { NextRequest, NextResponse } from 'next/server'
import { changePct24h, chartPairFor, type Candle, type ChartTf } from '@/lib/charts'
import { MAX_CANDLES, WARMUP_BARS, loadCandleSeries, loadCandlesBefore, resolveTf } from '@/lib/candles-server'
import { warmupBefore } from '@/lib/chart-indicators'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live candle proxy for the chart surfaces — a thin HTTP face over
// lib/candles-server (the fetchers, the cache, the Robinhood→Yahoo fallback
// all live there so /api/charts/technicals can import the same loader
// instead of hopping through this route). The pair resolver is the gate:
// symbols outside lib/charts' map never reach an upstream.
//
// `?warmup=1` adds `warmup`: the WARMUP_BARS bars before the window, for the
// chart's rolling lines (an SMA 200 needs 199 of them to draw at the first
// candle). MarketChart asks once per symbol + frame and polls without it;
// without the flag the response is exactly what it was.
//
// `?before=<unix seconds>` answers one OLDER page instead of the window:
// `older` holds the bars that opened strictly before it (the newest
// PAGE_BARS of them) and `exhausted` says the feed holds nothing older.
// MarketChart asks while a zoom-out or a pan nears the first bar it holds;
// `feed` rides along so a page from a fallback tape is never spliced onto
// the primary's.

const NO_STORE = { 'cache-control': 'no-store' }
/** The earliest `before` worth asking a feed about (2009-01-01). */
const BEFORE_MIN = 1_230_768_000

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  const tf = resolveTf(req.nextUrl.searchParams.get('tf') ?? '1h')
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  }
  const beforeRaw = req.nextUrl.searchParams.get('before')
  if (beforeRaw !== null) return olderPage(symbolRaw, tf, beforeRaw)
  // The deep read (30s cache, shared with the technicals) runs beside the
  // window's; its miss is swallowed here and only leaves `warmup` off.
  const deepLoad = req.nextUrl.searchParams.get('warmup') === '1' ? loadCandleSeries(symbolRaw, tf, { deep: true }).catch(() => null) : null
  let loaded: Awaited<ReturnType<typeof loadCandleSeries>>
  try {
    loaded = await loadCandleSeries(symbolRaw, tf)
  } catch {
    // Feed down, not a 500 — the chart shows its retryable error line.
    const resolved = chartPairFor(symbolRaw)
    return NextResponse.json(
      { symbol: resolved?.symbol ?? symbolRaw.toUpperCase(), label: resolved?.label ?? null, source: resolved?.source ?? null, tf, candles: [], error: 'feed unavailable' },
      { headers: NO_STORE },
    )
  }
  if (!loaded) {
    // Shape-compatible refusal: the client renders the honest empty state.
    return NextResponse.json(
      { symbol: symbolRaw.toUpperCase(), label: null, source: null, tf, candles: [], error: 'no chart source' },
      { headers: NO_STORE },
    )
  }
  const { pair, series } = loaded
  const candles = series.candles.slice(-MAX_CANDLES)
  // Warm-up only from the feed that drew the window: a Yahoo history under a
  // Robinhood window would average two tapes into one line. A deep miss or a
  // different feed leaves the key off, and the chart asks again later.
  const deep = deepLoad ? await deepLoad : null
  const warmup: Candle[] | null = deep && deep.series.feed === series.feed ? warmupBefore(deep.series.candles, candles, WARMUP_BARS) : null
  return NextResponse.json(
    {
      symbol: pair.symbol,
      label: pair.label,
      source: pair.source,
      feed: series.feed,
      tf,
      candles,
      ...(warmup ? { warmup } : {}),
      last: candles.length ? candles[candles.length - 1].c : null,
      changePct24h: changePct24h(candles),
      asOf: Date.now(),
    },
    { headers: NO_STORE },
  )
}

async function olderPage(symbolRaw: string, tf: ChartTf, beforeRaw: string) {
  const before = /^\d{9,10}$/.test(beforeRaw) ? Number(beforeRaw) : NaN
  if (!(before >= BEFORE_MIN && before <= Math.floor(Date.now() / 1000) + 86_400)) {
    return NextResponse.json({ error: 'bad before' }, { status: 400 })
  }
  let loaded: Awaited<ReturnType<typeof loadCandlesBefore>>
  try {
    loaded = await loadCandlesBefore(symbolRaw, tf, before)
  } catch {
    // Retryable: no `exhausted` key, so the chart asks again later.
    const resolved = chartPairFor(symbolRaw)
    return NextResponse.json(
      { symbol: resolved?.symbol ?? symbolRaw.toUpperCase(), label: resolved?.label ?? null, source: resolved?.source ?? null, tf, before, older: [], error: 'feed unavailable' },
      { headers: NO_STORE },
    )
  }
  if (!loaded) {
    return NextResponse.json({ symbol: symbolRaw.toUpperCase(), label: null, source: null, tf, before, older: [], error: 'no chart source' }, { headers: NO_STORE })
  }
  const { pair, page } = loaded
  return NextResponse.json(
    { symbol: pair.symbol, label: pair.label, source: pair.source, feed: page.feed, tf, before, older: page.older, exhausted: page.exhausted },
    { headers: NO_STORE },
  )
}
