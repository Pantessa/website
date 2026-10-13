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
//
// THE LEAK (prod, 2026-10-13): on Vercel a browser's disconnect reaches
// neither `req.signal` nor the stream's `cancel`, so a closed tab or a
// reconnect left a phantom writer counted against the address until the
// 285s hold expired — six reloads and the page read `429` for five
// minutes. Now a writer watches its own backpressure: when the consumer
// has stopped pulling (`desiredSize` ≤ 0 on two heartbeats in a row, 30s)
// the client is gone and the writer releases itself; the cap counts only
// writers younger than the hold, so a leak can never outlive one.

import { NextResponse } from 'next/server'
import { DUNE_FEED_KEY_ENV, DUNE_VENUE_IDS, LIVE_STREAM_HEARTBEAT_MS, LIVE_STREAM_HOLD_MS, LIVE_STREAM_PER_INSTANCE, LIVE_STREAM_PER_IP, duneFeedKey, parseMarketList, parseVenueList, type LiveStreamEvent } from '@/lib/dune'
import { duneBackfill, duneUpstreamStats, subscribeDune } from '@/lib/dune-feed-server'
import { clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A literal: Next reads segment config statically. lib/dune pins it equal to
// LIVE_STREAM_MAX_DURATION_S, which the hold below is derived from.
export const maxDuration = 300

const enc = new TextEncoder()
/** Open writers by address: when each opened. A writer older than the hold
 *  plus a little slack cannot be alive (it said bye), so it never counts. */
const store = globalThis as typeof globalThis & { __liveStreams?: Map<string, Map<string, number>> }
const perIp = (store.__liveStreams ??= new Map())
const STALE_MS = LIVE_STREAM_HOLD_MS + 15_000

function liveWriters(ip: string, now: number): number {
  const m = perIp.get(ip)
  if (!m) return 0
  for (const [id, at] of m) if (now - at > STALE_MS) m.delete(id)
  if (m.size === 0) perIp.delete(ip)
  return m.size
}

function liveWritersAll(now: number): number {
  let n = 0
  for (const ip of [...perIp.keys()]) n += liveWriters(ip, now)
  return n
}

/** Two heartbeats with the consumer not pulling = the client is gone. */
const DEAD_BEATS = 2

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
  // `?backfill=1`: the prints the relay already holds (a print frame's first minutes), before the live ones.
  const backfill = sp.get('backfill') === '1'
  const ip = clientIpFrom(req.headers) ?? 'local'
  const now = Date.now()
  const held = liveWriters(ip, now)
  const total = liveWritersAll(now)
  if (held >= LIVE_STREAM_PER_IP || total >= LIVE_STREAM_PER_INSTANCE) {
    return NextResponse.json({ error: 'busy', detail: held >= LIVE_STREAM_PER_IP ? `this address already holds ${held} live streams` : 'this server is at its stream cap' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '5' } })
  }
  const writerId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const mine = perIp.get(ip) ?? new Map<string, number>()
  mine.set(writerId, now)
  perIp.set(ip, mine)

  let closed = false
  let unsub: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let hold: ReturnType<typeof setTimeout> | null = null
  let stalled = 0
  const release = () => {
    if (closed) return
    closed = true
    unsub?.()
    if (heartbeat) clearInterval(heartbeat)
    if (hold) clearTimeout(hold)
    const m = perIp.get(ip)
    if (m) {
      m.delete(writerId)
      if (m.size === 0) perIp.delete(ip)
    }
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
      if (backfill) {
        for (const v of venues) {
          const b = duneBackfill(v, want)
          send(sse({ type: 'backfill', venue: v, fills: b.fills, sinceMs: b.sinceMs }))
        }
      }
      unsub = subscribeDune(venues, (e) => {
        if (e.type !== 'fills') {
          send(sse(e))
          return
        }
        const fills = want ? e.fills.filter((f) => want.has(f.market)) : e.fills
        if (fills.length === 0 && e.op === 'INSERT') return
        send(sse({ ...e, fills }))
      })
      heartbeat = setInterval(() => {
        // Backpressure is the only word a gone client leaves on this host.
        if (c.desiredSize !== null && c.desiredSize <= 0) {
          stalled++
          if (stalled >= DEAD_BEATS) {
            release()
            try {
              c.close()
            } catch {
              // already closed
            }
            return
          }
        } else {
          stalled = 0
        }
        send(enc.encode(': hb\n\n'))
      }, LIVE_STREAM_HEARTBEAT_MS)
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
