'use client'

// The battle views' venue reads (2026-10-06). Like the live tape, the browser
// talks to Hyperliquid directly — the info API is keyless and CORS-open, the
// WebSocket too — so nothing here touches our servers and nothing is stored.
//
//   • readFrontCandles — one-minute candles for a window (candleSnapshot),
//     folded into open/close samples: the ground before the page opened.
//   • readArmyContexts — mark, open interest, funding, prev-day price and 24h
//     volume for every market, main book and the xyz dex (metaAndAssetCtxs).
//   • midsFeed — the allMids stream (main book, and the xyz dex when an army
//     lives there): a price every couple of seconds for every market, so the
//     front moves between fills too.
// Fills themselves come from lib/tape-feed's hlTapeFeed.

import { candleSamples, contextFrom, type ArmyContext, type PricePoint } from '@/lib/battle'
import { tapeMarket } from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

async function info<T>(body: unknown, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(HL_INFO_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** One-minute candles for the last `minutes`, as samples. Empty on any
 *  failure (the field then grounds on the first live price, and says so). */
export async function readFrontCandles(market: string, minutes: number, signal?: AbortSignal): Promise<PricePoint[]> {
  const now = Date.now()
  const rows = await info<{ t: number; T: number; o: string; c: string }[]>(
    { type: 'candleSnapshot', req: { coin: market, interval: '1m', startTime: now - (minutes + 2) * 60_000, endTime: now } },
    signal,
  )
  return Array.isArray(rows) ? candleSamples(rows) : []
}

/** The venue's context row per market, both dexes. A dex that fails to
 *  answer leaves its markets out; the scoreboard prints dashes for them. */
export async function readArmyContexts(signal?: AbortSignal): Promise<Map<string, ArmyContext>> {
  type Meta = [{ universe: { name: string }[] }, { markPx: string; openInterest: string; funding: string; prevDayPx: string; dayNtlVlm: string }[]]
  const out = new Map<string, ArmyContext>()
  const take = (res: Meta | null) => {
    if (!res || !Array.isArray(res) || !res[0]?.universe) return
    res[0].universe.forEach((u, i) => {
      const ctx = res[1][i] ? contextFrom(res[1][i]) : null
      if (ctx) out.set(u.name, ctx)
    })
  }
  const [main, xyz] = await Promise.all([info<Meta>({ type: 'metaAndAssetCtxs' }, signal), info<Meta>({ type: 'metaAndAssetCtxs', dex: 'xyz' }, signal)])
  take(main)
  take(xyz)
  return out
}

/**
 * Mids for the chosen markets as the venue publishes them. One socket, one
 * subscription per dex in play. Reconnects with backoff; the return closes it.
 */
export function midsFeed(markets: readonly string[], onMid: (market: string, price: number, at: number) => void, onStatus?: (s: FeedStatus, detail?: string) => void): () => void {
  const wanted = new Set(markets)
  const dexes = new Set<string | null>()
  for (const m of markets) dexes.add(tapeMarket(m).dex)
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let ping: ReturnType<typeof setInterval> | null = null

  const open = () => {
    if (closed) return
    onStatus?.(attempt === 0 ? 'connecting' : 'reconnecting')
    try {
      ws = new WebSocket(HL_WS_URL)
    } catch (err) {
      onStatus?.('closed', err instanceof Error ? err.message : 'socket refused')
      return
    }
    const sock = ws
    sock.onopen = () => {
      attempt = 0
      for (const dex of dexes) sock.send(JSON.stringify({ method: 'subscribe', subscription: dex ? { type: 'allMids', dex } : { type: 'allMids' } }))
      onStatus?.('live')
      ping = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ method: 'ping' }))
      }, 50_000)
    }
    sock.onmessage = (ev) => {
      let msg: { channel?: string; data?: { mids?: Record<string, string> } }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg.channel !== 'allMids' || !msg.data?.mids) return
      const at = Date.now()
      for (const m of wanted) {
        const raw = msg.data.mids[m]
        if (raw === undefined) continue
        const p = Number(raw)
        if (Number.isFinite(p) && p > 0) onMid(m, p, at)
      }
    }
    sock.onclose = () => {
      if (ping) clearInterval(ping)
      ping = null
      if (closed) return
      attempt++
      const wait = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))
      onStatus?.('reconnecting', `in ${Math.round(wait / 1000)}s`)
      retry = setTimeout(open, wait)
    }
  }
  open()
  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    if (ping) clearInterval(ping)
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
  }
}
