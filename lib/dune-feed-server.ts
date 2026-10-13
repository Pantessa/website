// THE UPSTREAM (2026-10-13): one Dune socket per venue per server process,
// shared by every page reading it, relayed by app/api/live/stream.
//
// Why a server holds it: Dune authenticates the WebSocket upgrade with an
// `X-Dune-Api-Key` header, which a browser cannot send and which must never
// reach one. So this module opens the venue's feed with the key, parses each
// block envelope (lib/dune), and fans the fills out to every subscriber —
// N viewers on one instance cost Dune ONE connection per venue, not N. A
// serverless instance lives as long as its requests do; a relay response is
// held ~285s (LIVE_STREAM_HOLD_MS) and the browser reopens it, so the
// socket here outlives any single request and closes ten seconds after the
// last reader leaves.
//
// The runbook's rules, applied to a LIVE view (not a warehouse):
//   • resume: the last handled `sequence_number` is kept per venue and sent
//     as `?resume_after=` on a reconnect, so a blip replays what it missed;
//     the cursor lives in this process only — nothing is persisted, and a
//     cold instance starts at the live tip by design.
//   • 1008 (the consumer fell behind): rejoin at the TIP, and say so. A
//     live tape that replays its backlog only falls behind again.
//   • a cursor the venue rejects (two connections that die inside two
//     seconds of opening) is dropped; the stream rejoins at the tip.
//   • UPDATE replaces a block: the event carries `op` and the block, and
//     the page retracts that block's fills before merging the new set.
//   • an unknown `op` is logged with the venue's words and skipped.
// Never imported by a client module; the page talks to the relay only.

import { DUNE_VENUES, duneFeedKey, duneVenue, fillsFromDuneFrame, resumeUrl, type DuneFrame, type DuneVenueId, type LiveStreamEvent } from '@/lib/dune'

type Listener = (e: LiveStreamEvent) => void

interface Upstream {
  id: DuneVenueId
  ws: WebSocket | null
  listeners: Set<Listener>
  cursor: string | null
  attempt: number
  resumeFails: number
  openedAt: number
  retry: ReturnType<typeof setTimeout> | null
  idle: ReturnType<typeof setTimeout> | null
  status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed'
  detail?: string
  frames: number
  fills: number
  lastFrameAt: number
}

const store = globalThis as typeof globalThis & { __duneUpstreams?: Map<DuneVenueId, Upstream> }
const upstreams = (store.__duneUpstreams ??= new Map())

/** Ten seconds after the last reader leaves, the socket closes: a page
 *  reload keeps the stream warm; an abandoned tab does not pin a venue. */
const IDLE_CLOSE_MS = 10_000
const RESUME_REJECT_WINDOW_MS = 2_000

/** Node's global WebSocket (undici) takes `headers` as a second-argument
 *  option — the one way to send the key on the upgrade request. */
type HeaderedWebSocket = new (url: string, opts: { headers: Record<string, string> }) => WebSocket

function up(id: DuneVenueId): Upstream {
  let u = upstreams.get(id)
  if (!u) {
    u = { id, ws: null, listeners: new Set(), cursor: null, attempt: 0, resumeFails: 0, openedAt: 0, retry: null, idle: null, status: 'idle', frames: 0, fills: 0, lastFrameAt: 0 }
    upstreams.set(id, u)
  }
  return u
}

function tell(u: Upstream, e: LiveStreamEvent) {
  for (const l of u.listeners) {
    try {
      l(e)
    } catch {
      // a dead response; its own cleanup unsubscribes
    }
  }
}

function setStatus(u: Upstream, status: Upstream['status'], detail?: string) {
  u.status = status
  u.detail = detail
  if (status === 'idle') return
  tell(u, { type: 'status', venue: u.id, status, detail })
}

function open(u: Upstream) {
  const venue = duneVenue(u.id)
  const key = duneFeedKey()
  if (!venue || !key) {
    setStatus(u, 'closed', 'DUNE_BETA_API_KEY is not set')
    return
  }
  if (u.ws) return
  setStatus(u, u.attempt === 0 ? 'connecting' : 'reconnecting', u.attempt === 0 ? undefined : `attempt ${u.attempt + 1}`)
  const url = resumeUrl(venue.url, u.cursor)
  const resumed = url !== venue.url
  let ws: WebSocket
  try {
    ws = new (WebSocket as unknown as HeaderedWebSocket)(url, { headers: { 'X-Dune-Api-Key': key } })
  } catch (err) {
    setStatus(u, 'closed', err instanceof Error ? err.message : 'socket refused')
    return
  }
  ws.binaryType = 'arraybuffer'
  u.ws = ws
  u.openedAt = Date.now()
  ws.onopen = () => {
    u.attempt = 0
    setStatus(u, 'live', resumed ? 'resumed' : undefined)
  }
  ws.onmessage = (m: MessageEvent) => {
    const text = typeof m.data === 'string' ? m.data : new TextDecoder().decode(m.data as ArrayBuffer)
    let frame: DuneFrame
    try {
      frame = JSON.parse(text) as DuneFrame
    } catch {
      return
    }
    u.frames++
    u.lastFrameAt = Date.now()
    if (u.status !== 'live') setStatus(u, 'live')
    const parsed = fillsFromDuneFrame(frame, venue)
    if (!parsed) {
      if (frame && typeof frame === 'object' && frame.op !== 'INSERT' && frame.op !== 'UPDATE') console.warn(`[dune ${u.id}] unknown op ${String(frame.op)} at block ${String(frame.block_number)} — skipped`)
      return
    }
    if (parsed.fills.length || parsed.op === 'UPDATE') {
      u.fills += parsed.fills.length
      tell(u, { type: 'fills', venue: u.id, op: parsed.op, block: parsed.block, fills: parsed.fills })
    }
    // The checkpoint moves only after the frame was handed on.
    if (typeof frame.sequence_number === 'string' && /^\d+$/.test(frame.sequence_number)) u.cursor = frame.sequence_number
  }
  ws.onerror = () => {
    // onclose follows; the reconnect lives there.
  }
  ws.onclose = (ev: CloseEvent) => {
    u.ws = null
    if (u.listeners.size === 0) {
      setStatus(u, 'idle')
      return
    }
    const lived = Date.now() - u.openedAt
    if (ev.code === 1008) {
      // Fell behind. A live view rejoins at the tip rather than replaying.
      u.cursor = null
      u.resumeFails = 0
    } else if (resumed && lived < RESUME_REJECT_WINDOW_MS) {
      u.resumeFails++
      if (u.resumeFails >= 2) {
        console.warn(`[dune ${u.id}] cursor ${u.cursor} rejected twice (close ${ev.code} ${ev.reason || ''}) — rejoining at the tip`)
        u.cursor = null
        u.resumeFails = 0
      }
    } else {
      u.resumeFails = 0
    }
    u.attempt++
    const wait = Math.min(15_000, 500 * 2 ** Math.min(u.attempt, 5))
    setStatus(u, 'reconnecting', ev.code === 1008 ? `fell behind · rejoining at the tip in ${Math.round(wait / 1000)}s` : `in ${Math.round(wait / 1000)}s${ev.code ? ` (close ${ev.code})` : ''}`)
    u.retry = setTimeout(() => {
      u.retry = null
      open(u)
    }, wait)
  }
}

function closeUpstream(u: Upstream) {
  if (u.retry) clearTimeout(u.retry)
  u.retry = null
  const ws = u.ws
  u.ws = null
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      ws.close()
    } catch {
      // already gone
    }
  }
  u.attempt = 0
  u.status = 'idle'
}

/**
 * Read these venues. Every event the upstream emits reaches `onEvent`
 * (fills, status). The first subscriber opens a venue's socket; the return
 * unsubscribes, and the socket closes IDLE_CLOSE_MS after its last reader.
 * The current status of each venue is replayed to a new subscriber at once
 * so a fresh response never waits for the next change to print a word.
 */
export function subscribeDune(ids: readonly DuneVenueId[], onEvent: Listener): () => void {
  const subs: Upstream[] = []
  for (const id of ids) {
    const u = up(id)
    if (u.idle) {
      clearTimeout(u.idle)
      u.idle = null
    }
    u.listeners.add(onEvent)
    subs.push(u)
    if (u.status !== 'idle') onEvent({ type: 'status', venue: id, status: u.status === 'closed' ? 'closed' : u.status, detail: u.detail })
    if (!u.ws && !u.retry) open(u)
  }
  let done = false
  return () => {
    if (done) return
    done = true
    for (const u of subs) {
      u.listeners.delete(onEvent)
      if (u.listeners.size === 0 && !u.idle) {
        u.idle = setTimeout(() => {
          u.idle = null
          if (u.listeners.size === 0) closeUpstream(u)
        }, IDLE_CLOSE_MS)
      }
    }
  }
}

/** For a diagnostics line: what each venue's socket is doing right now. */
export function duneUpstreamStats(): { venue: DuneVenueId; status: Upstream['status']; readers: number; frames: number; fills: number; cursor: string | null; lastFrameAgoMs: number | null }[] {
  return DUNE_VENUES.map((v) => {
    const u = upstreams.get(v.id)
    return u
      ? { venue: v.id, status: u.status, readers: u.listeners.size, frames: u.frames, fills: u.fills, cursor: u.cursor, lastFrameAgoMs: u.lastFrameAt ? Date.now() - u.lastFrameAt : null }
      : { venue: v.id, status: 'idle', readers: 0, frames: 0, fills: 0, cursor: null, lastFrameAgoMs: null }
  })
}
