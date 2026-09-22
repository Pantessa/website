// lib/sign-in-gate.ts — the DOOR for `signInGate`.
//
// `lib/chat-mutation-gate` has emitted `signInGate` since the 09-08 security
// audit and, until this file, NOTHING rendered it (no-dead-ends squad, QA
// G-QA-5): the turn arrived as prose — "Sign in (one free signature, from the
// account menu), then ask again" — on `/i/protected-long`, the landing's
// "Open & protect a position" demo and the FLIP-DAY link. A stranger was told
// to go find a menu, and the ask they arrived with was lost.
//
// The gate itself is right (rule 6: connect-to-act runs every BUILD on the
// connected wallet, because the signature is the ownership proof — but these
// four turns change standing state with NO signature at all, so they need
// SIWE). What was missing is the door, and `signInLifts: true` already says
// so on the payload.
//
// This module is the pure half — what a rendered message carries, which door
// the surface gets, when the gate is answered, and when the held ask re-runs
// — so the harness can pin it without a browser. The rendering lives in
// components/ChatInterface.tsx (every first-party chat surface: /chat, /i's
// simple runtime, the ⌘K ask door) and the embed takes `elsewhere`.

import { sessionOwnsWallet, type ChatMutation } from '@/lib/chat-mutation-gate'

/** How long a gate reply at the end of the thread keeps its held ask. Same
 *  window as the connect gate's (lib/wallet-reconnect): long enough for a
 *  wallet prompt and an email OTP, short enough that a thread left open
 *  overnight never fires anything on its own. */
export const SIGN_IN_ASK_RERUN_WINDOW_MS = 2 * 60 * 1000

/** What the client stores on the assistant message that carried the gate. */
export interface SignInGateMeta {
  kind: ChatMutation
  /** The sentence the visitor asked, held so the door can re-run it. */
  ask: string
}

/** The gate off a rendered message's meta, or null. Fails closed on any
 *  shape that isn't a gate with an ask to hold. */
export function signInGateOf(meta: unknown): SignInGateMeta | null {
  const m = meta as { signInGate?: { kind?: unknown }; signInAsk?: unknown } | undefined
  const kind = m?.signInGate?.kind
  if (typeof kind !== 'string' || !kind) return null
  const ask = typeof m?.signInAsk === 'string' ? m.signInAsk.trim() : ''
  if (!ask) return null
  return { kind: kind as ChatMutation, ask }
}

/** The gate is answered: the SIWE session owns the wallet the turn ran on.
 *  Same rule the server gates with (lib/chat-mutation-gate), so the door can
 *  never linger past the thing it asks for. */
export function signInGateLifted(input: { sessionAddress: string | null | undefined; walletAddress: string | null | undefined }): boolean {
  return sessionOwnsWallet(input.sessionAddress, input.walletAddress)
}

/**
 * Which door this surface gets.
 *
 *  · `unified` — the sign-in modal (wallet · Google · email), rule 6's one
 *    door. SIWE is legitimately needed here: these turns are account
 *    surfaces, not execution ones.
 *  · `wallet` — no embedded-wallet lane configured, so the wallet's own
 *    connect-then-sign (session.connectAndSignIn) is the whole door.
 *  · `elsewhere` — the embed. A third-party iframe has no session of ours to
 *    mint (the cookie is ours, the frame is theirs) and no business opening
 *    an account door inside somebody's page, so the honest answer is a link
 *    that carries the ask to pantessa.com.
 */
export type SignInDoorKind = 'unified' | 'wallet' | 'elsewhere'

export function signInDoorFor(input: { embedded: boolean; cdpEnabled: boolean }): SignInDoorKind {
  if (input.embedded) return 'elsewhere'
  return input.cdpEnabled ? 'unified' : 'wallet'
}

/** Where the embed sends the visitor: the ask, prefilled on our own chat.
 *  `/chat?prompt=` never fires a turn (the standing rule) — they sign in,
 *  press send, and the gate is already answered. */
export function signInElsewhereHref(ask: string, siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/chat?prompt=${encodeURIComponent(ask)}`
}

/**
 * The held ask re-runs the moment the session lands — the connect gate's own
 * pattern (lib/wallet-reconnect shouldRerunConnectAsk), one state over. The
 * session can arrive without the door (another tab signed in, the nav's door,
 * a Google lane that reloaded the page), and the point of holding the ask is
 * that the visitor never retypes it.
 *
 * Re-running is safe by construction: the server re-checks ownership on the
 * new turn, and the four gated mutations move no money to anyone.
 */
export function shouldRerunSignInAsk(input: {
  /** The thread's last message, or null for an empty thread. */
  last: { role: string; meta?: unknown; createdAt?: string } | null
  sessionAddress: string | null | undefined
  walletAddress: string | null | undefined
  loading: boolean
  now: number
}): string | null {
  const { last, loading, now } = input
  if (loading || !last || last.role !== 'assistant') return null
  if (!signInGateLifted(input)) return null
  const gate = signInGateOf(last.meta)
  if (!gate) return null
  const at = last.createdAt ? Date.parse(last.createdAt) : NaN
  if (!Number.isFinite(at) || now - at > SIGN_IN_ASK_RERUN_WINDOW_MS || now < at - 60_000) return null
  return gate.ask
}
