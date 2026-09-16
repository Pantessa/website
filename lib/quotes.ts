// lib/quotes.ts — the batched last-price reader behind GET /api/quotes and
// the alerts cron (MARKETS/WATCH, 2026-09-11). Server-only. Every source is
// the keyless public feed the candle proxy already trusts (lib/charts.ts):
//
//   robinhood   — ONE batch historicals call for every stock in the request
//                 (`?symbols=A,B,C`, 24/7 bounds): last non-interpolated
//                 close vs the tape's previous_close_price. Yahoo's daily
//                 chart is the per-symbol fallback when the batch is down.
//   coinbase    — /products/<X>-USD/stats (last + 24h open), per symbol.
//   hyperliquid — ONE metaAndAssetCtxs call serves every perp (markPx vs
//                 prevDayPx), cached for the whole TTL.
//
// Cost scales with SYMBOLS, not users: a quote is cached per symbol for
// QUOTE_TTL_MS, in-flight reads are shared, and a feed miss omits the
// symbol (never a 500 — the README contract). `readQuotes` is the injection
// seam the cron's dedup pin counts through.

import { chartPairFor, type ChartPair } from '@/lib/charts'
import { normalizeWatchSymbol, sessionFor, type Quote } from '@/lib/watchlists'

export const QUOTE_TTL_MS = 15_000
export const QUOTES_MAX_SYMBOLS = 250
/** Robinhood's batch historicals answers 400 past 75 symbols (measured
 *  2026-09-16: 75 → 200, 76 → 400). A bigger request sent in one call failed
 *  whole, and every stock on the board fell back to Yahoo's regular-session
 *  price — which the stock-swap tape check (lib/stock-tape) then compared a
 *  24/7 pool against. */
export const ROBINHOOD_BATCH_MAX = 75
const UPSTREAM_TIMEOUT_MS = 6_000
const COINBASE_CONCURRENCY = 6
const UA = 'Mozilla/5.0 (compatible; Pantessa/1.0; +https://www.pantessa.com)'

export type QuoteMap = Record<string, Quote>

interface CacheEntry {
  at: number
  quote: Quote
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Quote | null>>()

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

const quoteOf = (last: number, prev: number, feed: string, pair: ChartPair, asOf = Date.now()): Quote | null => {
  if (!(last > 0) || !Number.isFinite(prev)) return null
  const chg = prev > 0 ? last - prev : 0
  return { last, chg, chgPct: prev > 0 ? (chg / prev) * 100 : 0, asOf, feed, session: sessionFor(pair.source), chartable: true }
}

// ── Coinbase ────────────────────────────────────────────────────────────────

async function fetchCoinbase(pair: ChartPair): Promise<Quote | null> {
  const res = await fetchWithTimeout(`https://api.exchange.coinbase.com/products/${pair.pair}/stats`)
  if (!res.ok) throw new Error(`coinbase ${res.status}`)
  const raw = (await res.json()) as { open?: string; last?: string }
  return quoteOf(Number(raw.last), Number(raw.open), 'coinbase', pair)
}

// ── Hyperliquid (one call, every perp) ──────────────────────────────────────

interface HlCtx {
  markPx?: string
  prevDayPx?: string
}
let hlSnapshot: { at: number; byCoin: Map<string, HlCtx> } | null = null
let hlInflight: Promise<Map<string, HlCtx>> | null = null

async function hlContexts(): Promise<Map<string, HlCtx>> {
  if (hlSnapshot && Date.now() - hlSnapshot.at < QUOTE_TTL_MS) return hlSnapshot.byCoin
  if (hlInflight) return hlInflight
  hlInflight = (async () => {
    const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    })
    if (!res.ok) throw new Error(`hyperliquid ${res.status}`)
    const [meta, ctxs] = (await res.json()) as [{ universe?: { name: string }[] }, HlCtx[]]
    const byCoin = new Map<string, HlCtx>()
    ;(meta.universe ?? []).forEach((u, i) => {
      if (ctxs?.[i]) byCoin.set(u.name, ctxs[i])
    })
    if (byCoin.size === 0) throw new Error('hyperliquid shape')
    hlSnapshot = { at: Date.now(), byCoin }
    return byCoin
  })().finally(() => {
    hlInflight = null
  })
  return hlInflight
}

async function fetchHyperliquid(pair: ChartPair): Promise<Quote | null> {
  const ctx = (await hlContexts()).get(pair.pair)
  if (!ctx) return null
  return quoteOf(Number(ctx.markPx), Number(ctx.prevDayPx), 'hyperliquid', pair)
}

// ── Robinhood (one batch call for every stock in the request) ───────────────

interface RhRow {
  close_price?: string
  interpolated?: boolean
  begins_at?: string
}
interface RhResult {
  symbol?: string
  previous_close_price?: string
  historicals?: RhRow[]
}

async function fetchRobinhoodBatch(symbols: string[]): Promise<Map<string, { last: number; prev: number; asOf: number }>> {
  const out = new Map<string, { last: number; prev: number; asOf: number }>()
  if (symbols.length === 0) return out
  const res = await fetchWithTimeout(
    `https://api.robinhood.com/marketdata/historicals/?symbols=${encodeURIComponent(symbols.join(','))}&interval=5minute&span=day&bounds=24_7`,
    { headers: { 'user-agent': UA, accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`robinhood ${res.status}`)
  const raw = (await res.json()) as { results?: (RhResult | null)[] }
  if (!Array.isArray(raw.results)) throw new Error('robinhood shape')
  for (const r of raw.results) {
    if (!r?.symbol || !Array.isArray(r.historicals)) continue
    const rows = r.historicals.filter((h) => !h.interpolated && Number(h.close_price) > 0)
    const lastRow = rows[rows.length - 1]
    if (!lastRow) continue
    const asOf = lastRow.begins_at ? Date.parse(lastRow.begins_at) : Date.now()
    out.set(r.symbol.toUpperCase(), { last: Number(lastRow.close_price), prev: Number(r.previous_close_price), asOf: Number.isFinite(asOf) ? asOf : Date.now() })
  }
  return out
}

// ── Yahoo (per symbol, when the batch doesn't answer) ───────────────────────
//
// The previous close comes off the daily bars, never the chart meta's
// `chartPreviousClose`: that is the close before the requested RANGE. Measured
// 2026-09-16 on AAPL mid-session: range=5d gave 315.34 (Sep 9's close, so every
// Yahoo-served stock showed a five-day move as the day's), 2d gave 333.08, 1d
// gave 331.34, the right one. 1d isn't the fix either: it follows the calendar,
// so on a day the exchange is shut it reads flat (Bursa Malaysia's holiday the
// same day: previous close = last price). `previousClose` only rides intraday
// intervals.
//
// The rule: the close of the last daily bar dated before the day the price
// printed (`regularMarketTime`), on the exchange's calendar. It holds when the
// session's own bar has no close yet (Toyota on Tokyo after its close) and
// when the window carries a later day's bar. 5d, not 2d, so either of those
// can't push the prior session out of the window. Against Robinhood's daily
// closes that day, all 199 listings matched (chartPreviousClose: 7 within
// 0.1%). Robinhood's own `previous_close_price` takes an ex-dividend day's
// dividend off the prior close and Yahoo's bars don't, so on that day the two
// feeds' changes differ by the dividend (TSM, PR on 2026-09-16).

/** The chart fields the fallback quote reads (interval=1d). */
export interface YahooChartResult {
  meta?: { regularMarketPrice?: number; regularMarketTime?: number; exchangeTimezoneName?: string }
  timestamp?: number[]
  indicators?: { quote?: { close?: (number | null)[] }[] }
}

/** Unix seconds → 'YYYY-MM-DD' on the exchange's calendar. Every stock this
 *  fallback serves is a US listing, so a zone Intl doesn't know reads as New York. */
function exchangeDayOf(timeZone: string | undefined): (t: number) => string {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' } as const
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timeZone || 'America/New_York' })
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'America/New_York' })
  }
  return (t) => {
    const parts = fmt.formatToParts(new Date(t * 1000))
    const part = (type: string) => parts.find((p) => p.type === type)?.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
}

/** The close of the session before the one the price printed in; null when the
 *  bars hold no earlier session. */
function previousSessionClose(result: YahooChartResult): number | null {
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const bars = (result.timestamp ?? [])
    .map((t, i) => ({ t, c: closes[i] }))
    .filter((b): b is { t: number; c: number } => typeof b.c === 'number' && b.c > 0)
    .sort((a, b) => a.t - b.t)
  const printedAt = result.meta?.regularMarketTime || bars[bars.length - 1]?.t
  if (!printedAt) return null
  const dayOf = exchangeDayOf(result.meta?.exchangeTimezoneName)
  const session = dayOf(printedAt)
  const before = bars.filter((b) => dayOf(b.t) < session)
  return before.length > 0 ? before[before.length - 1].c : null
}

/** A Yahoo daily chart → the quote. Pure, so the harness pins it on measured
 *  payloads. No earlier session in the bars → no quote: a change we can't
 *  state isn't shown as flat. */
export function yahooQuoteOf(result: YahooChartResult, pair: ChartPair): Quote | null {
  const meta = result.meta
  if (!meta) return null
  const prev = previousSessionClose(result) ?? Number.NaN
  return quoteOf(Number(meta.regularMarketPrice), prev, 'yahoo', pair, meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now())
}

/** Exported for the harness's live pin (Yahoo against Robinhood's daily closes). */
export async function fetchYahooQuote(pair: ChartPair): Promise<Quote | null> {
  const res = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair.pair)}?interval=1d&range=5d`,
    { headers: { 'user-agent': UA, accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`yahoo ${res.status}`)
  const result = ((await res.json()) as { chart?: { result?: YahooChartResult[] } }).chart?.result?.[0]
  if (!result?.meta) throw new Error('yahoo shape')
  return yahooQuoteOf(result, pair)
}

// ── The batched reader ──────────────────────────────────────────────────────

/** Normalize + dedupe a request's symbols; the second list is what did not
 *  even normalize (junk) — the caller reports it, never 500s on it. */
export function cleanQuoteSymbols(raw: readonly string[]): { symbols: string[]; junk: string[] } {
  const seen = new Set<string>()
  const symbols: string[] = []
  const junk: string[] = []
  for (const r of raw) {
    const s = normalizeWatchSymbol(r)
    if (!s) {
      if (String(r).trim()) junk.push(String(r).trim().slice(0, 16))
      continue
    }
    if (seen.has(s)) continue
    seen.add(s)
    symbols.push(s)
    if (symbols.length >= QUOTES_MAX_SYMBOLS) break
  }
  return { symbols, junk }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

/** How many upstream reads the last call made — the cron reports it so the
 *  per-symbol dedup is a number in a response, not a comment. */
export interface QuoteRead {
  quotes: QuoteMap
  /** Symbols asked for that came back with no quote (chartless, or feed miss). */
  missing: string[]
  /** Distinct symbols that had to be fetched (cache misses). */
  fetched: number
}

/**
 * Read quotes for a set of symbols. Cached per symbol for QUOTE_TTL_MS;
 * misses are grouped per source so N stocks cost ONE Robinhood call and N
 * perps cost ONE Hyperliquid call. A feed that fails omits its symbols.
 */
export async function readQuotes(symbolsRaw: readonly string[]): Promise<QuoteRead> {
  const { symbols } = cleanQuoteSymbols(symbolsRaw)
  const quotes: QuoteMap = {}
  const missing: string[] = []
  const now = Date.now()
  const toFetch: { symbol: string; pair: ChartPair }[] = []
  for (const s of symbols) {
    const hit = cache.get(s)
    if (hit && now - hit.at < QUOTE_TTL_MS) {
      quotes[s] = hit.quote
      continue
    }
    const pair = chartPairFor(s)
    if (!pair) {
      missing.push(s)
      continue
    }
    toFetch.push({ symbol: s, pair })
  }

  // Share in-flight reads across concurrent callers (two rails polling the
  // same symbol in the same second = one upstream read).
  const waits: Promise<void>[] = []
  const fresh: { symbol: string; pair: ChartPair }[] = []
  for (const f of toFetch) {
    const running = inflight.get(f.symbol)
    if (running) {
      waits.push(
        running.then((q) => {
          if (q) quotes[f.symbol] = q
          else missing.push(f.symbol)
        }),
      )
    } else fresh.push(f)
  }

  const stocks = fresh.filter((f) => f.pair.source === 'robinhood')
  const coins = fresh.filter((f) => f.pair.source === 'coinbase')
  const perps = fresh.filter((f) => f.pair.source === 'hyperliquid')

  // One batch promise per ROBINHOOD_BATCH_MAX stocks; each symbol's inflight
  // entry resolves off its own chunk, so one refused chunk falls back alone.
  const stockBatches: Promise<Map<string, { last: number; prev: number; asOf: number }> | null>[] = []
  for (let i = 0; i < stocks.length; i += ROBINHOOD_BATCH_MAX) {
    stockBatches.push(
      fetchRobinhoodBatch(stocks.slice(i, i + ROBINHOOD_BATCH_MAX).map((s) => s.pair.pair)).catch((err) => {
        console.warn(`[quotes] robinhood batch down (${err instanceof Error ? err.message : String(err)}) — yahoo per symbol`)
        return null
      }),
    )
  }

  const settle = (symbol: string, p: Promise<Quote | null>) => {
    const wrapped = p
      .catch(() => null)
      .then((q) => {
        if (q) cache.set(symbol, { at: Date.now(), quote: q })
        return q
      })
      .finally(() => inflight.delete(symbol))
    inflight.set(symbol, wrapped)
    waits.push(
      wrapped.then((q) => {
        if (q) quotes[symbol] = q
        else missing.push(symbol)
      }),
    )
  }

  stocks.forEach((s, i) => {
    settle(
      s.symbol,
      stockBatches[Math.floor(i / ROBINHOOD_BATCH_MAX)].then(async (batch) => {
        const row = batch?.get(s.pair.pair)
        if (row) return quoteOf(row.last, row.prev, 'robinhood', s.pair, row.asOf)
        return fetchYahooQuote(s.pair)
      }),
    )
  })
  for (const p of perps) settle(p.symbol, fetchHyperliquid(p.pair))
  // Coinbase is per-product; a bounded worker pool keeps a 40-coin list under
  // its public rate limit while still finishing inside one poll.
  const coinQueue = coins.map((c) => ({ c, resolve: null as null | ((q: Quote | null) => void) }))
  for (const item of coinQueue) {
    settle(
      item.c.symbol,
      new Promise<Quote | null>((resolve) => {
        item.resolve = resolve
      }),
    )
  }
  await Promise.all([
    mapLimit(coinQueue, COINBASE_CONCURRENCY, async (item) => {
      try {
        item.resolve?.(await fetchCoinbase(item.c.pair))
      } catch {
        item.resolve?.(null)
      }
    }),
    ...waits,
  ])
  // Preserve request order in `missing` and drop duplicates from shared waits.
  const missSet = new Set(missing)
  return { quotes, missing: symbols.filter((s) => missSet.has(s) && !quotes[s]), fetched: fresh.length }
}

/** Test seam: wipe the cache (the cron's fixture pin runs on a cold cache). */
export function resetQuoteCache(): void {
  cache.clear()
  hlSnapshot = null
}
