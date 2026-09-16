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
// Squad ARRIVAL (2026-09-16) — CORE owns this file. Stub committed by the
// coordinator so every lane compiles against the same names.

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

/** Pure: parse a raw storage value into a live intent, or null (stale / malformed / fenced). */
export function parseArrivalIntent(_raw: string | null, _now: number = Date.now()): ArrivalIntent | null {
  return null // CORE builds this
}

/** Write the intent for the next /chat mount in THIS tab. Returns false when storage is unavailable. */
export function writeArrivalIntent(_i: Omit<ArrivalIntent, 'v' | 'at'>, _now: number = Date.now()): boolean {
  return false // CORE builds this
}

/** Read AND remove (one-shot). Null when absent, stale, malformed or fenced. */
export function takeArrivalIntent(_now: number = Date.now()): ArrivalIntent | null {
  return null // CORE builds this
}
