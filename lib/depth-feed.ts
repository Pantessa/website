// THE DEPTH CHART'S BOOK FEEDS (2026-10-13). The browser holds them: both
// venues publish their books on keyless WebSockets (measured from node with
// no key the day this shipped):
//   • Coinbase Advanced Trade `level2` — the whole book as a snapshot, then
//     every change (`new_quantity` 0 removes the level). The Exchange feed's
//     `level2` channel refuses without auth; `level2_batch` still answers but
//     only as `level2_50`, the top fifty. Advanced Trade is the full book.
//   • Hyperliquid `l2Book` — the whole book on every change, twenty rungs a
//     side at the precision asked (nSigFigs 3 = the coarse, wide picture the
//     book route already draws).
// A serverless host cannot hold a socket (#965's reason for the Dune relay),
// but these are public: one socket per viewer, straight from the page, the
// battle views' `midsFeed` idiom. When a socket will not open, the venue's
// book route (`/api/markets/spot-book`, `/api/markets/book`) is polled instead
// and the foot says "every Ns" instead of "live" — never a silent downgrade.
//
// Pure rules live in lib/depth (the parsers, the deltas); this file is I/O.

import { applyL2Changes, bookFromRoute, parseCoinbaseL2, parseCoinbaseTicker, parseHlBbo, parseHlL2Book, type BookFeedStatus, type DepthBook, type DepthVenue, EMPTY_BOOK, type TopQuote } from '@/lib/depth'

export const COINBASE_WS_URL = 'wss://advanced-trade-ws.coinbase.com'
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'
/** The poll lane's cadence when a socket is refused (the routes' own TTLs). */
export const BOOK_POLL_MS: Record<DepthVenue, number> = { coinbase: 5_000, hyperliquid: 5_000 }
/** Socket attempts before the feed falls to polling. */
const SOCKET_TRIES = 2

export interface BookFeedHandlers {
  onBook: (book: DepthBook) => void
  onStatus: (s: BookFeedStatus, detail?: string) => void
}

export interface BookFeedHandle {
  close: () => void
}

/** The venue's product spelling for a chart pair. */
export function bookProductFor(venue: DepthVenue, pair: { symbol: string; source: string; pair: string }): string {
  if (venue === 'coinbase') return pair.source === 'coinbase' ? pair.pair : `${pair.symbol}-USD`
  return pair.source === 'hyperliquid' ? pair.pair : pair.symbol
}

function pollRoute(venue: DepthVenue, symbol: string, h: BookFeedHandlers): () => void {
  const url = venue === 'coinbase' ? `/api/markets/spot-book?symbol=${encodeURIComponent(symbol)}` : `/api/markets/book?symbol=${encodeURIComponent(symbol)}`
  let alive = true
  const ms = BOOK_POLL_MS[venue]
  const load = async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const body = (await res.json()) as { bids?: { px: number; usd: number }[]; asks?: { px: number; usd: number }[]; at?: number; missing?: string }
      if (!alive) return
      if (body.missing) {
        h.onStatus('missing', body.missing)
        return
      }
      const book = bookFromRoute(body)
      if (book) {
        h.onBook(book)
        h.onStatus('polling', `every ${Math.round(ms / 1000)}s`)
      }
    } catch {
      if (alive) h.onStatus('reconnecting', 'poll failed')
    }
  }
  void load()
  const timer = setInterval(() => void load(), ms)
  return () => {
    alive = false
    clearInterval(timer)
  }
}

/**
 * Open the venue's book for one instrument. The socket first; after
 * SOCKET_TRIES refused opens the poll lane takes over for the life of the
 * handle (a page reload tries the socket again).
 */
export function openBookFeed(venue: DepthVenue, pair: { symbol: string; source: string; pair: string }, h: BookFeedHandlers): BookFeedHandle {
  const product = bookProductFor(venue, pair)
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  let stopPoll: (() => void) | null = null
  let book: DepthBook = EMPTY_BOOK
  let gotSnapshot = false

  const fallBack = (why: string) => {
    if (closed || stopPoll) return
    h.onStatus('connecting', `socket ${why} · polling`)
    stopPoll = pollRoute(venue, pair.symbol, h)
  }

  const open = () => {
    if (closed || stopPoll) return
    if (attempt >= SOCKET_TRIES) {
      fallBack('refused')
      return
    }
    h.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    let sock: WebSocket
    try {
      sock = new WebSocket(venue === 'coinbase' ? COINBASE_WS_URL : HL_WS_URL)
    } catch (err) {
      fallBack(err instanceof Error ? err.message : 'refused')
      return
    }
    ws = sock
    gotSnapshot = false
    let opened = false
    sock.onopen = () => {
      opened = true
      if (venue === 'coinbase') sock.send(JSON.stringify({ type: 'subscribe', product_ids: [product], channel: 'level2' }))
      else {
        sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: product, nSigFigs: 3 } }))
        ping = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ method: 'ping' }))
        }, 50_000)
      }
    }
    sock.onmessage = (ev) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const at = Date.now()
      if (venue === 'coinbase') {
        const m = msg as { type?: string; message?: string }
        if (m.type === 'error') {
          // "Failed to subscribe" and the like: the venue said no — poll instead.
          sock.close()
          attempt = SOCKET_TRIES
          fallBack(m.message ?? 'error')
          return
        }
        for (const e of parseCoinbaseL2(msg)) {
          if (e.product !== product) continue
          if (e.kind === 'snapshot') {
            book = applyL2Changes(EMPTY_BOOK, e.changes, at)
            gotSnapshot = true
            attempt = 0
            h.onStatus('live')
          } else if (gotSnapshot) book = applyL2Changes(book, e.changes, at)
          else continue
          h.onBook(book)
        }
      } else {
        const next = parseHlL2Book(msg, at)
        if (!next) return
        if (!gotSnapshot) {
          gotSnapshot = true
          attempt = 0
          h.onStatus('live')
        }
        book = next
        h.onBook(book)
      }
    }
    sock.onclose = () => {
      if (ping) clearInterval(ping)
      ping = null
      if (closed || stopPoll) return
      attempt++
      if (!opened || !gotSnapshot) {
        // Never opened, or opened and said nothing: count it and try again, then poll.
        if (attempt >= SOCKET_TRIES) {
          fallBack('refused')
          return
        }
      }
      const wait = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))
      h.onStatus('reconnecting', `in ${Math.round(wait / 1000)}s`)
      retry = setTimeout(open, wait)
    }
    sock.onerror = () => {
      /* onclose follows */
    }
  }
  open()
  return {
    close: () => {
      closed = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      stopPoll?.()
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
    },
  }
}

/** Socket attempts in a row before the top-of-book feed gives up (the header
 *  then follows the prints, then the poll — lib/chart-live pickLivePrice). */
const TOP_TRIES = 5

/**
 * The venue's best bid and ask for the header (lib/depth TopQuote): Coinbase
 * Advanced Trade `ticker` (+ `heartbeats`, or a quiet product's subscription
 * closes inside ~90s) or Hyperliquid `bbo` (pinged, like the book). Every
 * quote goes to `onQuote`; `onQuote(null)` when the socket drops, so the
 * header never holds a price the feed no longer vouches for. It stays open
 * while the tab is hidden: the tab's title is what a hidden tab shows.
 */
export function openTopOfBook(venue: DepthVenue, pair: { symbol: string; source: string; pair: string }, onQuote: (q: TopQuote | null) => void): BookFeedHandle {
  const product = bookProductFor(venue, pair)
  let ws: WebSocket | null = null
  let closed = false
  let fails = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let ping: ReturnType<typeof setInterval> | null = null
  const open = () => {
    if (closed) return
    let sock: WebSocket
    try {
      sock = new WebSocket(venue === 'coinbase' ? COINBASE_WS_URL : HL_WS_URL)
    } catch {
      return
    }
    ws = sock
    let quoted = false
    sock.onopen = () => {
      if (venue === 'coinbase') {
        sock.send(JSON.stringify({ type: 'subscribe', product_ids: [product], channel: 'ticker' }))
        sock.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }))
      } else {
        sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'bbo', coin: product } }))
        ping = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ method: 'ping' }))
        }, 50_000)
      }
    }
    sock.onmessage = (ev) => {
      let msg: unknown
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const q = venue === 'coinbase' ? parseCoinbaseTicker(msg, product) : parseHlBbo(msg, product)
      if (!q || closed) return
      quoted = true
      fails = 0
      onQuote(q)
    }
    sock.onclose = () => {
      if (ping) clearInterval(ping)
      ping = null
      if (closed) return
      onQuote(null)
      if (!quoted) fails++
      if (fails >= TOP_TRIES) return
      retry = setTimeout(open, Math.min(15_000, 500 * 2 ** Math.min(fails, 5)))
    }
    sock.onerror = () => {
      /* onclose follows */
    }
  }
  open()
  return {
    close: () => {
      closed = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close()
    },
  }
}
