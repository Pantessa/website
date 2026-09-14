// Server-side candle loader — the ONE place the chart feeds are fetched.
// /api/charts/candles serves it over HTTP; /api/charts/technicals imports it
// directly (no HTTP hop, same cache) so the gauges are computed from exactly
// the tape the chart draws. Server-only: the fetchers hit keyless public
// upstreams with a UA; nothing here is importable from a client component.
//
// The pair resolver (lib/charts chartPairFor) is the gate: symbols outside
// its map never reach an upstream, so this can't be used to probe arbitrary
// products. A short TTL cache + inflight dedupe keeps a polling overlay from
// hammering them (Coinbase public rate limit is ~10 rps).
//
// Tokenized stocks (source 'robinhood') read Robinhood's own market-data
// historicals with `bounds=24_7` — the round-the-clock tape the on-chain
// stock tokens track, so a Sunday-night AAPL candle is the same print the
// 4663 pool follows. Candles the venue marks `interpolated` (no trades —
// weekends, dead hours) are dropped rather than drawn as flat fakes. When
// that feed is down the loader falls back to Yahoo Finance's chart API (the
// exchange tape, extended hours included) and reports which one answered in
// `feed`, so the chart's eyebrow never claims a source it didn't use.

import { aggregateCandles, chartPairFor, type Candle, type ChartFeed, type ChartPair, type ChartSource, type ChartTf } from '@/lib/charts'

const TTL_MS = 5_000
/** Deep series (the technicals + the chart's warm-up) change slowly and cost
 *  more upstream — 30s. */
const DEEP_TTL_MS = 30_000
export const MAX_CANDLES = 180
/** Bars the chart's rolling lines read BEFORE its window (?warmup=1): an SMA
 *  200 needs 199 older bars to have a value at the window's first candle. */
export const WARMUP_BARS = 200
/** Bars a DEEP load aims for — the chart's window plus its warm-up, which
 *  also covers the technicals' 200-period MAs (200 completed bars plus
 *  warm-up), so neither draws nor votes on an average that isn't there. */
export const DEEP_BARS = MAX_CANDLES + WARMUP_BARS
/** Bars one OLDER page (?before=) aims for. MarketChart asks page after page
 *  while less than a screen of held bars sits left of its view, up to its
 *  history cap, so a zoom-out reads as more range. */
export const PAGE_BARS = 600
/** Windowed Coinbase calls one page may spend: a native frame needs two; 4h
 *  (bucketed from 1h) stops at six, ~450 bars — the deep 4h load's budget. */
const PAGE_COINBASE_CALLS = 6
/** A page is closed history (bars that opened before the chart's first), so
 *  it keeps for minutes and every viewer paging the same frame shares it. */
const PAGE_TTL_MS = 10 * 60_000
const PAGE_CACHE_MAX = 200
const UPSTREAM_TIMEOUT_MS = 8_000

const UA = 'Mozilla/5.0 (compatible; Pantessa/1.0; +https://www.pantessa.com)'

const TFS: Record<ChartTf, { coinbaseGranularity: number; hlInterval: string; sec: number }> = {
  '15m': { coinbaseGranularity: 900, hlInterval: '15m', sec: 900 },
  '1h': { coinbaseGranularity: 3600, hlInterval: '1h', sec: 3600 },
  // Coinbase has no native 4h — fetch 1h and bucket server-side.
  '4h': { coinbaseGranularity: 3600, hlInterval: '4h', sec: 14400 },
  '1d': { coinbaseGranularity: 86400, hlInterval: '1d', sec: 86400 },
}

/** Robinhood historicals: the finest native interval that still covers
 *  MAX_CANDLES after interpolated rows drop; coarser frames bucket up. */
const RH_TFS: Record<ChartTf, { interval: string; span: string; native: number; sec: number }> = {
  '15m': { interval: '5minute', span: 'week', native: 300, sec: 900 },
  '1h': { interval: 'hour', span: 'month', native: 3600, sec: 3600 },
  '4h': { interval: 'hour', span: 'month', native: 3600, sec: 14400 },
  '1d': { interval: 'day', span: 'year', native: 86400, sec: 86400 },
}

/** A deep load's Robinhood span per frame, measured 2026-09-14 on ADBE after
 *  the interpolated rows drop: day/5year 1,254 bars (year: 250), hour/3month
 *  988 (month: 319), ~0.4–0.8s and ~345KB cold. The venue refuses longer
 *  spans for 5minute (a week: ~246 15m buckets) and hour (3month: ~248 4h
 *  buckets), so those two frames warm up as far as the tape reaches. */
const RH_DEEP_SPAN: Record<ChartTf, string> = { '15m': 'week', '1h': '3month', '4h': '3month', '1d': '5year' }

/** Yahoo Finance chart API — the fallback tape for stocks. */
const YF_TFS: Record<ChartTf, { interval: string; range: string; native: number; sec: number }> = {
  '15m': { interval: '15m', range: '5d', native: 900, sec: 900 },
  '1h': { interval: '1h', range: '1mo', native: 3600, sec: 3600 },
  '4h': { interval: '1h', range: '1mo', native: 3600, sec: 14400 },
  '1d': { interval: '1d', range: '1y', native: 86400, sec: 86400 },
}

/** Yahoo's deep ranges (measured 2026-09-14 on ADBE): 15m/1mo 1,409 bars,
 *  1h/3mo 1,072, 1h/6mo 508 4h buckets, 1d/2y 501. */
const YF_DEEP_RANGE: Record<ChartTf, string> = { '15m': '1mo', '1h': '3mo', '4h': '6mo', '1d': '2y' }

export interface Series {
  feed: ChartFeed
  candles: Candle[]
}

interface CacheEntry {
  at: number
  series: Series
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Series>>()

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchCoinbaseWindow(pair: string, granularity: number, window?: { start: number; end: number }): Promise<Candle[]> {
  const qs = window ? `&start=${new Date(window.start * 1000).toISOString()}&end=${new Date(window.end * 1000).toISOString()}` : ''
  const res = await fetchWithTimeout(`https://api.exchange.coinbase.com/products/${pair}/candles?granularity=${granularity}${qs}`)
  if (!res.ok) throw new Error(`coinbase ${res.status}`)
  const raw = (await res.json()) as [number, number, number, number, number, number][]
  if (!Array.isArray(raw)) throw new Error('coinbase shape')
  // Coinbase rows are [time, low, high, open, close, volume], newest first.
  return raw
    .map((r) => ({ t: r[0], o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] }))
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c))
}

/** Coinbase pages 300 candles per windowed call. A deep load pages older
 *  windows with start/end until it covers DEEP_BARS (a native frame: two
 *  calls; 4h bucketed from 1h: six) — deep loads only: the technicals and
 *  the chart's once-per-frame warm-up, never its polls. */
async function fetchCoinbase(pair: string, tf: ChartTf, deep = false): Promise<Candle[]> {
  const { coinbaseGranularity, sec } = TFS[tf]
  const perCall = 300
  const bucketsPerCall = Math.floor((perCall * coinbaseGranularity) / sec)
  const calls = deep ? Math.max(1, Math.ceil(DEEP_BARS / bucketsPerCall)) : 1
  const windows: (undefined | { start: number; end: number })[] = [undefined]
  const now = Math.floor(Date.now() / 1000)
  for (let i = 1; i < calls; i++) {
    const end = now - i * perCall * coinbaseGranularity
    windows.push({ start: end - perCall * coinbaseGranularity, end })
  }
  const pages = await Promise.all(windows.map((w) => fetchCoinbaseWindow(pair, coinbaseGranularity, w)))
  const seen = new Set<number>()
  const candles: Candle[] = []
  for (const page of pages) for (const c of page) if (!seen.has(c.t)) { seen.add(c.t); candles.push(c) }
  candles.sort((a, b) => a.t - b.t)
  return bucketed(candles, coinbaseGranularity, sec)
}

/** Bucket fine candles up to the frame (Coinbase has no native 4h; the stock
 *  feeds serve 5-minute and hourly rows). The oldest bucket goes when the
 *  fetch began partway through it: a 4h bar built from its last hour alone is
 *  a stub candle, and the chart's history keeps every stub a poll slides past,
 *  where a zoom-out shows them mid-chart. */
function bucketed(candles: Candle[], native: number, sec: number): Candle[] {
  if (sec <= native || candles.length === 0) return candles
  const first = candles[0].t
  return aggregateCandles(candles, sec).filter((b) => b.t >= first)
}

async function fetchHyperliquid(coin: string, tf: ChartTf, deep = false): Promise<Candle[]> {
  const { hlInterval, sec } = TFS[tf]
  const end = Date.now()
  const start = end - ((deep ? DEEP_BARS : MAX_CANDLES) + 2) * sec * 1000
  return fetchHyperliquidRange(coin, hlInterval, start, end)
}

/** HL candleSnapshot over [startMs, endMs], both ends inclusive on the open
 *  time. The venue keeps only the latest 5,000 candles per interval, so an
 *  older range comes back empty. */
async function fetchHyperliquidRange(coin: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: startMs, endTime: endMs } }),
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

interface RobinhoodRow {
  begins_at: string
  open_price: string
  close_price: string
  high_price: string
  low_price: string
  volume: number | string
  interpolated?: boolean
}

async function fetchRobinhood(symbol: string, tf: ChartTf, deep = false): Promise<Candle[]> {
  const { interval, native, sec } = RH_TFS[tf]
  const span = deep ? RH_DEEP_SPAN[tf] : RH_TFS[tf].span
  const res = await fetchWithTimeout(
    `https://api.robinhood.com/marketdata/historicals/${encodeURIComponent(symbol)}/?interval=${interval}&span=${span}&bounds=24_7`,
    { headers: { 'user-agent': UA, accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`robinhood ${res.status}`)
  const raw = (await res.json()) as { historicals?: RobinhoodRow[] }
  if (!Array.isArray(raw.historicals)) throw new Error('robinhood shape')
  const candles: Candle[] = raw.historicals
    // An interpolated row is the venue carrying the last print through a
    // dead hour — no trades, zero volume. Drawing it would fake a flat tape.
    .filter((r) => !r.interpolated)
    .map((r) => ({
      t: Math.floor(Date.parse(r.begins_at) / 1000),
      o: Number(r.open_price),
      h: Number(r.high_price),
      l: Number(r.low_price),
      c: Number(r.close_price),
      v: Number(r.volume) || 0,
    }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.o) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t)
  if (candles.length === 0) throw new Error('robinhood empty')
  return bucketed(candles, native, sec)
}

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[]
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] }
    }[]
  }
}

async function fetchYahoo(symbol: string, tf: ChartTf, deep = false): Promise<Candle[]> {
  const { interval, native, sec } = YF_TFS[tf]
  const range = deep ? YF_DEEP_RANGE[tf] : YF_TFS[tf].range
  const res = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`,
    { headers: { 'user-agent': UA, accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`yahoo ${res.status}`)
  const raw = (await res.json()) as YahooChart
  const r = raw.chart?.result?.[0]
  const q = r?.indicators?.quote?.[0]
  if (!r?.timestamp || !q) throw new Error('yahoo shape')
  const candles: Candle[] = []
  r.timestamp.forEach((t, i) => {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (o == null || h == null || l == null || c == null) return
    candles.push({ t, o, h, l, c, v: q.volume?.[i] ?? 0 })
  })
  candles.sort((a, b) => a.t - b.t)
  if (candles.length === 0) throw new Error('yahoo empty')
  return bucketed(candles, native, sec)
}

/** Stocks: Robinhood's tape first, Yahoo's when it is down. The feed that
 *  answered rides along so the chart can say which one it is showing. */
async function fetchStock(symbol: string, tf: ChartTf, deep = false): Promise<Series> {
  try {
    return { feed: 'robinhood', candles: await fetchRobinhood(symbol, tf, deep) }
  } catch (err) {
    try {
      const candles = await fetchYahoo(symbol, tf, deep)
      console.warn(`[charts] robinhood feed down for ${symbol} ${tf} (${err instanceof Error ? err.message : String(err)}) — served by yahoo`)
      return { feed: 'yahoo', candles }
    } catch (err2) {
      throw new Error(`stock feeds down: ${err instanceof Error ? err.message : String(err)}; ${err2 instanceof Error ? err2.message : String(err2)}`)
    }
  }
}

function fetchSeries(source: ChartSource, pair: string, tf: ChartTf, deep: boolean): Promise<Series> {
  if (source === 'coinbase') return fetchCoinbase(pair, tf, deep).then((candles) => ({ feed: 'coinbase', candles }))
  if (source === 'hyperliquid') return fetchHyperliquid(pair, tf, deep).then((candles) => ({ feed: 'hyperliquid', candles }))
  return fetchStock(pair, tf, deep)
}

function loadCandles(pairKey: string, source: ChartSource, pair: string, tf: ChartTf, deep: boolean): Promise<Series> {
  const hit = cache.get(pairKey)
  if (hit && Date.now() - hit.at < (deep ? DEEP_TTL_MS : TTL_MS)) return Promise.resolve(hit.series)
  const running = inflight.get(pairKey)
  if (running) return running
  const p = fetchSeries(source, pair, tf, deep)
    .then((series) => {
      cache.set(pairKey, { at: Date.now(), series })
      return series
    })
    .finally(() => inflight.delete(pairKey))
  inflight.set(pairKey, p)
  return p
}

/** The tf the candle proxy serves for a raw query value ('1h' default). */
export function resolveTf(raw: string | null | undefined): ChartTf {
  return (Object.keys(TFS) as ChartTf[]).includes(raw as ChartTf) ? (raw as ChartTf) : '1h'
}

export const CANDLE_TFS = Object.keys(TFS) as ChartTf[]

export interface LoadedSeries {
  pair: ChartPair
  series: Series
}

/**
 * Load a symbol's candle series — null when the symbol is chartless (the
 * caller refuses by name), throws when every feed is down (the caller
 * answers a retryable refusal, never a 500). `deep` asks for DEEP_BARS of
 * history (the technicals, and the chart's ?warmup=1) instead of the chart's
 * MAX_CANDLES window; the two share nothing but the code path, so a deep
 * miss never evicts the chart's hot entry.
 */
export async function loadCandleSeries(symbolRaw: string, tf: ChartTf, opts: { deep?: boolean } = {}): Promise<LoadedSeries | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  const deep = !!opts.deep
  const key = `${deep ? 'deep:' : ''}${pair.source}:${pair.pair}:${tf}`
  const series = await loadCandles(key, pair.source, pair.pair, tf, deep)
  return { pair, series }
}

// ── Older pages (?before=) ──────────────────────────────────────────────────
// A zoom-out asks for the bars before the first one the chart holds. Coinbase
// and Hyperliquid take a time window, so a page is its own cached read. The
// stock venues serve fixed spans, so a stock page is a slice of the deep
// series: the same tape and cache the warm-up and the technicals read.

export interface OlderPage {
  feed: ChartFeed
  /** Ascending; every bar opened strictly before `before`. The newest PAGE_BARS of them. */
  older: Candle[]
  /** The feed holds nothing older: the chart stops asking and fits what it holds. */
  exhausted: boolean
}

const pageCache = new Map<string, { at: number; page: OlderPage }>()
const pageInflight = new Map<string, Promise<OlderPage>>()

/** Coinbase windows are inclusive at both ends: 300 native slots a call, the
 *  newest window ending on the last candle that opened before `before`. */
async function fetchCoinbaseBefore(pair: string, tf: ChartTf, before: number): Promise<Candle[]> {
  const { coinbaseGranularity: g, sec } = TFS[tf]
  const perCall = 300
  const calls = Math.min(PAGE_COINBASE_CALLS, Math.max(1, Math.ceil((PAGE_BARS * sec) / (perCall * g))))
  const newest = Math.floor((before - 1) / g) * g
  const windows = Array.from({ length: calls }, (_, i) => {
    const end = newest - i * perCall * g
    return { start: end - (perCall - 1) * g, end }
  })
  const pages = await Promise.all(windows.map((w) => fetchCoinbaseWindow(pair, g, w)))
  const seen = new Set<number>()
  const native: Candle[] = []
  for (const page of pages) for (const c of page) if (c.t < before && !seen.has(c.t)) { seen.add(c.t); native.push(c) }
  native.sort((a, b) => a.t - b.t)
  if (sec === g) return native
  // 4h from 1h: a bucket counts only when the fetch spanned all of it (the
  // oldest one can straddle the first window's start).
  const floor = windows[windows.length - 1].start
  return aggregateCandles(native, sec).filter((b) => b.t >= floor && b.t + sec <= before)
}

async function fetchHyperliquidBefore(coin: string, tf: ChartTf, before: number): Promise<Candle[]> {
  const { hlInterval, sec } = TFS[tf]
  const candles = await fetchHyperliquidRange(coin, hlInterval, (before - PAGE_BARS * sec) * 1000, before * 1000 - 1)
  return candles.filter((c) => c.t < before)
}

const asPage = (feed: ChartFeed, older: Candle[]): OlderPage => ({ feed, older: older.slice(-PAGE_BARS), exhausted: older.length === 0 })

/**
 * One older page for a symbol: the bars that opened strictly before `before`
 * (unix seconds), the newest PAGE_BARS of them. Null when the symbol is
 * chartless; throws when the feed is down (the route answers a retryable
 * refusal, never a 500).
 */
export async function loadCandlesBefore(symbolRaw: string, tf: ChartTf, before: number): Promise<{ pair: ChartPair; page: OlderPage } | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  if (pair.source === 'robinhood') {
    const deep = await loadCandleSeries(symbolRaw, tf, { deep: true })
    if (!deep) return null
    const older = deep.series.candles.filter((c) => c.t < before)
    return { pair, page: { feed: deep.series.feed, older: older.slice(-PAGE_BARS), exhausted: older.length <= PAGE_BARS } }
  }
  // Only closed bars are cached: a `before` past the current bar's open
  // (never the chart's own ask) reads as that open.
  const { sec } = TFS[tf]
  const closedBefore = Math.min(before, Math.floor(Date.now() / 1000 / sec) * sec)
  const key = `${pair.source}:${pair.pair}:${tf}:${closedBefore}`
  const hit = pageCache.get(key)
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return { pair, page: hit.page }
  let running = pageInflight.get(key)
  if (!running) {
    const read =
      pair.source === 'coinbase'
        ? fetchCoinbaseBefore(pair.pair, tf, closedBefore).then((c) => asPage('coinbase', c))
        : fetchHyperliquidBefore(pair.pair, tf, closedBefore).then((c) => asPage('hyperliquid', c))
    running = read
      .then((page) => {
        pageCache.delete(key)
        pageCache.set(key, { at: Date.now(), page })
        // Map order is insertion order: the oldest entry leaves first.
        while (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value as string)
        return page
      })
      .finally(() => pageInflight.delete(key))
    pageInflight.set(key, running)
  }
  return { pair, page: await running }
}
