'use client'

// The live tape's feeds (2026-10-06; Dune relay 2026-10-13). Two adapters
// behind one interface:
//
//   • dune — Dune's real-time trade feeds (HyperCore, Lighter, Lighter
//     Robinhood perps; the DEX spot trial on Ethereum/Base/Arbitrum),
//     through OUR relay: `GET /api/live/stream` is a Server-Sent Events
//     response the browser holds with an EventSource, and the server holds
//     the authenticated upstream socket (lib/dune-feed-server) — the key
//     never reaches a browser. Carries the taker's position EFFECT, the
//     block, the hash and both parties. A relay without the key answers 503
//     `unconfigured`, and the adapter says so by name — it never pretends.
//   • hyperliquid — the venue's own `trades` WebSocket, keyless and
//     CORS-open, opened by the browser: the fallback when the relay is not
//     configured (a dev machine without the key, an outage). No position
//     effect, no block.
//
// connectTape is the opener the splash's pulse and the battle views use:
// it tries Dune, and on `unconfigured` opens the venue's socket on the same
// handlers and tells the caller which one it is reading. /live keeps its
// Feeds card and picks explicitly.
//
// Fills are handed over in batches (one per animation frame at most), so a
// 100-fill second is one React update, not a hundred. A feed reconnects
// with backoff on its own; the status it reports is what the page prints.

import { DEFAULT_LIVE_VENUES, venueWords, type DuneVenueId, type LiveStreamEvent } from '@/lib/dune'
import { fillFromHl, pickTapeMarkets, subscriptionDelta, type HlWsTrade, type TapeFields, type TapeFill, type TapeSource, type TapeVenue, type UniverseRow } from '@/lib/tape'

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unconfigured' | 'closed'

export interface FeedHandlers {
  onFills: (fills: TapeFill[]) => void
  onStatus: (status: FeedStatus, detail?: string) => void
  /** Dune replaced a block (op UPDATE): drop that block's fills before the
   *  new set merges. A feed that never corrects never calls it. */
  onRetract?: (venue: TapeVenue, block: number) => void
  /** connectTape says which transport it ended up reading. */
  onSource?: (source: TapeSource) => void
  /** The relay's backfill (`backfill: true`): the prints it already held,
   *  oldest first, before any live batch. */
  onBackfill?: (fills: TapeFill[], sinceMs: number) => void
}

export interface TapeFeed {
  source: TapeSource
  /** The pill's words. */
  label: string
  fields: TapeFields
  /** Open the stream for these markets; the return closes it. */
  connect: (markets: readonly string[], handlers: FeedHandlers) => () => void
}

/** A live stream that can be re-aimed without a reconnect. */
export interface TapeHandle {
  close: () => void
  /** Subscribe to the markets `next` adds and drop the ones it leaves out
   *  (the venue's socket, lib/tape subscriptionDelta), or re-aim the relay's
   *  filter; a stream still connecting, or reconnecting later, opens on
   *  `next`. */
  setMarkets: (next: readonly string[]) => void
}

/** The old name, kept for the pulse's import. */
export type HlTapeHandle = TapeHandle

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

/** Coalesce fills into one delivery per frame. */
function batcher(onFills: (fills: TapeFill[]) => void): { push: (f: TapeFill) => void; stop: () => void } {
  let pending: TapeFill[] = []
  let scheduled = false
  let stopped = false
  const flush = () => {
    scheduled = false
    if (stopped || pending.length === 0) return
    const out = pending
    pending = []
    onFills(out)
  }
  return {
    push(f) {
      if (stopped) return
      pending.push(f)
      if (!scheduled) {
        scheduled = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
        else setTimeout(flush, 50)
      }
    },
    stop() {
      stopped = true
      pending = []
    },
  }
}

const hlSub = (coin: string, method: 'subscribe' | 'unsubscribe') => JSON.stringify({ method, subscription: { type: 'trades', coin } })

function openHlTape(initial: readonly string[], handlers: FeedHandlers): TapeHandle {
  let markets = [...initial]
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  const batch = batcher(handlers.onFills)

  const open = () => {
    if (closed) return
    handlers.onStatus(attempt === 0 ? 'connecting' : 'reconnecting', attempt === 0 ? undefined : `attempt ${attempt + 1}`)
    try {
      ws = new WebSocket(HL_WS_URL)
    } catch (err) {
      handlers.onStatus('closed', err instanceof Error ? err.message : 'socket refused')
      return
    }
    const sock = ws
    sock.onopen = () => {
      attempt = 0
      for (const coin of markets) sock.send(hlSub(coin, 'subscribe'))
      handlers.onStatus('live', `${markets.length} markets`)
      // The venue drops a quiet socket; a ping a minute keeps a thin market's subscription alive.
      ping = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ method: 'ping' }))
      }, 50_000)
    }
    sock.onmessage = (ev) => {
      let msg: { channel?: string; data?: unknown }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return
      for (const row of msg.data as HlWsTrade[]) {
        const f = fillFromHl(row)
        if (f) batch.push(f)
      }
    }
    sock.onerror = () => {
      // onclose follows; the reconnect lives there.
    }
    sock.onclose = () => {
      if (ping) clearInterval(ping)
      ping = null
      if (closed) return
      attempt++
      const wait = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))
      handlers.onStatus('reconnecting', `in ${Math.round(wait / 1000)}s`)
      retry = setTimeout(open, wait)
    }
  }
  open()
  return {
    close() {
      closed = true
      batch.stop()
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
      handlers.onStatus('closed')
    },
    setMarkets(next) {
      if (closed) return
      const { add, drop } = subscriptionDelta(markets, next)
      markets = [...next]
      if (!ws || ws.readyState !== WebSocket.OPEN) return // it subscribes to `markets` when it opens
      if (add.length === 0 && drop.length === 0) return
      for (const coin of drop) ws.send(hlSub(coin, 'unsubscribe'))
      for (const coin of add) ws.send(hlSub(coin, 'subscribe'))
      handlers.onStatus('live', `${markets.length} markets`)
    },
  }
}

/** The splash's pulse opens the stream on its fallback list the moment it
 *  mounts and re-aims it when the venue's universe answers (lib/pulse) — on
 *  the same socket, so a chart never shows a reconnect as a quiet second.
 *  Additive beside hlTapeFeed.connect, which /live keeps calling. */
export function connectHlTape(markets: readonly string[], handlers: FeedHandlers): TapeHandle {
  return openHlTape(markets, handlers)
}

export const hlTapeFeed: TapeFeed = {
  source: 'hyperliquid',
  label: 'Hyperliquid · trades WebSocket',
  fields: { effect: false, block: false },
  connect(markets, handlers) {
    return openHlTape(markets, handlers).close
  },
}

// ── Dune, through the relay ──────────────────────────────────────────────────

export const LIVE_STREAM_PATH = '/api/live/stream'

export interface DuneTapeOptions {
  /** Which venues the relay reads (lib/dune DuneVenueId); default every one. */
  venues?: readonly DuneVenueId[]
  /** Narrow the relay to the markets given (the pulse, the battle); false
   *  = the firehose, every market the venues print (/live). */
  filter?: boolean
  /** Ask for the prints the relay already holds first (a print frame). */
  backfill?: boolean
}

const TAPE_VENUE_OF: Record<DuneVenueId, TapeVenue> = { hypercore: 'hyperliquid', lighter: 'lighter', 'lighter-robinhood': 'lighter-robinhood', 'dex-ethereum': 'dex', 'dex-base': 'dex', 'dex-arbitrum': 'dex' }

function streamUrl(venues: readonly DuneVenueId[], markets: readonly string[] | null, backfill = false): string {
  const q = new URLSearchParams()
  q.set('venues', venues.join(','))
  if (markets && markets.length) q.set('markets', markets.join(','))
  if (backfill) q.set('backfill', '1')
  return `${LIVE_STREAM_PATH}?${q.toString()}`
}

/**
 * Hold the relay's Server-Sent Events. A probe first (`?probe=1`, one small
 * JSON answer) tells a missing key apart from a dropped socket — an
 * EventSource reports neither a status code nor a body — so `unconfigured`
 * is said by name and a caller can fall back. Then the EventSource: the
 * relay says `bye` before its own limit and the adapter reopens at once;
 * a dropped connection reconnects with backoff; a block the venue replaced
 * is retracted before its new fills merge.
 */
export function openDuneTape(initial: readonly string[], handlers: FeedHandlers, opts: DuneTapeOptions = {}): TapeHandle {
  const venues = opts.venues && opts.venues.length ? [...opts.venues] : [...DEFAULT_LIVE_VENUES]
  const filter = opts.filter === true
  let markets = [...initial]
  let es: EventSource | null = null
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  const batch = batcher(handlers.onFills)
  const venueStatus = new Map<DuneVenueId, 'connecting' | 'live' | 'reconnecting' | 'closed'>()

  const report = () => {
    const live = venues.filter((v) => venueStatus.get(v) === 'live')
    if (live.length) {
      handlers.onStatus('live', `${venueWords(live)}${live.length < venues.length ? ` · ${venues.length - live.length} reconnecting` : ''}`)
      return
    }
    const re = venues.find((v) => venueStatus.get(v) === 'reconnecting')
    if (re) handlers.onStatus('reconnecting', `${re}`)
    else handlers.onStatus('connecting')
  }

  const open = () => {
    if (closed) return
    handlers.onStatus(attempt === 0 ? 'connecting' : 'reconnecting', attempt === 0 ? undefined : `attempt ${attempt + 1}`)
    const url = streamUrl(venues, filter ? markets : null, opts.backfill === true)
    let src: EventSource
    try {
      src = new EventSource(url)
    } catch (err) {
      handlers.onStatus('closed', err instanceof Error ? err.message : 'stream refused')
      return
    }
    es = src
    src.addEventListener('hello', () => {
      attempt = 0
      venueStatus.clear()
      report()
    })
    src.addEventListener('status', (ev) => {
      let e: LiveStreamEvent
      try {
        e = JSON.parse((ev as MessageEvent).data) as LiveStreamEvent
      } catch {
        return
      }
      if (e.type !== 'status') return
      venueStatus.set(e.venue, e.status)
      report()
    })
    src.addEventListener('backfill', (ev) => {
      let e: LiveStreamEvent
      try {
        e = JSON.parse((ev as MessageEvent).data) as LiveStreamEvent
      } catch {
        return
      }
      if (e.type !== 'backfill') return
      handlers.onBackfill?.(e.fills, e.sinceMs)
    })
    src.addEventListener('fills', (ev) => {
      let e: LiveStreamEvent
      try {
        e = JSON.parse((ev as MessageEvent).data) as LiveStreamEvent
      } catch {
        return
      }
      if (e.type !== 'fills') return
      if (venueStatus.get(e.venue) !== 'live') {
        venueStatus.set(e.venue, 'live')
        report()
      }
      if (e.op === 'UPDATE' && e.block != null) handlers.onRetract?.(TAPE_VENUE_OF[e.venue], e.block)
      for (const f of e.fills) batch.push(f)
    })
    src.addEventListener('bye', () => {
      // The relay's own rollover: reopen now, no backoff, no gap worth a word.
      if (src !== es || closed) return
      src.close()
      es = null
      open()
    })
    src.onerror = () => {
      if (src !== es || closed) return
      if (src.readyState === EventSource.CONNECTING) return // the browser's own retry is under way
      src.close()
      es = null
      attempt++
      const wait = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))
      handlers.onStatus('reconnecting', `in ${Math.round(wait / 1000)}s`)
      retry = setTimeout(open, wait)
    }
  }

  // The probe: unconfigured is a word, not a dropped socket.
  fetch(`${LIVE_STREAM_PATH}?probe=1`, { cache: 'no-store' })
    .then(async (res) => {
      if (closed) return
      if (res.status === 503) {
        let detail = 'the relay has no feed key'
        try {
          const j = (await res.json()) as { detail?: string }
          if (j.detail) detail = j.detail
        } catch {}
        handlers.onStatus('unconfigured', detail)
        return
      }
      open()
    })
    .catch(() => {
      if (closed) return
      handlers.onStatus('closed', 'the relay did not answer')
    })

  return {
    close() {
      closed = true
      batch.stop()
      if (retry) clearTimeout(retry)
      es?.close()
      es = null
      handlers.onStatus('closed')
    },
    setMarkets(next) {
      if (closed) return
      const { add, drop } = subscriptionDelta(markets, next)
      markets = [...next]
      if (!filter) return // the firehose carries every market already
      if (add.length === 0 && drop.length === 0) return
      if (!es) return // it opens on `markets`
      // Re-aim the relay's filter: open the new query before closing the old
      // one, so the chart never shows the swap as a quiet second (lib/tape
      // mergeFills drops the overlap by id).
      const old = es
      es = null
      open()
      old.close()
    },
  }
}

export const duneTapeFeed: TapeFeed = {
  source: 'dune',
  label: 'Dune · real-time feeds',
  fields: { effect: true, block: true },
  connect(markets, handlers) {
    return openDuneTape(markets, handlers, { filter: false }).close
  },
}

/**
 * The opener the splash's pulse and the battle views use: Dune through the
 * relay when the relay has its key, else the venue's keyless socket on the
 * same handlers — and `onSource` says which, so the page prints the truth
 * ("Dune · live" / "Hyperliquid · live"). The handle re-aims whichever
 * stream is live.
 */
export function connectTape(markets: readonly string[], handlers: FeedHandlers, opts: DuneTapeOptions = {}): TapeHandle {
  let current: TapeHandle | null = null
  let closed = false
  let want = [...markets]
  const fallback = () => {
    if (closed) return
    handlers.onSource?.('hyperliquid')
    current = openHlTape(want, handlers)
  }
  handlers.onSource?.('dune')
  current = openDuneTape(markets, {
    ...handlers,
    onStatus: (s, d) => {
      if (s === 'unconfigured') {
        current?.close()
        current = null
        fallback()
        return
      }
      handlers.onStatus(s, d)
    },
  }, { ...opts, filter: opts.filter ?? true })
  return {
    close() {
      closed = true
      current?.close()
      current = null
    },
    setMarkets(next) {
      want = [...next]
      current?.setMarkets(next)
    },
  }
}

export const TAPE_FEEDS: readonly TapeFeed[] = [hlTapeFeed, duneTapeFeed]

export function feedFor(source: TapeSource): TapeFeed {
  return TAPE_FEEDS.find((f) => f.source === source) ?? hlTapeFeed
}

/** The venue's universe with 24h volume, main book and the xyz dex, read
 *  from the browser (the info API is CORS-open). Either read failing leaves
 *  its half empty; the caller falls back to FALLBACK_MARKETS when both do. */
export async function readTapeUniverse(signal?: AbortSignal): Promise<{ main: UniverseRow[]; xyz: UniverseRow[] }> {
  const read = async (dex?: string): Promise<UniverseRow[]> => {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }),
        signal,
      })
      if (!res.ok) return []
      const [meta, ctxs] = (await res.json()) as [{ universe: { name: string; isDelisted?: boolean }[] }, { dayNtlVlm: string }[]]
      return meta.universe.map((u, i) => ({ name: u.name, volumeUsd: Number(ctxs[i]?.dayNtlVlm ?? 0), delisted: Boolean(u.isDelisted) }))
    } catch {
      return []
    }
  }
  const [main, xyz] = await Promise.all([read(), read('xyz')])
  return { main, xyz }
}

export { pickTapeMarkets }
