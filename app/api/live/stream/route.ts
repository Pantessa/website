// GET /api/live/stream — Dune's real-time trades, relayed to the page as
// Server-Sent Events (2026-10-13).
//
// The page cannot open Dune's socket itself (the key rides the upgrade
// header), so it opens THIS: a plain same-origin GET an EventSource can
// hold. lib/dune-feed-server keeps one upstream socket per venue for the
// whole instance and this handler is one reader of it. Each event is one
// block's fills in lib/tape's TapeFill shape, so the page's adapter
// (lib/tape-feed duneTapeFeed) is a field map of nothing — it merges what
// arrives. `?venues=` picks the venues (default: every one the key
// reaches); `?markets=` narrows to the venue spellings given (the splash's
// pulse and the battle views read a pick; /live reads everything).
//
// Honesty: the response says `hello` with what it will carry, prints each
// venue's status by name as it changes, and says `bye` before the function's
// own limit so the browser reopens cleanly instead of reading a dropped
// socket as a quiet market. Without the key it answers 503 `unconfigured` —
// the page then falls back to the venue's keyless socket and SAYS so.
// Public, like the page; a per-address cap keeps one browser from holding
// every function slot.

import { NextResponse } from 'next/server'
import { DUNE_FEED_KEY_ENV, DUNE_VENUE_IDS, LIVE_STREAM_HEARTBEAT_MS, LIVE_STREAM_HOLD_MS, LIVE_STREAM_PER_INSTANCE, LIVE_STREAM_PER_IP, duneFeedKey, parseMarketList, parseVenueList, type LiveStreamEvent } from '@/lib/dune'
import { duneUpstreamStats, subscribeDune } from '@/lib/dune-feed-server'
import { clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A literal: Next reads segment config statically. lib/dune pins it equal to
// LIVE_STREAM_MAX_DURATION_S, which the hold below is derived from.
export const maxDuration = 300

const enc = new TextEncoder()
const store = globalThis as typeof globalThis & { __liveStreams?: Map<string, number>; __liveStreamsTotal?: number }
const perIp = (store.__liveStreams ??= new Map())

function sse(e: LiveStreamEvent): Uint8Array {
  return enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
}

export async function GET(req: Request) {
  if (!duneFeedKey()) {
    return NextResponse.json({ error: 'unconfigured', detail: `${DUNE_FEED_KEY_ENV} is not set` }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  const sp = new URL(req.url).searchParams
  // The page's probe: a missing key is a 503 above; a present one is this
  // small JSON — an EventSource reports neither a status nor a body.
  if (sp.get('probe')) return NextResponse.json({ keyed: true, venues: DUNE_VENUE_IDS, upstream: duneUpstreamStats() }, { headers: { 'cache-control': 'no-store' } })
  const venues = parseVenueList(sp.get('venues'))
  const markets = parseMarketList(sp.get('markets'))
  const want = markets.length ? new Set(markets) : null
  const ip = clientIpFrom(req.headers) ?? 'local'
  const held = perIp.get(ip) ?? 0
  const total = store.__liveStreamsTotal ?? 0
  if (held >= LIVE_STREAM_PER_IP || total >= LIVE_STREAM_PER_INSTANCE) {
    return NextResponse.json({ error: 'busy', detail: held >= LIVE_STREAM_PER_IP ? `this address already holds ${held} live streams` : 'this server is at its stream cap' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '5' } })
  }
  perIp.set(ip, held + 1)
  store.__liveStreamsTotal = total + 1

  let closed = false
  let unsub: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let hold: ReturnType<typeof setTimeout> | null = null
  const release = () => {
    if (closed) return
    closed = true
    unsub?.()
    if (heartbeat) clearInterval(heartbeat)
    if (hold) clearTimeout(hold)
    const n = (perIp.get(ip) ?? 1) - 1
    if (n <= 0) perIp.delete(ip)
    else perIp.set(ip, n)
    store.__liveStreamsTotal = Math.max(0, (store.__liveStreamsTotal ?? 1) - 1)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (chunk: Uint8Array) => {
        if (closed) return
        try {
          c.enqueue(chunk)
        } catch {
          release()
        }
      }
      send(enc.encode('retry: 1000\n\n'))
      send(sse({ type: 'hello', venues, markets, keyed: true, closesInMs: LIVE_STREAM_HOLD_MS }))
      unsub = subscribeDune(venues, (e) => {
        if (e.type !== 'fills') {
          send(sse(e))
          return
        }
        const fills = want ? e.fills.filter((f) => want.has(f.market)) : e.fills
        if (fills.length === 0 && e.op === 'INSERT') return
        send(sse({ ...e, fills }))
      })
      heartbeat = setInterval(() => send(enc.encode(': hb\n\n')), LIVE_STREAM_HEARTBEAT_MS)
      hold = setTimeout(() => {
        send(sse({ type: 'bye', reason: 'max-duration' }))
        release()
        try {
          c.close()
        } catch {
          // already closed by the client
        }
      }, LIVE_STREAM_HOLD_MS)
      req.signal.addEventListener('abort', () => {
        release()
        try {
          c.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      release()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
