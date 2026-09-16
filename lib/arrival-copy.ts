// ─────────────────────────────────────────────────────────────────────────
//  ARRIVAL — the words. The one row a visitor sees on /chat when a chip they
//  tapped on /markets is about to run (or just ran). Pure + client-safe (no
//  env, no fetch, no React) so the harness can pin every sentence.
//
//  Honesty rule, pinned: while the turn has NOT fired (`holding`, `waiting`)
//  no line may claim a run — no "sent", no "ran", no "running". The app
//  CAUGHT the ask; it sends itself once the wallet has settled. Only the
//  `sent` view says sent. If the wallet never settles, the row goes quiet
//  ("Ready when you are.") instead of pretending.
//
//  Squad ARRIVAL (2026-09-16) — UX owns this file.
// ─────────────────────────────────────────────────────────────────────────

import { MARKETS_NAV_WORD } from '@/lib/markets-copy'

/** What the banner shows. `holding` / `sent` follow CORE's phase; `waiting`
 *  is `holding` after ARRIVAL_HOLD_TIMEOUT_MS with no fire — the honest edge. */
export type ArrivalView = 'holding' | 'waiting' | 'sent'

/** `holding` this long with no fire flips the row to the quiet `waiting`
 *  view. Shorter than the record's own 60s TTL (lib/arrival-intent): a hold
 *  that outlives its record is already not "running". */
export const ARRIVAL_HOLD_TIMEOUT_MS = 10_000

/** `sent` stays on screen at least this long before it may fade, so a fast
 *  reply never makes the handoff blink. */
export const ARRIVAL_SENT_LINGER_MS = 1_400

/** The exit fade (CSS transition length; the component waits it out before
 *  calling onDismiss). */
export const ARRIVAL_FADE_MS = 360

/** The eyebrow — the nav word, so the row names the page the visitor left. */
export const ARRIVAL_EYEBROW = `From ${MARKETS_NAV_WORD}`

/** The state word in the eyebrow pill (mono, uppercase by CSS). */
export const ARRIVAL_STATE_WORD: Record<ArrivalView, string> = {
  holding: 'Holding',
  waiting: 'Waiting',
  sent: 'Sent',
}

/** The line under the ask. */
export const ARRIVAL_SUB: Record<ArrivalView, string> = {
  holding: 'Caught it. Sends itself once your wallet is ready.',
  waiting: 'Still holding it — your wallet hasn’t settled. Ready when you are.',
  sent: 'Sent. The reply lands below.',
}

/** The dismiss control's accessible name. In `holding` / `waiting` CORE drops
 *  the pending fire on dismiss (the ask never runs), so the label says so. */
export const ARRIVAL_DISMISS_LABEL: Record<ArrivalView, string> = {
  holding: 'Don’t run it',
  waiting: 'Don’t run it',
  sent: 'Dismiss',
}

/** Pure: which view a phase + hold state resolves to. */
export function arrivalView(phase: 'holding' | 'sent', timedOut: boolean): ArrivalView {
  if (phase === 'sent') return 'sent'
  return timedOut ? 'waiting' : 'holding'
}

/** The sender, said as a place. Only fenced sources reach the banner
 *  (lib/arrival-fence ARRIVAL_SOURCES); anything else falls back to the nav
 *  word and NEVER echoes a pathname into the UI. */
export function arrivalSourceLabel(from: string): string {
  const path = (from || '').split(/[?#]/)[0]
  if (path === '/markets' || path.startsWith('/markets/')) return MARKETS_NAV_WORD
  const sym = /^\/t\/([A-Za-z0-9.\-]{1,12})(?:\/|$)/.exec(path)?.[1]
  if (sym) return `the ${sym.toUpperCase()} chart`
  return MARKETS_NAV_WORD
}

/** The ask as the row prints it: the chip's sentence, whitespace collapsed,
 *  never rewritten (the fence already bounded it). */
export function arrivalAskLine(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/** The one sentence for screen readers (and the harness): view + source +
 *  the ask, verbatim. Holding / waiting never claim a run. */
export function arrivalStatusText(view: ArrivalView, from: string, text: string): string {
  const source = arrivalSourceLabel(from)
  const ask = arrivalAskLine(text)
  if (view === 'sent') return `Sent from ${source}: ${ask}`
  if (view === 'waiting') return `Holding your ask from ${source} until your wallet is ready: ${ask}`
  return `Caught your ask from ${source}, sending once your wallet is ready: ${ask}`
}
