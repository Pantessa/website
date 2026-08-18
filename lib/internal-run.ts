// lib/internal-run.ts — ONE reading of the "this is our own run" signal.
//
// The 2026-08-11 audit found ~96% of "money moved" was our own harness; Q3
// (PR #637) answered with `embed_turns.is_internal`, stamped at the single
// telemetry write site from three equivalent signals (the x-yf-internal-run
// header, an `internalRun: true` body flag, a `harness-` sessionId prefix).
// The 2026-08-17 re-audit found the ARRIVAL tables carry the same
// contamination one table over: every test:api run mints intent_links and
// wallet_working_sets rows (and local jobs) from throwaway wallets, so the
// GTM arc's DENOMINATOR inflated by hundreds of "arrivals" per gate run.
//
// This module is the shared reader every arrival write site uses so the
// stamp means exactly one thing everywhere: intent_links, wallet_working_sets,
// jobs (via createJob), and the broker desk's mints all read the request
// through here. Self-reported on purpose — flagging yourself internal only
// removes your row from OUR scoreboards, so there is nothing to gain by
// spoofing it. STANDING RULE: every prod-pointed script sends the header on
// every request; the harness's global fetch wrapper stamps every BASE call.

export const INTERNAL_RUN_HEADER = 'x-yf-internal-run'

type HeaderLike = Headers | Record<string, string | string[] | undefined> | null | undefined

function headerValue(h: HeaderLike, name: string): string | null {
  if (!h) return null
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name)
  const v = (h as Record<string, string | string[] | undefined>)[name] ?? (h as Record<string, string | string[] | undefined>)[name.toLowerCase()]
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/** True when the request declares itself an internal run — header OR body
 *  flag (the sendBeacon path can't set headers). Works on a web `Headers`
 *  or the plain record the MCP transport hands tool callbacks
 *  (`extra.requestInfo.headers`). */
export function isInternalRun(headers: HeaderLike, body?: unknown): boolean {
  if (headerValue(headers, INTERNAL_RUN_HEADER) === '1') return true
  return !!body && typeof body === 'object' && (body as { internalRun?: unknown }).internalRun === true
}
