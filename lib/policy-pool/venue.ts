// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the venue words and the route (BUILDER lane)
//
//  How an ask reaches buildPolicyPoolSwap (lib/uniswap-v4):
//    · the sentence names it — "Buy $25 of ETH through the policy pool";
//    · a desk intent was opened with `venue: 'policy-pool'` (broker_open),
//      which stamps `plan.venue` and writes the words into the ask so the
//      human lane's /i link routes the same way;
//    · a refresh recipe carries `venue: 'policy-pool'` + the intent id.
//  The route carries the two provenance fields the attestation needs: the
//  desk intent id (hashed on-chain, single use) and the origin string
//  (`dune:<queryId>` when the intent was born from a Dune read, else
//  `desk:<intentId>`). Pure — the DB read lives in the route that has it.
// ─────────────────────────────────────────────────────────────────────────

import type { BrokerOrigin } from '@/lib/broker-origin'
import { POLICY_POOL_VENUE } from '@/lib/policy-pool/config'

/** "on / through / via / in / into / using the policy pool", or the bare slug. */
export const POLICY_POOL_WORDS_RE = /\b(?:on|through|via|in|into|using|at)\s+(?:the\s+)?policy[\s-]?pool\b|\bpolicy-pool\b/i

export function namesPolicyPool(ask: string): boolean {
  return POLICY_POOL_WORDS_RE.test(ask)
}

/** The ask with the venue words on it (idempotent). */
export function withPolicyPoolWords(ask: string): string {
  const t = ask.trim()
  return namesPolicyPool(t) ? t : `${t.replace(/[.!]+$/, '')} through the policy pool`
}

/** The ask without the venue words — what the swap parser and the guard's
 *  sentence readers see. */
export function stripPolicyPoolWords(ask: string): string {
  return ask.replace(POLICY_POOL_WORDS_RE, '').replace(/\s{2,}/g, ' ').trim()
}

/** `dune:<queryId>` when the desk intent says it was born from a Dune read
 *  whose ref is a query id (digits), else `desk:<intentId>`. Printable and
 *  short by construction: the ref is digits, the id is a slug. */
export function policyPoolOriginFor(intentId: string, origin?: BrokerOrigin | null): string {
  const ref = origin?.feed === 'dune' ? origin.ref?.trim() : undefined
  if (ref && /^\d{1,12}$/.test(ref)) return `dune:${ref}`
  return `desk:${intentId}`
}

export interface PolicyPoolRoute {
  venue: typeof POLICY_POOL_VENUE
  /** The desk intent id (BrokerIntent.id / job id / a minted chat id) — hashed into the attestation. */
  intentId: string
  origin: string
}

/** A broker intent's stored plan says it was opened for the policy pool. */
export function planNamesPolicyPool(plan: unknown): boolean {
  return !!plan && typeof plan === 'object' && (plan as { venue?: unknown }).venue === POLICY_POOL_VENUE
}

/**
 * Decide the route for one turn from what the route handler already knows:
 * the message, and the desk intent bound to its link (if any). Returns null
 * when nothing names the pool. `fallbackId` is the id a bare chat ask gets
 * (minted per turn by the caller — single-use on-chain).
 */
export function policyPoolRouteFor(input: {
  message: string
  intent?: { id: string; origin?: BrokerOrigin | null; plan?: unknown } | null
  fallbackId: string
}): PolicyPoolRoute | null {
  const named = namesPolicyPool(input.message)
  const planned = planNamesPolicyPool(input.intent?.plan)
  if (!named && !planned) return null
  const intentId = input.intent?.id ?? input.fallbackId
  return { venue: POLICY_POOL_VENUE, intentId, origin: policyPoolOriginFor(intentId, input.intent?.origin) }
}

/** A slug-shaped id (the desk's mintSlug alphabet) — what refresh recipes and demo runs may carry. */
export const POLICY_POOL_INTENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/
/** The origin strings the builder accepts back from a recipe or a caller. */
export const POLICY_POOL_ORIGIN_RE = /^(?:dune:\d{1,12}|desk:[A-Za-z0-9_-]{4,64}|demo:[a-z0-9-]{1,40})$/
