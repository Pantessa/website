// Arrival intent — the same-tab, one-shot handoff that lets a chip clicked on
// a PUBLIC page (/markets) RUN in the app (/chat) the moment it mounts.
//
// The contract this keeps intact (memory `chip-send-contract`, CHIP_CONTRACT):
//   "A chip SENDS. A link PREFILLS. A URL never fires a turn."
// The user's gesture on /markets IS the send; navigation is only where it
// renders. So the intent travels OUT OF BAND — sessionStorage (same tab only),
// versioned, 60s TTL, removed on take — never in the URL, never in a cookie,
// never in localStorage. `/chat?prompt=` opened from anywhere keeps prefilling.
//
// Squad ARRIVAL (2026-09-16) — CORE owns this file. Every decision about
// whether a record may RUN lives in lib/arrival-fence.ts (SECURITY's), which
// fails closed: this module only parses, stores and one-shots.

import { arrivalAllowed } from '@/lib/arrival-fence'

export type ArrivalIntent = {
  v: 1
  /** The ask exactly as the public page composed it (a chip's sentence). */
  text: string
  /** MCP slugs to activate before sending; omitted = the native gates claim it. */
  mcps?: string[]
  /** window.location.pathname of the sender (fenced: must be a public front door). */
  from: string
  /** Date.now() at write. */
  at: number
}

export const ARRIVAL_KEY = 'pantessa.arrival.v1'
export const ARRIVAL_TTL_MS = 60_000
/** Where a sender navigates after writing the intent. NEVER `?prompt=`. */
export const ARRIVAL_APP_HREF = '/chat'

/** The tab's own store, or null when storage is blocked (private mode, an
 *  embed with third-party storage off, a server render). Every caller treats
 *  null as "no handoff" and degrades to the prefill URL. */
function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Pure: parse a raw storage value into a live intent, or null (stale /
 *  malformed / fenced). The fence is the only authority on "may this run"; a
 *  record it refuses reads exactly like an absent one. */
export function parseArrivalIntent(raw: string | null, now: number = Date.now()): ArrivalIntent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!arrivalAllowed(parsed, now).ok) return null
  // The fence just proved the shape; narrow it and hand back only the fields
  // the receiver is allowed to act on (an unknown extra key never travels).
  const i = parsed as ArrivalIntent
  const mcps = Array.isArray(i.mcps) ? i.mcps.slice() : undefined
  return { v: 1, text: i.text, from: i.from, at: i.at, ...(mcps && mcps.length > 0 ? { mcps } : {}) }
}

/** Write the intent for the next /chat mount in THIS tab. Returns false when
 *  storage is unavailable OR the fence would refuse the record — either way
 *  the sender falls back to the `?prompt=` prefill, which is the honest
 *  degradation (the visitor still lands on their ask, and presses send). */
export function writeArrivalIntent(i: Omit<ArrivalIntent, 'v' | 'at'>, now: number = Date.now()): boolean {
  const s = store()
  if (!s) return false
  const intent: ArrivalIntent = { v: 1, text: i.text, from: i.from, at: now, ...(i.mcps && i.mcps.length > 0 ? { mcps: i.mcps } : {}) }
  if (!arrivalAllowed(intent, now).ok) return false
  try {
    s.setItem(ARRIVAL_KEY, JSON.stringify(intent))
    return true
  } catch {
    return false
  }
}

/** Read AND remove (one-shot). Null when absent, stale, malformed or fenced —
 *  and the record is removed in every one of those cases, so a refused or
 *  expired handoff can never be retried by a reload, a back button or a
 *  second surface mounting in the same tab. */
export function takeArrivalIntent(now: number = Date.now()): ArrivalIntent | null {
  const s = store()
  if (!s) return null
  let raw: string | null = null
  try {
    raw = s.getItem(ARRIVAL_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    s.removeItem(ARRIVAL_KEY)
  } catch {
    // Storage went away mid-read: the parse below still one-shots this mount,
    // and the record expires on its own within the TTL.
  }
  return parseArrivalIntent(raw, now)
}
