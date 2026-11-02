// What a chat turn did to its OWN working set, carried to the response.
//
// The route answers from ~200 return sites; the one thing every JSON reply
// has to carry the same way — "these first-party apps were turned on for
// this ask" (lib/ask-apps followAskApps) — would mean touching every one of
// them. The same shape as lib/inference-context: an AsyncLocalStorage scope
// bound once at the top of the request, written where the belt runs, and
// read by the POST wrapper, which merges `addedMcps` into whatever JSON the
// turn produced. A streamed turn (the auto-router's SSE) carries nothing:
// the client learns the set from its next JSON turn.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface AddedApp {
  id: string
  slug: string
  name: string
}

export interface TurnScope {
  /** First-party apps the belt added to this turn's set (route order). */
  addedApps?: AddedApp[]
  /** The LIVE intent link this turn was born on (validated in POST). The
   *  swap builders read it to pay the link's creator inside the swap
   *  (lib/creator-split) without threading a slug through every call. */
  linkSlug?: string
  /** The intent net's ONE reading of this ask, set right before the route
   *  re-enters the turn with it (app/api/chat/route.ts, the net site). Lives
   *  in the scope and never in the body: a body field could be forged by a
   *  client to skip the unsigned-turn meter the inner pass leaves alone. The
   *  inner pass reads it to never re-enter and never re-meter. */
  rescue?: { from: string; as: string; venue: string }
}

const als = new AsyncLocalStorage<TurnScope>()

/** Run `fn` with a fresh scope; returns the scope alongside the result. */
export async function withTurnScope<T>(fn: () => Promise<T>): Promise<{ result: T; scope: TurnScope }> {
  const scope: TurnScope = {}
  const result = await als.run(scope, fn)
  return { result, scope }
}

export function turnScope(): TurnScope | undefined {
  return als.getStore()
}

/** Record the turn's live link slug (POST, after the DB validated it). */
export function noteLinkSlug(slug: string): void {
  const s = als.getStore()
  if (s) s.linkSlug = slug
}

/** Record the intent net's one reading before the turn re-enters with it. */
export function noteRescue(rescue: { from: string; as: string; venue: string }): void {
  const s = als.getStore()
  if (s) s.rescue = rescue
}

/** Record the apps the belt turned on for this turn (idempotent by id). */
export function noteAddedApps(rows: readonly AddedApp[]): void {
  const s = als.getStore()
  if (!s || rows.length === 0) return
  const have = new Set((s.addedApps ?? []).map((r) => r.id))
  s.addedApps = [...(s.addedApps ?? []), ...rows.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, slug: r.slug, name: r.name }))]
}
