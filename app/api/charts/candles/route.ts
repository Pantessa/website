import { NextRequest, NextResponse } from 'next/server'
import { changePct24h, chartPairFor, type Candle } from '@/lib/charts'
import { MAX_CANDLES, WARMUP_BARS, loadCandleSeries, resolveTf } from '@/lib/candles-server'
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

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  const tf = resolveTf(req.nextUrl.searchParams.get('tf') ?? '1h')
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  }
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
      { headers: { 'cache-control': 'no-store' } },
    )
  }
  if (!loaded) {
    // Shape-compatible refusal: the client renders the honest empty state.
    return NextResponse.json(
      { symbol: symbolRaw.toUpperCase(), label: null, source: null, tf, candles: [], error: 'no chart source' },
      { headers: { 'cache-control': 'no-store' } },
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
    { headers: { 'cache-control': 'no-store' } },
  )
}
