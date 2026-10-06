'use client'

// The live tape's feeds (2026-10-06). The browser subscribes directly — a
// serverless host cannot hold a socket open, and the venue's stream is
// public, keyless and CORS-open (its own app reads it the same way). Two
// adapters behind one interface:
//
//   • hyperliquid — the venue's `trades` WebSocket, today's feed. Carries
//     side, size, price, time, the L1 hash and the two addresses; it does
//     NOT carry the taker's position effect or the block.
//   • dune — the slot for a position-aware chain stream. Reads
//     NEXT_PUBLIC_DUNE_STREAM_URL (a WebSocket URL; `?markets=` appended)
//     and maps each row through lib/tape fillFromDune. Unset, the adapter
//     reports `unconfigured` and the page says so by name — it never
//     pretends. When Dune's API lands, this file is the whole integration.
//
// Fills are handed over in batches (one per animation frame at most), so a
// 100-fill second is one React update, not a hundred. A feed reconnects
// with backoff on its own; the status it reports is what the page prints.

import { fillFromDune, fillFromHl, pickTapeMarkets, type HlWsTrade, type TapeFields, type TapeFill, type TapeSource, type UniverseRow } from '@/lib/tape'

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unconfigured' | 'closed'

export interface FeedHandlers {
  onFills: (fills: TapeFill[]) => void
  onStatus: (status: FeedStatus, detail?: string) => void
}

export interface TapeFeed {
  source: TapeSource
  /** The pill's words. */
  label: string
  fields: TapeFields
  /** Open the stream for these markets; the return closes it. */
  connect: (markets: readonly string[], handlers: FeedHandlers) => () => void
}

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

export const hlTapeFeed: TapeFeed = {
  source: 'hyperliquid',
  label: 'Hyperliquid · trades WebSocket',
  fields: { effect: false, block: false },
  connect(markets, handlers) {
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
        for (const coin of markets) sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin } }))
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
    return () => {
      closed = true
      batch.stop()
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
      handlers.onStatus('closed')
    }
  },
}

/** The Dune slot. Configure NEXT_PUBLIC_DUNE_STREAM_URL to a WebSocket that
 *  sends JSON rows (one or an array) in the DuneStreamRow shape. */
export const duneTapeFeed: TapeFeed = {
  source: 'dune',
  label: 'Dune · real-time chain stream',
  fields: { effect: true, block: true },
  connect(markets, handlers) {
    const url = process.env.NEXT_PUBLIC_DUNE_STREAM_URL
    if (!url) {
      handlers.onStatus('unconfigured', 'NEXT_PUBLIC_DUNE_STREAM_URL is not set')
      return () => {}
    }
    let closed = false
    const batch = batcher(handlers.onFills)
    handlers.onStatus('connecting')
    const sep = url.includes('?') ? '&' : '?'
    const ws = new WebSocket(`${url}${sep}markets=${encodeURIComponent(markets.join(','))}`)
    ws.onopen = () => handlers.onStatus('live', `${markets.length} markets`)
    ws.onmessage = (ev) => {
      let data: unknown
      try {
        data = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const rows = Array.isArray(data) ? data : [data]
      for (const row of rows) {
        const f = fillFromDune(row)
        if (f) batch.push(f)
      }
    }
    ws.onclose = () => {
      if (!closed) handlers.onStatus('closed', 'stream closed')
    }
    return () => {
      closed = true
      batch.stop()
      ws.close()
      handlers.onStatus('closed')
    }
  },
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
