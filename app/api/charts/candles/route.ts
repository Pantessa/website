import { NextRequest, NextResponse } from 'next/server'
import { aggregateCandles, chartPairFor, changePct24h, type Candle, type ChartTf } from '@/lib/charts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live candle proxy for the chart surfaces. The pair resolver is the gate:
// symbols outside lib/charts' map never reach an upstream, so this can't be
// used to probe arbitrary products. Both upstreams are keyless public market
// data; a short TTL cache + inflight dedupe keeps a polling overlay from
// hammering them (Coinbase public rate limit is ~10 rps).

const TTL_MS = 5_000
const MAX_CANDLES = 180
const UPSTREAM_TIMEOUT_MS = 8_000

const TFS: Record<ChartTf, { coinbaseGranularity: number; hlInterval: string; sec: number }> = {
  '15m': { coinbaseGranularity: 900, hlInterval: '15m', sec: 900 },
  '1h': { coinbaseGranularity: 3600, hlInterval: '1h', sec: 3600 },
  // Coinbase has no native 4h — fetch 1h and bucket server-side.
  '4h': { coinbaseGranularity: 3600, hlInterval: '4h', sec: 14400 },
  '1d': { coinbaseGranularity: 86400, hlInterval: '1d', sec: 86400 },
}

interface CacheEntry {
  at: number
  candles: Candle[]
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Candle[]>>()

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchCoinbase(pair: string, tf: ChartTf): Promise<Candle[]> {
  const { coinbaseGranularity, sec } = TFS[tf]
  const res = await fetchWithTimeout(
    `https://api.exchange.coinbase.com/products/${pair}/candles?granularity=${coinbaseGranularity}`,
  )
  if (!res.ok) throw new Error(`coinbase ${res.status}`)
  const raw = (await res.json()) as [number, number, number, number, number, number][]
  if (!Array.isArray(raw)) throw new Error('coinbase shape')
  // Coinbase rows are [time, low, high, open, close, volume], newest first.
  const candles: Candle[] = raw
    .map((r) => ({ t: r[0], o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] }))
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t)
  return sec > coinbaseGranularity ? aggregateCandles(candles, sec) : candles
}

async function fetchHyperliquid(coin: string, tf: ChartTf): Promise<Candle[]> {
  const { hlInterval, sec } = TFS[tf]
  const end = Date.now()
  const start = end - (MAX_CANDLES + 2) * sec * 1000
  const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval: hlInterval, startTime: start, endTime: end } }),
  })
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`)
  const raw = (await res.json()) as { t: number; o: string; h: string; l: string; c: string; v: string }[]
  if (!Array.isArray(raw)) throw new Error('hyperliquid shape')
  return raw
    .map((r) => ({
      t: Math.floor(r.t / 1000),
      o: Number(r.o),
      h: Number(r.h),
      l: Number(r.l),
      c: Number(r.c),
      v: Number(r.v),
    }))
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t)
}

function loadCandles(pairKey: string, source: 'coinbase' | 'hyperliquid', pair: string, tf: ChartTf): Promise<Candle[]> {
  const hit = cache.get(pairKey)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.candles)
  const running = inflight.get(pairKey)
  if (running) return running
  const p = (source === 'coinbase' ? fetchCoinbase(pair, tf) : fetchHyperliquid(pair, tf))
    .then((candles) => {
      cache.set(pairKey, { at: Date.now(), candles })
      return candles
    })
    .finally(() => inflight.delete(pairKey))
  inflight.set(pairKey, p)
  return p
}

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  const tfRaw = req.nextUrl.searchParams.get('tf') ?? '1h'
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  }
  const tf = (Object.keys(TFS) as ChartTf[]).includes(tfRaw as ChartTf) ? (tfRaw as ChartTf) : '1h'
  const resolved = chartPairFor(symbolRaw)
  if (!resolved) {
    // Shape-compatible refusal: the client renders the honest empty state.
    return NextResponse.json(
      { symbol: symbolRaw.toUpperCase(), label: null, source: null, tf, candles: [], error: 'no chart source' },
      { headers: { 'cache-control': 'no-store' } },
    )
  }
  try {
    const all = await loadCandles(`${resolved.source}:${resolved.pair}:${tf}`, resolved.source, resolved.pair, tf)
    const candles = all.slice(-MAX_CANDLES)
    return NextResponse.json(
      {
        symbol: resolved.symbol,
        label: resolved.label,
        source: resolved.source,
        tf,
        candles,
        last: candles.length ? candles[candles.length - 1].c : null,
        changePct24h: changePct24h(candles),
        asOf: Date.now(),
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch {
    // Feed down, not a 500 — the chart shows its retryable error line.
    return NextResponse.json(
      { symbol: resolved.symbol, label: resolved.label, source: resolved.source, tf, candles: [], error: 'feed unavailable' },
      { headers: { 'cache-control': 'no-store' } },
    )
  }
}
