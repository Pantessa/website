// Arrival fence — the pure verdict on whether a handed-off intent may RUN on
// arrival. Fails CLOSED: anything this file does not explicitly allow is
// dropped, and the receiver then behaves like a plain /chat load.
//
// Squad ARRIVAL (2026-09-16) — SECURITY owns this file (CORE imports it from
// `takeArrivalIntent`). Stub committed by the coordinator: it refuses
// everything until SECURITY lands the real rules.

export type ArrivalRefusal = 'malformed' | 'version' | 'stale' | 'future' | 'source' | 'text'
export type ArrivalVerdict = { ok: true } | { ok: false; reason: ArrivalRefusal }

/** Public front doors allowed to hand an intent to the app (pathname prefixes). */
export const ARRIVAL_SOURCES: readonly string[] = ['/markets']

/** Longest ask a handoff may carry. */
export const ARRIVAL_MAX_TEXT = 280

export function arrivalAllowed(_i: unknown, _now: number = Date.now()): ArrivalVerdict {
  return { ok: false, reason: 'malformed' } // SECURITY builds this
}
