// ONE PULL of a Dune venue for the print-alert cron (2026-10-13): open the
// feed with the stored cursor, consume until the tip (or the budget), hand
// the fills back with the cursor to persist. Server only — the key rides
// the upgrade header (lib/dune duneFeedKey), as in lib/dune-feed-server,
// whose socket is a LIVE relay that never persists; this one is a batch
// reader that always does, after the caller evaluated the frames.
//
// What a pull returns is facts, judged by lib/print-alerts pullOutcome:
//   • `tip`      — a frame's block was within CAUGHT_UP_MS of the clock;
//                  the pull read TIP_SETTLE_MS more and closed itself.
//   • `budget`   — the wall-clock budget ran out mid-backlog; the cursor
//                  it reached is persisted and the next pass continues
//                  (measured replay ~60× real time: a pass gains ~40 min
//                  of backlog per 40s, so it catches up on its own).
//   • `idle`     — no frame for PULL_IDLE_MS (a quiet venue); cursor kept.
//   • `rejected` — a resumed socket died within CURSOR_REJECT_WINDOW_MS
//                  with no open and no frame: the venue refused the cursor
//                  (outside its retained range, or from the future). The
//                  caller records the gap and rejoins at the tip.
//   • `fell-behind` — close 1008; the caller reconnects once from the
//                  last durable cursor after a backoff.
// An UPDATE frame replaces the block's fills (the runbook: a complete
// replacement, never merged); the cursor moves only after a frame was
// parsed and kept.

import { duneFeedKey, duneVenue, fillsFromDuneFrame, resumeUrl, type DuneFrame, type DuneVenueId } from '@/lib/dune'
import { CAUGHT_UP_MS, CURSOR_REJECT_WINDOW_MS, PULL_IDLE_MS, TIP_SETTLE_MS, pullOutcome, type PullOutcome } from '@/lib/print-alerts'
import type { TapeFill } from '@/lib/tape'

export interface PullOptions {
  budgetMs: number
  caughtUpMs?: number
  settleMs?: number
  idleMs?: number
  /** The clock (tests). */
  now?: () => number
}

export interface PullResult {
  venue: DuneVenueId
  cursorIn: string | null
  /** The last sequence_number handled; null when no frame arrived. */
  cursorOut: string | null
  resumed: boolean
  opened: boolean
  frames: number
  updates: number
  fills: TapeFill[]
  firstSeq: string | null
  lastSeq: string | null
  /** The newest block's own stamp (ms), null without a frame. */
  tipAt: number | null
  /** How far behind the clock the first and the last frame were. */
  firstLagMs: number | null
  lastLagMs: number | null
  caughtUp: boolean
  outcome: PullOutcome
  closeCode: number | null
  closeReason: string
  elapsedMs: number
}

type HeaderedWebSocket = new (url: string, opts: { headers: Record<string, string> }) => WebSocket

export function pullDuneFeed(venueId: DuneVenueId, cursor: string | null, opts: PullOptions): Promise<PullResult> {
  const now = opts.now ?? (() => Date.now())
  const caughtUpMs = opts.caughtUpMs ?? CAUGHT_UP_MS
  const settleMs = opts.settleMs ?? TIP_SETTLE_MS
  const idleMs = opts.idleMs ?? PULL_IDLE_MS
  const venue = duneVenue(venueId)
  const key = duneFeedKey()
  const t0 = now()
  const base = (over: Partial<PullResult> = {}): PullResult => ({
    venue: venueId,
    cursorIn: cursor,
    cursorOut: null,
    resumed: false,
    opened: false,
    frames: 0,
    updates: 0,
    fills: [],
    firstSeq: null,
    lastSeq: null,
    tipAt: null,
    firstLagMs: null,
    lastLagMs: null,
    caughtUp: false,
    outcome: 'error',
    closeCode: null,
    closeReason: '',
    elapsedMs: now() - t0,
    ...over,
  })
  if (!venue || !key) return Promise.resolve(base({ outcome: 'unconfigured', closeReason: venue ? 'DUNE_BETA_API_KEY is not set' : 'unknown venue' }))
  const url = resumeUrl(venue.url, cursor)
  const resumed = url !== venue.url
  return new Promise<PullResult>((resolve) => {
    let ws: WebSocket
    try {
      ws = new (WebSocket as unknown as HeaderedWebSocket)(url, { headers: { 'X-Dune-Api-Key': key } })
    } catch (err) {
      resolve(base({ resumed, closeReason: err instanceof Error ? err.message : 'socket refused' }))
      return
    }
    ws.binaryType = 'arraybuffer'
    const r = base({ resumed })
    const blocks = new Map<string, TapeFill[]>()
    let budgetHit = false
    let idle = false
    let settled = false
    let done = false
    let budgetTimer: ReturnType<typeof setTimeout> | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const clear = () => {
      if (budgetTimer) clearTimeout(budgetTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (settleTimer) clearTimeout(settleTimer)
      budgetTimer = idleTimer = settleTimer = null
    }
    const stop = (why: 'budget' | 'idle' | 'settled') => {
      if (done) return
      if (why === 'budget') budgetHit = true
      if (why === 'idle') idle = true
      if (why === 'settled') settled = true
      try {
        ws.close()
      } catch {
        // already closing
      }
    }
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => stop('idle'), idleMs)
    }
    budgetTimer = setTimeout(() => stop('budget'), Math.max(500, opts.budgetMs))
    armIdle()
    ws.onopen = () => {
      r.opened = true
      armIdle()
    }
    ws.onmessage = (m: MessageEvent) => {
      if (done) return
      const text = typeof m.data === 'string' ? m.data : new TextDecoder().decode(m.data as ArrayBuffer)
      let frame: DuneFrame
      try {
        frame = JSON.parse(text) as DuneFrame
      } catch {
        return
      }
      r.frames++
      armIdle()
      const parsed = fillsFromDuneFrame(frame, venue)
      const seq = typeof frame.sequence_number === 'string' && /^\d+$/.test(frame.sequence_number) ? frame.sequence_number : null
      const blockAt = frame.block_timestamp ? Date.parse(frame.block_timestamp) : NaN
      const lag = Number.isFinite(blockAt) ? now() - blockAt : null
      if (r.frames === 1) {
        r.firstSeq = seq
        r.firstLagMs = lag
      }
      if (seq) r.lastSeq = seq
      r.lastLagMs = lag
      if (Number.isFinite(blockAt)) r.tipAt = blockAt
      if (parsed) {
        const key = parsed.block != null ? String(parsed.block) : `seq:${seq ?? r.frames}`
        if (parsed.op === 'UPDATE') {
          r.updates++
          blocks.set(key, parsed.fills) // a complete replacement of that block
        } else if (parsed.fills.length) {
          blocks.set(key, [...(blocks.get(key) ?? []), ...parsed.fills])
        }
      } else if (frame && typeof frame === 'object' && frame.op !== 'INSERT' && frame.op !== 'UPDATE') {
        console.warn(`[prints ${venueId}] unknown op ${String(frame.op)} at block ${String(frame.block_number)} — skipped`)
      }
      // The checkpoint moves only after the frame was handled.
      if (seq) r.cursorOut = seq
      if (!r.caughtUp && lag != null && lag < caughtUpMs) {
        r.caughtUp = true
        settleTimer = setTimeout(() => stop('settled'), settleMs)
      }
    }
    ws.onerror = () => {
      // onclose follows with the code.
    }
    ws.onclose = (ev: CloseEvent) => {
      if (done) return
      done = true
      clear()
      r.closeCode = typeof ev.code === 'number' ? ev.code : null
      r.closeReason = ev.reason || ''
      r.elapsedMs = now() - t0
      r.fills = [...blocks.values()].flat()
      r.outcome = pullOutcome({ resumed, opened: r.opened, frames: r.frames, closeCode: settled || budgetHit || idle ? null : r.closeCode, livedMs: r.elapsedMs, caughtUp: r.caughtUp, budgetHit, idle })
      resolve(r)
    }
  })
}
