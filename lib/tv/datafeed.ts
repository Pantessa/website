// The datafeed: Pantessa's candles and prints, served the way the library
// asks for them. Browser-only at run time; the paging and the tick rules it
// leans on are pure (lib/tv/bars) and pinned.
//
// The library owns the schedule. It asks for history backwards (the first
// request ends just past now, each later one ends where the last answer
// began) and subscribes to realtime once per series. We answer from the
// endpoints the built-in chart already reads:
//
//   history   GET /api/charts/candles?symbol&tf&warmup=1     the newest window
//             GET /api/charts/candles?symbol&tf&before=<s>   one older page
//   realtime  the same window, polled per frame; and on the frames with a
//             live tail (lib/chart-live) the instrument's own prints fold
//             into the forming bar between polls
//   10s       no venue serves a ten-second bar: the bars are built from the
//             venue's trade tape (/api/charts/trades) and the prints
//
// Rules from the library's datafeed guide that shaped this file: every
// callback fires exactly once and never synchronously; bars are fresh
// objects; `to` is exclusive; the end of history is said (`noData`), not
// inferred; a realtime bar never goes backwards; every subscription is
// served until ITS unsubscribe; every backend call has a timeout.

import { chartPairFor, chartableSymbols, isPrintTf, type Candle, type ChartPair, type ChartTf } from '@/lib/charts'
import { PRINT_KEEP_MS, barsFromPrints, chartLiveFeed, seedThenPrints, tailIsLive, type Print } from '@/lib/chart-live'
import { fillLabel, type FillMarker } from '@/lib/chart-fills'
import { openDuneTape, type FeedStatus } from '@/lib/tape-feed'
import { barsBefore, foldPrint, olderPageCursor, ticksSince, toTvBars } from './bars'
import { ALL_TV_RESOLUTIONS, TF_SECONDS, tfOfResolution } from './resolution'
import { searchPairs, searchRowFor, symbolInfoFor } from './symbol'
import type { TvBar, TvDatafeed, TvDatafeedConfig, TvHistoryMeta, TvMark, TvPeriodParams, TvSearchResult, TvSymbolInfo, TvTimescaleMark } from './types'

/** How often a frame's window is re-read (the built-in chart's cadence). */
export const TV_POLL_MS: Readonly<Record<ChartTf, number>> = { '10s': 5_000, '1m': 5_000, '15m': 8_000, '1h': 15_000, '4h': 20_000, '1d': 30_000 }
const FETCH_TIMEOUT_MS = 12_000

export interface WindowRead {
  symbol: string
  label: string | null
  source: string | null
  feed: string | null
  tf: ChartTf
  last: number | null
  changePct24h: number | null
}

export interface NewsMark {
  t: number
  label: string
  url?: string
}

export interface DatafeedHooks {
  /** The symbol the page is on: its reads feed the header, its marks draw. */
  mainSymbol: string
  /** The frame the chart opens on (sizes the first read). */
  initialTf: ChartTf
  /** A fresh window of the main symbol landed (the header's numbers). */
  onWindow?: (w: WindowRead) => void
  /** A live print of the main symbol (the header follows it between polls). */
  onPrint?: (price: number) => void
  /** The live tail's status, for the foot. */
  onTail?: (status: FeedStatus) => void
  /** A series lost bars it cannot repair by ticking (the tab slept): the
   *  page must ask the chart to reload its data. */
  onGap?: () => void
  /** The wallet's fills and the news marks, read at ask time. */
  fills?: () => readonly FillMarker[]
  news?: () => readonly NewsMark[]
  /** Inks for the fill marks. */
  inks?: () => { up: string; down: string; fg: string; bg: string; accent: string }
}

interface CandlesBody {
  symbol?: string
  label?: string | null
  source?: string | null
  feed?: string | null
  candles?: Candle[]
  warmup?: Candle[]
  older?: Candle[]
  exhausted?: boolean
  last?: number | null
  changePct24h?: number | null
  error?: string
}

async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal })
    if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

const candlesUrl = (symbol: string, tf: ChartTf, extra = '') => `/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}${extra}`

interface SeriesState {
  /** The feed that drew the first window: an older page from another tape is never spliced on. */
  feed: string | null
  /** The newest bar handed to the library (history or tick). */
  last: TvBar | null
  /** Open time (ms) of the oldest bar handed over. */
  oldestMs: number | null
  exhausted: boolean
  /** A print frame: the relay's backfill has been folded into history once. */
  backfilled: boolean
  /** A print frame: the newest trade already counted in history (ms). */
  seenAt: number
}

interface Sub {
  guid: string
  symbol: string
  tf: ChartTf
  key: string
  onTick: (bar: TvBar) => void
  onReset: () => void
  timer: ReturnType<typeof setInterval> | null
  closeTape: (() => void) | null
  busy: boolean
  dead: boolean
  /** A print frame: the newest venue trade already folded in (ms). */
  seenAt: number
  /** A print frame: Dune's prints have taken the live edge. */
  handedOff: boolean
}

export interface PantessaDatafeed extends TvDatafeed {
  /** Stop every poll and close every stream. */
  dispose(): void
  /** The newest price the main series has seen (the plan reads it). */
  lastPrice(): number | null
  /** The price scale the main symbol resolved with. */
  pricescale(): number | null
}

let universeMemo: ChartPair[] | null = null
function universe(): ChartPair[] {
  if (!universeMemo) universeMemo = chartableSymbols().flatMap((s) => chartPairFor(s) ?? [])
  return universeMemo
}

export function createPantessaDatafeed(hooks: DatafeedHooks): PantessaDatafeed {
  const main = hooks.mainSymbol.toUpperCase()
  const series = new Map<string, SeriesState>()
  const subs = new Map<string, Sub>()
  /** The first window per series, read once by resolveSymbol and reused by the first getBars. */
  const firstWindow = new Map<string, Promise<CandlesBody | null>>()
  let mainLast: number | null = null
  let mainScale: number | null = null
  let disposed = false

  /** A print frame's own prints (the relay's backfill and every live print), newest last, by venue id. */
  const printRing = new Map<string, { id: string; at: number; price: number; size: number }[]>()
  /** Fold prints into a series' ring. Says whether any of them is older than what the ring held. */
  const keepPrints = (key: string, fills: readonly { id: string; at: number; price: number; size: number }[]): boolean => {
    const ring = printRing.get(key) ?? []
    const seen = new Set(ring.map((p) => p.id))
    const oldest = ring.length ? ring[0].at : Infinity
    const floor = Date.now() - PRINT_KEEP_MS
    let older = false
    for (const f of fills) {
      if (seen.has(f.id) || f.at < floor || !(f.price > 0)) continue
      seen.add(f.id)
      ring.push({ id: f.id, at: f.at, price: f.price, size: f.size })
      if (f.at < oldest) older = true
    }
    ring.sort((a, b) => a.at - b.at)
    let cut = 0
    while (cut < ring.length && ring[cut].at < floor) cut++
    if (cut) ring.splice(0, cut)
    printRing.set(key, ring)
    return older
  }

  const keyOf = (symbol: string, tf: ChartTf) => `${symbol.toUpperCase()}:${tf}`
  const stateOf = (key: string): SeriesState => {
    let s = series.get(key)
    if (!s) {
      s = { feed: null, last: null, oldestMs: null, exhausted: false, backfilled: false, seenAt: 0 }
      series.set(key, s)
    }
    return s
  }
  const isMain = (symbol: string) => symbol.toUpperCase() === main

  const readWindow = (symbol: string, tf: ChartTf, warmup: boolean): Promise<CandlesBody | null> =>
    getJson<CandlesBody>(candlesUrl(symbol, isPrintTf(tf) ? '1m' : tf, warmup ? '&warmup=1' : '')).catch(() => null)

  /** One older page. A venue's rate limit is a moment, not an answer: one
   *  quiet retry before the chart is told the feed is down. */
  const readOlder = async (symbol: string, tf: ChartTf, cursor: number): Promise<CandlesBody | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = await getJson<CandlesBody>(candlesUrl(symbol, tf, `&before=${cursor}`)).catch(() => null)
      if (body && body.error !== 'feed unavailable') return body
      if (attempt === 0) await new Promise((r) => setTimeout(r, 900))
    }
    return null
  }

  const report = (symbol: string, tf: ChartTf, body: CandlesBody | null) => {
    if (!body || !isMain(symbol) || !body.candles?.length) return
    const last = body.last ?? body.candles[body.candles.length - 1].c
    mainLast = last
    hooks.onWindow?.({ symbol: body.symbol ?? symbol, label: body.label ?? null, source: body.source ?? null, feed: isPrintTf(tf) ? 'prints' : (body.feed ?? body.source ?? null), tf, last, changePct24h: body.changePct24h ?? null })
  }

  const readTrades = async (symbol: string): Promise<Print[]> => {
    const body = await getJson<{ prints?: Print[] }>(`/api/charts/trades?symbol=${encodeURIComponent(symbol)}`).catch(() => null)
    return Array.isArray(body?.prints) ? body.prints : []
  }

  const feed: PantessaDatafeed = {
    onReady(cb) {
      const config: TvDatafeedConfig = {
        supported_resolutions: [...ALL_TV_RESOLUTIONS],
        supports_marks: true,
        supports_timescale_marks: true,
        supports_time: false,
        exchanges: [],
        symbols_types: [],
      }
      setTimeout(() => cb(config), 0)
    },

    searchSymbols(input, _exchange, _type, onResult) {
      const direct = chartPairFor(input)
      const found = searchPairs(input, universe())
      const rows: TvSearchResult[] = (direct && !found.some((p) => p.symbol === direct.symbol) ? [direct, ...found] : found).map(searchRowFor)
      setTimeout(() => onResult(rows), 0)
    },

    resolveSymbol(name, onResolve, onError) {
      const pair = chartPairFor(name.includes(':') ? name.slice(name.indexOf(':') + 1) : name)
      if (!pair) {
        setTimeout(() => onError('unknown_symbol'), 0)
        return
      }
      // One read sizes the decimals and is reused as the first history answer.
      const tf = hooks.initialTf
      const key = keyOf(pair.symbol, tf)
      let first = firstWindow.get(key)
      if (!first) {
        first = readWindow(pair.symbol, tf, !isPrintTf(tf))
        firstWindow.set(key, first)
        // Good for one history request made right away; a later one reads fresh.
        setTimeout(() => {
          if (firstWindow.get(key) === first) firstWindow.delete(key)
        }, 8_000)
      }
      void first.then((body) => {
        const candles = body?.candles ?? []
        const lastPrice = body?.last ?? (candles.length ? candles[candles.length - 1].c : null)
        const info: TvSymbolInfo = symbolInfoFor(pair, lastPrice)
        if (isMain(pair.symbol)) mainScale = info.pricescale
        onResolve(info)
      })
    },

    getBars(info, resolution, period, onResult, onError) {
      const tf = tfOfResolution(resolution)
      if (!tf) {
        setTimeout(() => onError(`unsupported resolution ${resolution}`), 0)
        return
      }
      void history(info.ticker, tf, period).then(
        ({ bars, meta }) => onResult(bars, meta),
        (err: unknown) => onError(err instanceof Error && err.message ? err.message : 'feed unavailable'),
      )
    },

    subscribeBars(info, resolution, onTick, guid, onReset) {
      const tf = tfOfResolution(resolution)
      if (!tf || disposed) return
      const symbol = info.ticker
      const key = keyOf(symbol, tf)
      const sub: Sub = { guid, symbol, tf, key, onTick, onReset, timer: null, closeTape: null, busy: false, dead: false, seenAt: stateOf(key).seenAt, handedOff: false }
      const prior = subs.get(guid)
      if (prior) closeSub(prior)
      subs.set(guid, sub)
      sub.timer = setInterval(() => void poll(sub), TV_POLL_MS[tf])
      // The history answer may be a few seconds old by now: one read right
      // away, so the forming bar is current before the first interval.
      setTimeout(() => void poll(sub), 1_200)
      openTail(sub)
    },

    unsubscribeBars(guid) {
      const sub = subs.get(guid)
      if (!sub) return
      closeSub(sub)
      subs.delete(guid)
    },

    getMarks(info, from, to, onData) {
      const fills = isMain(info.ticker) ? (hooks.fills?.() ?? []) : []
      const ink = hooks.inks?.() ?? { up: '#22c55e', down: '#ef4444', fg: '#ffffff', bg: '#000000', accent: '#22c55e' }
      const marks: TvMark[] = fills
        .filter((f) => f.t >= from && f.t <= to)
        .map((f) => ({
          id: `fill:${f.id}`,
          time: f.t,
          color: { border: f.side === 'buy' ? ink.up : ink.down, background: f.side === 'buy' ? ink.up : ink.down },
          text: fillLabel(f, info.ticker),
          label: f.side === 'buy' ? 'B' : 'S',
          labelFontColor: ink.bg,
          minSize: 18,
        }))
      setTimeout(() => onData(marks), 0)
    },

    getTimescaleMarks(info, from, to, onData) {
      const news = isMain(info.ticker) ? (hooks.news?.() ?? []) : []
      const ink = hooks.inks?.()
      const marks: TvTimescaleMark[] = news
        .filter((n) => n.t >= from && n.t <= to)
        .map((n, i) => ({ id: `news:${n.t}:${i}`, time: n.t, color: ink?.accent ?? '#22c55e', label: 'N', tooltip: [n.label] }))
      setTimeout(() => onData(marks), 0)
    },

    dispose() {
      disposed = true
      for (const sub of subs.values()) closeSub(sub)
      subs.clear()
    },
    lastPrice: () => mainLast,
    pricescale: () => mainScale,
  }

  function closeSub(sub: Sub) {
    sub.dead = true
    if (sub.timer) clearInterval(sub.timer)
    sub.timer = null
    sub.closeTape?.()
    sub.closeTape = null
  }

  /** One history answer. Throws only on a retryable feed miss. */
  async function history(symbol: string, tf: ChartTf, period: TvPeriodParams): Promise<{ bars: TvBar[]; meta: TvHistoryMeta }> {
    const key = keyOf(symbol, tf)
    const st = stateOf(key)

    if (isPrintTf(tf)) {
      // The whole print frame is one page: what the venue's tape still holds.
      if (!period.firstDataRequest) return { bars: [], meta: { noData: true } }
      const [venue, body] = await Promise.all([readTrades(symbol), firstWindow.get(key) ?? readWindow(symbol, tf, false)])
      report(symbol, tf, body)
      // The venue's own tape up to the relay's first print, the relay's prints from there (one moment is never counted twice).
      const prints = seedThenPrints(venue, printRing.get(key) ?? [], Date.now())
      const bars = barsBefore(toTvBars(barsFromPrints(prints, TF_SECONDS[tf]), tf), period.to)
      st.feed = 'prints'
      st.last = bars.length ? bars[bars.length - 1] : null
      st.oldestMs = bars.length ? bars[0].time : null
      st.exhausted = true
      st.seenAt = prints.reduce((m, p) => Math.max(m, p.at), 0)
      for (const sub of subs.values()) if (sub.key === key) sub.seenAt = st.seenAt
      return { bars, meta: { noData: true } }
    }

    if (period.firstDataRequest) {
      const cached = firstWindow.get(key)
      firstWindow.delete(key)
      const body = (await cached) ?? (await readWindow(symbol, tf, true))
      if (!body) throw new Error('feed unavailable')
      if (!body.candles?.length) {
        if (body.error === 'feed unavailable') throw new Error('feed unavailable')
        return { bars: [], meta: { noData: true } }
      }
      report(symbol, tf, body)
      const all = toTvBars([...(body.warmup ?? []), ...body.candles], tf)
      const bars = barsBefore(all, period.to)
      st.feed = body.feed ?? body.source ?? null
      st.exhausted = false
      st.oldestMs = bars.length ? bars[0].time : null
      st.last = bars.length ? { ...bars[bars.length - 1] } : null
      return { bars, meta: bars.length ? {} : { noData: true } }
    }

    if (st.exhausted) return { bars: [], meta: { noData: true } }
    // Older than what the chart holds: the page that ends where it begins.
    const cursor = Math.min(period.to, st.oldestMs !== null ? olderPageCursor(st.oldestMs) : period.to)
    const body = await readOlder(symbol, tf, cursor)
    if (!body || body.error === 'feed unavailable') throw new Error('feed unavailable')
    // A page from another tape (a stock's fallback feed) is never spliced on.
    if (st.feed && body.feed && body.feed !== st.feed) {
      st.exhausted = true
      return { bars: [], meta: { noData: true } }
    }
    const bars = barsBefore(toTvBars(body.older ?? [], tf), cursor)
    if (bars.length) st.oldestMs = bars[0].time
    if (body.exhausted || !bars.length) st.exhausted = true
    return { bars, meta: st.exhausted ? { noData: true } : {} }
  }

  function push(sub: Sub, bar: TvBar) {
    if (sub.dead) return
    const st = stateOf(sub.key)
    if (st.last && bar.time < st.last.time) return
    st.last = { ...bar }
    if (isMain(sub.symbol)) mainLast = bar.close
    try {
      sub.onTick({ ...bar })
    } catch {
      // the library refused the bar: the next poll re-seeds
    }
  }

  async function poll(sub: Sub) {
    if (sub.dead || sub.busy) return
    if (typeof document !== 'undefined' && document.hidden) return
    sub.busy = true
    try {
      const st = stateOf(sub.key)
      if (isPrintTf(sub.tf)) {
        const body = await readWindow(sub.symbol, sub.tf, false)
        report(sub.symbol, sub.tf, body)
        // The venue's tape keeps the frame moving until the prints take the live edge.
        if (!sub.handedOff) {
          const prints = (await readTrades(sub.symbol)).filter((p) => p.at > sub.seenAt).sort((a, b) => a.at - b.at)
          for (const p of prints) {
            sub.seenAt = Math.max(sub.seenAt, p.at)
            const bar = foldPrint(st.last, p, sub.tf)
            if (bar) push(sub, bar)
          }
        }
        return
      }
      const body = await readWindow(sub.symbol, sub.tf, false)
      if (sub.dead || !body?.candles?.length) return
      report(sub.symbol, sub.tf, body)
      const window = toTvBars(body.candles, sub.tf)
      // The tab slept through a whole window: ticking cannot repair the hole.
      if (st.last && window.length && window[0].time > st.last.time) {
        sub.onReset()
        hooks.onGap?.()
        return
      }
      for (const bar of ticksSince(window, st.last?.time ?? null)) push(sub, bar)
    } finally {
      sub.busy = false
    }
  }

  /** The instrument's own prints fold into the forming bar between polls. Main symbol only: one stream a page. */
  function openTail(sub: Sub) {
    if (!isMain(sub.symbol)) return
    const pair = chartPairFor(sub.symbol)
    const live = chartLiveFeed(pair)
    if (!live || !tailIsLive(sub.tf, live)) {
      hooks.onTail?.('idle')
      return
    }
    const handle = openDuneTape(
      live.markets,
      {
        onStatus: (s) => hooks.onTail?.(s),
        // A print frame opens on the few trades the venue's tape still holds.
        // The relay then hands over the minutes it kept: they are HISTORY,
        // which a tick cannot add, so the series is reloaded once with them in.
        onBackfill: (fills) => {
          if (sub.dead || !isPrintTf(sub.tf)) return
          const st = stateOf(sub.key)
          const older = keepPrints(sub.key, fills)
          if (!older || st.backfilled) return
          st.backfilled = true
          sub.onReset()
          hooks.onGap?.()
        },
        onFills: (batch) => {
          if (sub.dead) return
          const st = stateOf(sub.key)
          if (isPrintTf(sub.tf)) keepPrints(sub.key, batch)
          let price: number | null = null
          for (const f of [...batch].sort((a, b) => a.at - b.at)) {
            if (isPrintTf(sub.tf)) {
              // Already in the history answer: never counted twice.
              if (f.at <= sub.seenAt) continue
              sub.handedOff = true
            }
            const bar = foldPrint(st.last, { at: f.at, price: f.price, size: f.size }, sub.tf)
            if (!bar) continue
            push(sub, bar)
            price = f.price
          }
          if (price !== null) hooks.onPrint?.(price)
        },
      },
      { venues: live.venues, filter: true, backfill: isPrintTf(sub.tf) },
    )
    sub.closeTape = () => handle.close()
  }

  return feed
}
