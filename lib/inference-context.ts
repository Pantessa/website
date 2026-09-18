// Whose key pays for this request's model calls (pricing v2).
//
// The chat route is ~7,000 lines and calls the house model from a dozen
// places (planner picks, synthesis, the auto-router's routing pass, the
// governance turn). Threading "which API key, billed to whom" through every
// one of those signatures would touch all of them; an AsyncLocalStorage
// scope set ONCE at the top of the request reaches them all and cannot be
// forgotten at a new call site.
//
// It carries identity and the key only — ADMISSION (may this turn spend a
// house answer at all) stays an explicit call in the route (lib/billing
// `admitHouseTurn`), because a refusal is a reply the route has to write.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface InferenceScope {
  /** A user's own Anthropic key (BYOK). Absent = the house key. */
  apiKey?: string
  /** BYOK owners may pick a sharper synthesis model on their own key. */
  synthModel?: string | null
  /** Who this request is attributed to in the meter (lowercased wallet). */
  owner?: string | null
  /** Set by the model caller when a BYOK key was refused upstream, so the
   *  route can say so plainly instead of reading as "the house is down". */
  byokFailure?: { status: number }
}

const als = new AsyncLocalStorage<InferenceScope>()

/** Bind a scope to the rest of this request's async execution. */
export function enterInferenceScope(scope: InferenceScope): void {
  als.enterWith(scope)
}

export function inferenceScope(): InferenceScope | undefined {
  return als.getStore()
}

/** Run `fn` inside a scope (tests, cron, and any caller outside a route). */
export function withInferenceScope<T>(scope: InferenceScope, fn: () => T): T {
  return als.run(scope, fn)
}
