// lib/chat-mutation-gate.ts — session ownership for the standing-state
// mutations reachable from /api/chat (SECURITY-AUDIT-2026-09-08 §B2 / §E4).
//
// Connect-to-act (rule 6) stays intact: every BUILD runs on the connected
// address alone, because the transaction signature IS the ownership proof.
// But a handful of chat turns change standing state with NO signature at
// all — they only need `walletAddress`, which is client-asserted:
//
//   · arming a Hyperliquid guardian (the cron then closes the position with
//     the wallet's delegated agent key — anyone who knew a delegated
//     wallet's address could force-close its position from a curl);
//   · pausing / resuming / canceling a DCA schedule, taking one off
//     autopilot;
//   · pausing / resuming / retiring a spot protection;
//   · a compound job whose LAST step is a guardian arm (the runner arms it
//     server-side once the earlier steps settle).
//
// The dashboard twins of all four are SIWE-gated already; the chat surface
// was not. The rule here: such a turn proceeds only when the SIWE session
// OWNS the asserted wallet. Anything else answers a sign-in invitation —
// nothing is changed, nothing is auto-fired (rule 6: an invitation, never a
// silent SIWE). Reads (list my dcas) and signature-gated arms (spot guard,
// DCA autopilot arm, DCA create) stay connect-to-act.

export type ChatMutation = 'guardian-arm' | 'guardian-job-step' | 'dca-manage' | 'dca-autopilot' | 'spot-manage'

/** True when the SIWE session address is the asserted wallet. Fail closed on
 *  either side missing. */
export function sessionOwnsWallet(sessionAddress: string | null | undefined, walletAddress: string | null | undefined): boolean {
  if (!sessionAddress || !walletAddress) return false
  return sessionAddress.toLowerCase() === walletAddress.toLowerCase()
}

const WHAT: Record<ChatMutation, string> = {
  'guardian-arm': 'Arming a Hyperliquid protection changes what happens to your position with no further signature — the guardian closes it on its own when the trigger hits',
  'guardian-job-step': 'This job ends by arming a Hyperliquid protection, which changes what happens to your position with no further signature',
  'dca-manage': 'Pausing, resuming or canceling a recurring buy changes a standing plan on your account',
  'dca-autopilot': 'Taking a recurring buy off autopilot changes a standing plan on your account',
  'spot-manage': 'Pausing, resuming or retiring a spot protection changes what watches your wallet',
}

/** The user-facing reply — names the change, asks for the one free signature,
 *  says nothing happened. The phrase "signed in as this wallet" is pinned by
 *  the harness. */
export function mutationGateReply(kind: ChatMutation): string {
  return `🔐 ${WHAT[kind]}, so it needs you **signed in as this wallet** — a connected wallet alone isn't proof it's yours. Sign in (one free signature, from the account menu), then ask again. Nothing was changed.`
}

export interface SignInGate {
  kind: ChatMutation
  /** Signing in as the asserted wallet lifts the gate. */
  signInLifts: true
}

/** The response fields a gated turn carries (spread into the JSON reply). */
export function mutationGate(kind: ChatMutation): { reply: string; signInGate: SignInGate } {
  return { reply: mutationGateReply(kind), signInGate: { kind, signInLifts: true } }
}

/** A compiled job that ends (or anywhere contains) a server-side guardian
 *  arm — the runner performs it with no signature once earlier steps settle. */
export function hasGuardianStep(compiled: { steps: { builder: string }[] } | null | undefined): boolean {
  return !!compiled?.steps?.some((s) => s.builder === 'native-hl-guardian')
}
