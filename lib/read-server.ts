// THE READ's server half (2026-11-09): the snapshot lib/read composes its
// headline from, and the longer series behind the chart's range chips.
//
// Two kinds of reads, both keyless, both fail-soft per instrument (a feed
// that does not answer leaves that tile on a dash and that clause out of the
// headline — the page never waits on it and never 500s):
//
//   • `app` instruments go through the app's own readers: lib/quotes
//     readQuotes (the same batch /api/quotes serves) for the last and the
//     change, lib/candles-server loadCandleSeries for the series. Nothing
//     new is fetched that a symbol page does not already fetch.
//   • `index` instruments (the Nasdaq 100, the 10-year yield, the VIX, the
//     dollar index) read the chart API the stock candles already fall back
//     to (lib/candles-server fetchYahoo's host): one 15-minute, five-day
//     read each — the price, the session it printed in, and the close of
//     the session before it (the change is stated against THAT, the way an
//     index's day is quoted).
//
// One snapshot per process per READ_SERVER_TTL_MS, inflight reads shared;
// `/` (ISR, 60s) reads it at render so the headline is in the server HTML,
// and GET /api/markets/read serves the same object to the browser's refresh.

import { unstable_cache } from 'next/cache'
import { chartPairFor, resolveChartPair, type ChartTf } from '@/lib/charts'
import { loadCandleSeries } from '@/lib/candles-server'
import { marketSections } from '@/lib/markets'
import { readQuotes } from '@/lib/quotes'
import { DESK_SYMBOLS_MAX, READ_DESK_SERVER_SYMBOLS, READ_TOKEN_MOVER_FLOOR_PCT, deskItemFor, type DeskItem } from '@/lib/read-desk'
import {
  EMPTY_READ,
  READ_APP_SYMBOLS,
  READ_INSTRUMENTS,
  READ_LIVE_WINDOW_MS,
  READ_MIN_SESSION_BARS,
  READ_MOVER_POOL,
  READ_SERVER_TTL_MS,
  rankReadMovers,
  readInstrument,
  readQuoteOf,
  thinReadPoints,
  type ReadId,
  type ReadInstrument,
  type ReadPoint,
  type ReadQuote,
  type ReadRange,
  type ReadSnapshot,
} from '@/lib/read'

const UA = 'Mozilla/5.0 (compatible; Pantessa/1.0; +https://www.pantessa.com)'
const INDEX_HOST = 'https://query1.finance.yahoo.com/v8/finance/chart/'
/** One upstream read may take this long; the snapshot as a whole a little more. */
const READ_TIMEOUT_MS = 4_000
const SNAPSHOT_TIMEOUT_MS = 6_500

/** Bars a 24/7 market's "today" holds: 24 hours of 15-minute closes. */
export const READ_DAY_BARS = 96

// ── Small tools ──────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      () => {
        clearTimeout(id)
        resolve(fallback)
      },
    )
  })
}

/** Unix seconds → 'YYYY-MM-DD' on the exchange's calendar (New York when the zone is unknown). */
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

// ── Index data ───────────────────────────────────────────────────────────────

/** The chart fields the index reads use. */
export interface IndexChartResult {
  meta?: { regularMarketPrice?: number; regularMarketTime?: number; exchangeTimezoneName?: string }
  timestamp?: number[]
  indicators?: { quote?: { close?: (number | null)[] }[] }
}

function barsOf(result: IndexChartResult): { t: number; c: number }[] {
  const closes = result.indicators?.quote?.[0]?.close ?? []
  return (result.timestamp ?? [])
    .map((t, i) => ({ t, c: closes[i] }))
    .filter((b): b is { t: number; c: number } => typeof b.c === 'number' && Number.isFinite(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t)
}

/**
 * An intraday index chart → the quote. PURE (the pins feed it measured
 * payloads): the last is the venue's own regular-market price, the change is
 * stated against the close of the session BEFORE the one the price printed
 * in, and "today" is that session's bars. No earlier session in the bars →
 * a quote with no change (a move we cannot state is not shown as flat).
 */
export function indexQuoteOf(inst: ReadInstrument, result: IndexChartResult, nowMs: number): ReadQuote | null {
  const meta = result.meta
  const bars = barsOf(result)
  const last = Number(meta?.regularMarketPrice ?? bars[bars.length - 1]?.c)
  const printedAt = meta?.regularMarketTime || bars[bars.length - 1]?.t
  if (!printedAt) return null
  const dayOf = exchangeDayOf(meta?.exchangeTimezoneName)
  const session = dayOf(printedAt)
  const before = bars.filter((b) => dayOf(b.t) < session)
  const today = bars.filter((b) => dayOf(b.t) === session)
  const prev = before.length > 0 ? before[before.length - 1].c : null
  // A session that has just opened is a stub: draw it after the session before it.
  const lead = today.length < READ_MIN_SESSION_BARS && before.length > 0 ? before.filter((b) => dayOf(b.t) === dayOf(before[before.length - 1].t)) : []
  const points: ReadPoint[] = [...lead, ...today].map((b) => [b.t, b.c] as const)
  return readQuoteOf(inst, last, prev, printedAt * 1000, nowMs - printedAt * 1000 < READ_LIVE_WINDOW_MS, points)
}

async function fetchIndexChart(symbol: string, interval: string, range: string): Promise<IndexChartResult | null> {
  try {
    const res = await fetch(`${INDEX_HOST}${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { chart?: { result?: IndexChartResult[] } }
    return body.chart?.result?.[0] ?? null
  } catch {
    return null
  }
}

// ── The snapshot ─────────────────────────────────────────────────────────────

async function appPoints(symbol: string, tf: ChartTf, keep: number): Promise<ReadPoint[]> {
  try {
    const loaded = await loadCandleSeries(symbol, tf)
    const candles = loaded?.series.candles ?? []
    return candles.slice(-keep).map((c) => [c.t, c.c] as const)
  } catch {
    return []
  }
}

/** The household stocks the movers line may name: the pool, while each is a listed stock here. */
export function readMoverSymbols(): string[] {
  return READ_MOVER_POOL.filter((s) => chartPairFor(s)?.source === 'robinhood')
}

/** The tokens the movers line may name: the crypto board and the perps board (lib/markets), as listed. */
export function readTokenMoverSymbols(): string[] {
  return marketSections()
    .filter((s) => s.id === 'crypto' || s.id === 'perps')
    .flatMap((s) => s.rows.map((r) => r.symbol))
}

/** A desk token's quote from the app's own readers: the same last and change a board row shows, with today's series. */
function deskQuoteFrom(item: DeskItem, q: { last: number; chg: number; asOf: number; session: string } | undefined, points: ReadPoint[]): ReadQuote | null {
  if (!q) return null
  return readQuoteOf({ unit: item.unit } as ReadInstrument, q.last, Number.isFinite(q.chg) ? q.last - q.chg : null, q.asOf, q.session !== 'closed', points)
}

/** Today's series for a desk symbol: 24 hours of 15-minute closes; a market with sessions keeps its latest day of bars. */
async function deskDayPoints(item: DeskItem): Promise<ReadPoint[]> {
  const points = await appPoints(item.key, '15m', READ_DAY_BARS)
  if (item.kind === 'crypto' || item.kind === 'perp' || points.length < 2) return points
  const from = points[points.length - 1][0] - 24 * 3600
  const day = points.filter((p) => p[0] >= from)
  return day.length >= READ_MIN_SESSION_BARS ? day : points.slice(-32)
}

async function composeSnapshot(nowMs: number): Promise<ReadSnapshot> {
  const pool = readMoverSymbols()
  const tokenPool = readTokenMoverSymbols()
  const deskItems = READ_DESK_SERVER_SYMBOLS.map((s) => deskItemFor(s)).filter((i): i is DeskItem => i !== null)
  const [quoteRead, appSeries, indexCharts, deskSeries] = await Promise.all([
    withTimeout(
      readQuotes([...READ_APP_SYMBOLS, ...pool, ...deskItems.map((i) => i.key), ...tokenPool]).then((r) => r.quotes),
      READ_TIMEOUT_MS,
      {} as Awaited<ReturnType<typeof readQuotes>>['quotes'],
    ),
    Promise.all(READ_APP_SYMBOLS.map((s) => withTimeout(appPoints(s, '15m', READ_DAY_BARS), READ_TIMEOUT_MS, [] as ReadPoint[]))),
    Promise.all(READ_INSTRUMENTS.filter((i) => i.source === 'index').map(async (i) => [i.id, await fetchIndexChart(i.symbol, '15m', '5d')] as const)),
    Promise.all(deskItems.map((i) => withTimeout(deskDayPoints(i), READ_TIMEOUT_MS, [] as ReadPoint[]))),
  ])
  const quotes: ReadSnapshot['quotes'] = {}
  for (const inst of READ_INSTRUMENTS) {
    if (inst.source === 'app') {
      const q = quoteRead[inst.symbol]
      if (!q) continue
      const points = appSeries[READ_APP_SYMBOLS.indexOf(inst.symbol)] ?? []
      const made = readQuoteOf(inst, q.last, Number.isFinite(q.chg) ? q.last - q.chg : null, q.asOf, true, points)
      if (made) quotes[inst.id] = made
    } else {
      const chart = indexCharts.find(([id]) => id === inst.id)?.[1]
      const made = chart ? indexQuoteOf(inst, chart, nowMs) : null
      if (made) quotes[inst.id] = made
    }
  }
  const movers = rankReadMovers(pool.map((symbol) => ({ symbol, chgPct: quoteRead[symbol]?.chgPct ?? null })))
  // THE DESK (lib/read-desk): the crypto desk's tokens beside the nine, and the tokens that moved most.
  const desk: Record<string, ReadQuote> = {}
  deskItems.forEach((item, i) => {
    const made = deskQuoteFrom(item, quoteRead[item.key], deskSeries[i] ?? [])
    if (made) desk[item.key] = made
  })
  const tokenMovers = rankReadMovers(tokenPool.map((symbol) => ({ symbol, chgPct: quoteRead[symbol]?.chgPct ?? null })), undefined, READ_TOKEN_MOVER_FLOOR_PCT)
  return { asOf: nowMs, quotes, movers, desk, tokenMovers }
}

// ── A list's read ────────────────────────────────────────────────────────────

const deskCache = new Map<string, { at: number; quote: ReadQuote }>()

/**
 * The quotes behind a visitor's own tiles (lib/read-desk): each symbol's
 * last, change and today's series, from the same readers the snapshot uses.
 * One of the nine is not read here (the snapshot carries it). Cached per
 * symbol for READ_SERVER_TTL_MS, fail-soft per symbol: a feed that did not
 * answer leaves the symbol out, and a symbol the app has no chart for is
 * named in `unknown`. Never throws.
 */
export async function readDeskQuotes(symbolsRaw: readonly string[], nowMs = Date.now()): Promise<{ quotes: Record<string, ReadQuote>; unknown: string[] }> {
  const asked = [...new Set(symbolsRaw.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z0-9$._:-]{1,16}$/.test(s)))].slice(0, DESK_SYMBOLS_MAX)
  // A symbol only the venue's live table knows (a Hyperliquid listing on a cold process): warm it once.
  const cold = asked.find((s) => !chartPairFor(s))
  if (cold) await withTimeout(resolveChartPair(cold).then(() => null), READ_TIMEOUT_MS, null)
  const quotes: Record<string, ReadQuote> = {}
  const unknown: string[] = []
  const todo: DeskItem[] = []
  for (const s of asked) {
    const item = deskItemFor(s)
    if (!item) {
      unknown.push(s)
      continue
    }
    if (item.inst) continue
    const hit = deskCache.get(item.key)
    if (hit && nowMs - hit.at < READ_SERVER_TTL_MS) quotes[item.key] = hit.quote
    else if (!todo.some((t) => t.key === item.key)) todo.push(item)
  }
  if (todo.length > 0) {
    const [quoteRead, series] = await Promise.all([
      withTimeout(
        readQuotes(todo.map((i) => i.key)).then((r) => r.quotes),
        READ_TIMEOUT_MS,
        {} as Awaited<ReturnType<typeof readQuotes>>['quotes'],
      ),
      Promise.all(todo.map((i) => withTimeout(deskDayPoints(i), READ_TIMEOUT_MS, [] as ReadPoint[]))),
    ])
    todo.forEach((item, i) => {
      const made = deskQuoteFrom(item, quoteRead[item.key], series[i] ?? [])
      const kept = made ?? deskCache.get(item.key)?.quote
      if (made) deskCache.set(item.key, { at: nowMs, quote: made })
      if (kept) quotes[item.key] = kept
    })
  }
  return { quotes, unknown }
}

let snapCache: { at: number; value: ReadSnapshot } | null = null
let snapInflight: Promise<ReadSnapshot> | null = null

/**
 * The snapshot, at most READ_SERVER_TTL_MS old. Never throws and never waits
 * past SNAPSHOT_TIMEOUT_MS: a slow or failed compose serves the last good
 * snapshot, or the empty one (the page then says it is reading).
 */
export async function readSnapshot(nowMs = Date.now()): Promise<ReadSnapshot> {
  if (snapCache && nowMs - snapCache.at < READ_SERVER_TTL_MS) return snapCache.value
  if (!snapInflight) {
    snapInflight = composeSnapshot(nowMs)
      .then((value) => {
        // An empty compose (every feed down) never replaces a good snapshot.
        if (Object.keys(value.quotes).length > 0 || !snapCache) snapCache = { at: Date.now(), value }
        return snapCache?.value ?? value
      })
      .catch(() => snapCache?.value ?? EMPTY_READ)
      .finally(() => {
        snapInflight = null
      })
  }
  return withTimeout(snapInflight, SNAPSHOT_TIMEOUT_MS, snapCache?.value ?? EMPTY_READ)
}

/**
 * The snapshot for a server RENDER. `/` is ISR (a front door must not render
 * per request — the 2026-10-06 finding), and the readers above fetch with
 * `cache: 'no-store'` (they are route-handler code), which would turn the
 * page dynamic. Inside Next's data cache the same reads are fine: the result
 * is what is cached, for the page's own minute (a shorter window here would
 * shorten the page's — Next takes the smaller of the two). The browser
 * re-reads at once when the copy it was served is older than its refresh.
 * Never throws.
 */
const cachedSnapshot = unstable_cache(async () => readSnapshot(), ['read-snapshot-v2'], { revalidate: 60 })

export async function readSnapshotForRender(): Promise<ReadSnapshot> {
  try {
    return await cachedSnapshot()
  } catch {
    return EMPTY_READ
  }
}

// ── The longer series ────────────────────────────────────────────────────────

/** What a range reads: the app's own frame and how many bars of it, or the index chart's interval + range. */
const APP_RANGE: Record<ReadRange, { tf: ChartTf; keep: number }> = {
  '1d': { tf: '15m', keep: READ_DAY_BARS },
  '1w': { tf: '1h', keep: 168 },
  '1m': { tf: '4h', keep: 180 },
  '6m': { tf: '1d', keep: 180 },
}
const INDEX_RANGE: Record<ReadRange, { interval: string; range: string }> = {
  '1d': { interval: '15m', range: '5d' },
  '1w': { interval: '60m', range: '5d' },
  '1m': { interval: '60m', range: '1mo' },
  '6m': { interval: '1d', range: '6mo' },
}
/** How long a range's series is served from memory. */
export const READ_SERIES_TTL_MS: Record<ReadRange, number> = { '1d': 30_000, '1w': 5 * 60_000, '1m': 15 * 60_000, '6m': 60 * 60_000 }

const seriesCache = new Map<string, { at: number; points: ReadPoint[] }>()

/** One instrument's series for a range; [] when the feed did not answer (never a throw). */
export async function readSeries(id: ReadId, range: ReadRange, nowMs = Date.now()): Promise<ReadPoint[]> {
  const key = `${id}:${range}`
  const hit = seriesCache.get(key)
  if (hit && nowMs - hit.at < READ_SERIES_TTL_MS[range]) return hit.points
  const inst = readInstrument(id)
  let points: ReadPoint[] = []
  if (inst.source === 'app') {
    const spec = APP_RANGE[range]
    points = await withTimeout(appPoints(inst.symbol, spec.tf, spec.keep), READ_TIMEOUT_MS, [] as ReadPoint[])
  } else {
    const spec = INDEX_RANGE[range]
    const chart = await fetchIndexChart(inst.symbol, spec.interval, spec.range)
    if (chart) {
      if (range === '1d') points = indexQuoteOf(inst, chart, nowMs)?.points ?? []
      else points = barsOf(chart).map((b) => [b.t, b.c] as const)
    }
  }
  points = thinReadPoints(points)
  if (points.length >= 2) seriesCache.set(key, { at: nowMs, points })
  return points.length >= 2 ? points : (hit?.points ?? [])
}

/** A desk symbol's series for a longer range (a token, a stock or a perp: anything that is not one of the nine). [] when the feed did not answer. */
export async function readSymbolSeries(symbolRaw: string, range: ReadRange, nowMs = Date.now()): Promise<ReadPoint[]> {
  const item = deskItemFor(symbolRaw) ?? ((await withTimeout(resolveChartPair(symbolRaw).then(() => null), READ_TIMEOUT_MS, null)), deskItemFor(symbolRaw))
  if (!item) return []
  if (item.inst) return readSeries(item.inst.id, range, nowMs)
  const key = `s:${item.key}:${range}`
  const hit = seriesCache.get(key)
  if (hit && nowMs - hit.at < READ_SERIES_TTL_MS[range]) return hit.points
  const spec = APP_RANGE[range]
  const raw = range === '1d' ? await withTimeout(deskDayPoints(item), READ_TIMEOUT_MS, [] as ReadPoint[]) : await withTimeout(appPoints(item.key, spec.tf, spec.keep), READ_TIMEOUT_MS, [] as ReadPoint[])
  const points = thinReadPoints(raw)
  if (points.length >= 2) seriesCache.set(key, { at: nowMs, points })
  return points.length >= 2 ? points : (hit?.points ?? [])
}

/** For the pins and a cold start in a test: forget what was read. */
export function resetReadCache(): void {
  snapCache = null
  snapInflight = null
  seriesCache.clear()
  deskCache.clear()
}
