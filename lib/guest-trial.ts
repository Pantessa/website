// Guest trial lane for the first-party chat (/chat): a signed-out visitor can
// send a handful of turns before the sign-in gate closes. The chat API has
// always accepted anonymous house-model turns (the embed runs on them) — the
// old full-screen sign-in scrim only ever blocked honest visitors, and the
// cohort funnel showed ~93% of arrivals bouncing on it before their first ask.
//
// The count lives in sessionStorage (per tab-session, survives reloads) and a
// window event fans out changes so the gate re-renders the moment the limit
// lands. This is UX honesty, not a security boundary — the API itself is the
// same one the keyless embed uses.

export const GUEST_TRIAL_LIMIT = 5

const KEY = 'yf_guest_turns'
const EVT = 'yf-guest-turn'

/** Turns this guest session has already sent. SSR-safe (0). */
export function guestTurnsUsed(): number {
  if (typeof window === 'undefined') return 0
  try {
    return Number(window.sessionStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

/** Record one guest turn and notify subscribers (the sign-in gate). */
export function bumpGuestTurns(): void {
  try {
    window.sessionStorage.setItem(KEY, String(guestTurnsUsed() + 1))
  } catch {
    /* storage blocked — the trial just never exhausts */
  }
  window.dispatchEvent(new Event(EVT))
}

/** useSyncExternalStore subscription for the turn count. */
export function subscribeGuestTrial(cb: () => void): () => void {
  window.addEventListener(EVT, cb)
  return () => window.removeEventListener(EVT, cb)
}
