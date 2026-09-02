// lib/roster-observe.ts — roster observability (doors run): the ONE choke
// point that turns roster refusals into ask_failures rows, kind 'roster'.
//
// The first-hire premortem's worst modes are INVISIBLE ones: a stranger's
// mandate refuses, a hire consent fails, a manager's proposal walls on a
// benched slot — and today nothing records it, so /dashboard/failures (the
// product-gap queue since #540) never sees the roster funnel leak. Same
// discipline as lib/ask-failure: ONE write site, fire-and-forget (a log
// must never break the surface), x-yf-no-ask-log honored ('1' opts out —
// the harness belt), is_internal stamped from the same signal as every
// arrival table. The row reuses the ask_failures shape: prompt carries the
// surface-tagged ask, reply carries the refusal the caller actually saw,
// build_path = roster-<surface> so the queue is filterable.

import prisma from '@/lib/db'
import { isInternalRun } from '@/lib/internal-run'

export type RosterSurface = 'mandate' | 'hire' | 'propose' | 'decline'

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The direct entrance — for callers with no request in scope (the desk's
 *  propose gate runs inside broker_open; its DeskCallOpts carry the same
 *  internal/noLog signals the transport read off the MCP request). */
export function logRosterRefusalDirect(a: {
  surface: RosterSurface
  ask: string
  wallet?: string | null
  error: string
  internal: boolean
  noLog?: boolean
}): void {
  if (a.noLog) return
  void prisma.askFailure
    .create({
      data: {
        wallet: a.wallet?.toLowerCase() ?? null,
        prompt: cap(`[roster:${a.surface}] ${a.ask}`, 600),
        reply: cap(a.error, 500),
        kind: 'roster',
        buildPath: `roster-${a.surface}`,
        isInternal: a.internal,
      },
    })
    .catch(() => {
      /* the log must never break the surface */
    })
}

/** The route entrance — reads the opt-out + internal stamp off the request
 *  headers exactly like the chat choke point. */
export function logRosterRefusal(
  headers: Headers,
  a: { surface: RosterSurface; ask: string; wallet?: string | null; error: string },
): void {
  if (headers.get('x-yf-no-ask-log') === '1') return
  logRosterRefusalDirect({ ...a, internal: isInternalRun(headers) })
}
