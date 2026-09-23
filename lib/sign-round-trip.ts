// lib/sign-round-trip.ts — the round trip a signature makes on a phone.
//
// OWNED BY THE SIGN LANE of the mobile-onboarding squad (2026-09-23). Pure:
// no React, no window, every decision harness-pinned (`mobile sign:` block).
//
// On a desktop the wallet is an extension: a request pops over the page and
// the page never loses the visitor. On a phone the wallet is ANOTHER APP. A
// request leaves the page (the MetaMask SDK navigates to a `metamask://…`
// link, lib/wallet-handoff), the visitor approves it there, and comes back
// seconds or minutes later — by which time three things may be true at once:
//   · the request's promise is still pending on the SDK socket (the app
//     answered, or the socket died when the OS parked the tab — we can't tell
//     from here);
//   · the artifact it carried has aged past what the venue accepts (a
//     Hyperliquid nonce lives 2 min, a swap has a deadline, a job offers a
//     step for 30 min);
//   · the NEXT wallet method in a multi-step flow fires from an `await`, with
//     no tap behind it, and the browser drops the app launch on the floor
//     (measured 2026-09-23, Chrome iPhone UA: a launch 6s+ after the last tap
//     → "Not allowed to launch 'metamask://…' because a user gesture is
//     required"; a launch inside the tap's own async continuation, even after
//     a 6s await, is allowed; a launch after a fake visibilitychange return
//     is not — the return itself grants nothing).
//
// The rule this module encodes: ON A PHONE, ONE WALLET METHOD PER TAP. Step
// N>1 of a chain is re-armed as a button the visitor taps ("Sign step 2 of
// 2"); a chain switch is its own tap; enable-trading is its own tap; and the
// page WATCHES the round trip so that a request still unsettled after the
// visitor has come back gets a real control, never a disabled button.

export type SignRoundTripState = 'idle' | 'asked' | 'in-app' | 'returned' | 'settled' | 'stale'

export interface SignRoundTrip {
  state: SignRoundTripState
  /** When the wallet method was fired. */
  askedAt: number | null
  /** When the page hid (the app took over). */
  leftAt: number | null
  /** When the page came back visible with the request still open. */
  returnedAt: number | null
}

export const IDLE_TRIP: SignRoundTrip = { state: 'idle', askedAt: null, leftAt: null, returnedAt: null }

export type SignRoundTripEvent =
  | { type: 'ask'; at: number }
  | { type: 'hidden'; at: number }
  | { type: 'visible'; at: number }
  | { type: 'resolved' }
  | { type: 'rejected' }
  | { type: 'stale' }
  | { type: 'reset' }

/**
 * The state machine. `asked` → the page hides → `in-app` → the page comes
 * back → `returned` (the request is still open); `resolved`/`rejected` from
 * any live state → `settled`; `stale` (the artifact aged past the venue's
 * window while the visitor was away) → `stale`, which the host answers with a
 * rebuild, never a blind re-send. A `visible` before any `hidden` means the
 * launch never happened (the #822 shape): the trip stays `asked` — the
 * handoff card (lib/wallet-handoff) owns that case.
 */
export function roundTripReduce(trip: SignRoundTrip, ev: SignRoundTripEvent): SignRoundTrip {
  switch (ev.type) {
    case 'reset':
      return IDLE_TRIP
    case 'ask':
      return { state: 'asked', askedAt: ev.at, leftAt: null, returnedAt: null }
    case 'hidden':
      if (trip.state === 'asked' || trip.state === 'returned') return { ...trip, state: 'in-app', leftAt: ev.at }
      return trip
    case 'visible':
      if (trip.state === 'in-app') return { ...trip, state: 'returned', returnedAt: ev.at }
      return trip
    case 'resolved':
    case 'rejected':
      if (trip.state === 'idle' || trip.state === 'settled') return trip
      return { ...trip, state: 'settled' }
    case 'stale':
      if (trip.state === 'idle' || trip.state === 'settled') return trip
      return { ...trip, state: 'stale' }
  }
}

/** After the visitor is back with the request still open, how long the page
 *  waits before it puts a control up. The SDK re-delivers a queued answer
 *  within a couple of seconds of the socket waking; past this the honest
 *  read is "nothing is coming on its own". */
export const RETURN_WAIT_MS = 8_000

/** What the page shows for an open request. `waiting` while the round trip
 *  is plausibly still in flight; `offer-reopen` once the visitor is back
 *  and nothing has settled for RETURN_WAIT_MS — the control is "open the
 *  wallet app again", NEVER a re-send (the first request is still queued in
 *  the app; a second one would be a second signature). */
export function returnVerdict(trip: SignRoundTrip, now: number): 'none' | 'waiting' | 'offer-reopen' {
  if (trip.state === 'idle' || trip.state === 'settled' || trip.state === 'stale') return 'none'
  if (trip.state === 'returned' && trip.returnedAt != null && now - trip.returnedAt >= RETURN_WAIT_MS) return 'offer-reopen'
  return 'waiting'
}

// ── Platform ─────────────────────────────────────────────────────────────

export type Platform = 'phone' | 'desktop'

/** The same signal RainbowKit's `isMobile()` reads: the UA. A phone is where
 *  the wallet is another app. (CONNECT's lib/mobile-wallet.ts is the
 *  squad's platform source once it lands; this mirrors its UA rule so the
 *  sign surfaces never disagree with the connect door.) */
export function platformOf(ua: string | null | undefined): Platform {
  if (!ua) return 'desktop'
  return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua) ? 'phone' : 'desktop'
}

/** ONE WALLET METHOD PER TAP on a phone: the next method after an awaited
 *  round trip has no activation behind it. */
export function oneMethodPerTap(platform: Platform): boolean {
  return platform === 'phone'
}

/**
 * May a chain step request its signature on MOUNT (no tap)? Desktop step
 * N>1 keeps the "popup follows popup" flow; a phone never (the launch would
 * be dropped and the visitor left on a disabled button); Coinbase's popup
 * wallet never (the #102 lesson); the first step never (the tap IS the ask);
 * an externally built chain never (§E3).
 */
export function autoFireAllowed(i: {
  platform: Platform
  stepIndex: number
  manualSteps?: boolean
  connectorId?: string | null
  connectorName?: string | null
}): boolean {
  if (i.stepIndex <= 0 || i.manualSteps) return false
  if (i.platform === 'phone') return false
  if (/coinbase/i.test(`${i.connectorId ?? ''} ${i.connectorName ?? ''}`)) return false
  return true
}

/** The re-armed step's button. On a phone it says which app the tap opens. */
export function continueCopy(i: { stepIndex: number; total: number; title: string; app?: string | null }): { label: string; hint: string } {
  const n = i.stepIndex + 1
  const where = i.app ? ` in ${i.app}` : ' in your wallet'
  return {
    label: i.total > 1 ? `Sign step ${n} of ${i.total} — ${i.title}` : `Sign & send ${i.title}`,
    hint: i.stepIndex < i.total - 1
      ? `Once this confirms, tap to sign the next step${where} — the app opens on your tap.`
      : `The last step. Tap to sign it${where}.`,
  }
}

// ── Staleness ────────────────────────────────────────────────────────────

export type StaleKind = 'hl-nonce' | 'tx-deadline' | 'job-offer'

/** Mirrors lib/hyperliquid-exec HL_NONCE_SIGNABLE_MS (pinned equal). */
export const HL_NONCE_SIGNABLE_MS = 90_000
/** Mirrors lib/jobs-runner OFFER_TTL_MS (pinned equal). */
export const JOB_OFFER_TTL_MS = 30 * 60_000
/** A swap deadline is re-quoted this early (SendTxChain's watch). */
export const TX_DEADLINE_LEAD_S = 90

/**
 * Has the artifact the visitor is coming back to aged out? The FIRST stale
 * kind wins: an HL nonce (2 min at the venue, 90s signable) before a job's
 * 30-min offer, a swap deadline before its job's offer. A stale artifact is
 * rebuilt (hlNonceStale → onStale/refreshOfferedStep, validUntil →
 * POST /api/tx/refresh), never re-sent.
 */
export function staleVerdict(i: { now: number; hlNonce?: number | null; validUntil?: number | null; offeredAt?: number | null }): StaleKind | null {
  if (typeof i.hlNonce === 'number' && Math.abs(i.now - i.hlNonce) > HL_NONCE_SIGNABLE_MS) return 'hl-nonce'
  if (typeof i.validUntil === 'number' && (i.validUntil - TX_DEADLINE_LEAD_S) * 1000 <= i.now) return 'tx-deadline'
  if (typeof i.offeredAt === 'number' && i.now - i.offeredAt >= JOB_OFFER_TTL_MS) return 'job-offer'
  return null
}

// ── Never burn a signature ───────────────────────────────────────────────

/**
 * Before a tx request is ever RE-SENT, the wallet's nonce says whether the
 * first one went out: the pending nonce read at ask time vs now. Advanced →
 * a transaction from this wallet was broadcast after we asked, so a re-send
 * is a second spend until a human has looked. Unknown (a read failed) is
 * treated as unsafe. Only `safe` may re-send.
 */
export function resendVerdict(i: { nonceAtAsk: number | null; nonceNow: number | null }): 'safe' | 'broadcast-seen' | 'unknown' {
  if (i.nonceAtAsk == null || i.nonceNow == null) return 'unknown'
  return i.nonceNow > i.nonceAtAsk ? 'broadcast-seen' : 'safe'
}

/** The words beside an open request the visitor came back to. */
export function reopenCopy(app: string | null | undefined): { line: string; cta: string } {
  const name = app ?? 'your wallet'
  return {
    line: `Still waiting on ${name}. The request is queued there — approve or reject it in the app; nothing is sent twice.`,
    cta: `Open ${name}`,
  }
}
