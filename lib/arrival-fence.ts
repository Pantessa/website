// Arrival fence — the pure verdict on whether a handed-off intent may RUN on
// arrival. Fails CLOSED: anything this file does not explicitly allow is
// dropped, and the receiver then behaves like a plain /chat load.
//
// Squad ARRIVAL (2026-09-16) — SECURITY owns this file (CORE imports it from
// `takeArrivalIntent`). The attack class it answers is "content authored by a
// stranger" (SECURITY-AUDIT-2026-09-08): the record lives in same-tab
// sessionStorage, but sessionStorage is writable by any script on the origin
// and survives a bfcache restore, a same-tab redirect through a third-party
// OAuth page, and a reload — so the RECEIVER never trusts the record's shape,
// age, origin page or text. Every refusal names its reason so a pin (and a
// log line) can say WHY a handoff didn't fire.
//
// What a passing record is:
//   • a plain object, version byte 1;
//   • `at` (ms) no older than ARRIVAL_TTL_MS and no further in the future
//     than ARRIVAL_FUTURE_SKEW_MS (a forged `at` far ahead would otherwise be
//     "fresh" forever);
//   • `from` = a public front door's PATHNAME ('/markets', or a path under
//     it) — never a query, hash, or another surface (/i, /embed, /chat…);
//   • `text` = one line, 1..ARRIVAL_MAX_TEXT chars, no control characters,
//     NOT transfer-shaped (lib/intent-links isTransferShaped — the /i door's
//     own phishing fence), carrying no 0x address, no .eth name, no URL (the
//     AI lane's fence family, shared here so the two can never drift), and no
//     verb that moves money to a counterparty or out of the wallet
//     (ARRIVAL_DENIED_VERB_RE — no /markets chip composes one);
//   • `mcps` absent, or ≤ ARRIVAL_MAX_MCPS slug-shaped strings.
//
// Zero side effects; zero browser APIs — the harness imports it in node.

import { isTransferShaped } from './intent-links'
// The TTL is the intent module's (CORE's) constant; the fence reads it so the
// two can never disagree about what "fresh" means. The two modules import
// each other, and neither reads the other at module-evaluation time (only
// inside a function body), which is the one shape an ES-module cycle is safe in.
import { ARRIVAL_TTL_MS } from './arrival-intent'

export type ArrivalRefusal = 'malformed' | 'version' | 'stale' | 'future' | 'source' | 'text'
export type ArrivalVerdict = { ok: true } | { ok: false; reason: ArrivalRefusal }

/** Public front doors allowed to hand an intent to the app (pathname prefixes). */
export const ARRIVAL_SOURCES: readonly string[] = ['/markets']

/** Longest ask a handoff may carry. */
export const ARRIVAL_MAX_TEXT = 280

/** How far ahead of the receiver's clock a record's `at` may sit before it
 *  reads as forged rather than skewed (two clocks in one browser tab agree;
 *  this only absorbs a write-then-read straddling a clock adjustment). */
export const ARRIVAL_FUTURE_SKEW_MS = 5_000

/** Most MCP slugs a handoff may ask the app to activate. */
export const ARRIVAL_MAX_MCPS = 6

/** The ask fence's regex family — ONE definition, shared with the AI lane's
 *  `fenceAsk` (lib/markets-ai.ts) so an arrival text and a model-proposed
 *  chip are refused by the same rule. */
export const ASK_ADDRESS_RE = /0x[0-9a-fA-F]{4,}/
export const ASK_ENS_RE = /\.eth\b/i
export const ASK_URL_RE = /https?:\/\/|www\./i

/** Verbs that move value to a counterparty or out of the wallet. No chip a
 *  public page composes carries one (pinned by the ladder proof in the
 *  harness), so a handoff that does was not composed by our page. */
export const ARRIVAL_DENIED_VERB_RE = /\b(send|sent|transfer|pay|give|tip|airdrop|withdraw|bridge|move|approve|approval|revoke|delegate|export|import)\b/i

/** Control characters, C1 controls, and the Unicode line/paragraph separators
 *  — a handoff is ONE line of plain text. */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/** MCP slugs are lower-case kebab: `uniswap-free`, `yeetful-tool-wallet`. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** `/markets` and paths UNDER it (`/markets/…`) count; `/marketsX`, a query
 *  or a hash do not — `from` is a pathname, and a pathname carries neither. */
export function arrivalSourceAllowed(from: string): boolean {
  return ARRIVAL_SOURCES.some((src) => from === src || from.startsWith(`${src}/`))
}

/** Why a text may not run on arrival, or null when it may. Exported so a
 *  sender can refuse to WRITE what the receiver would drop. */
export function arrivalTextProblem(text: string): string | null {
  if (text.length === 0 || text.trim().length === 0) return 'empty'
  if (text.length > ARRIVAL_MAX_TEXT) return `over ${ARRIVAL_MAX_TEXT} chars`
  if (CONTROL_RE.test(text)) return 'carries a newline or control character'
  if (ASK_ADDRESS_RE.test(text)) return 'carries an address'
  if (ASK_ENS_RE.test(text)) return 'carries a name'
  if (ASK_URL_RE.test(text)) return 'carries a URL'
  if (isTransferShaped(text)) return 'transfer-shaped'
  if (ARRIVAL_DENIED_VERB_RE.test(text)) return 'names a counterparty or leaves the wallet'
  return null
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function arrivalAllowed(i: unknown, now: number = Date.now()): ArrivalVerdict {
  if (!isPlainObject(i)) return { ok: false, reason: 'malformed' }
  if (i.v !== 1) return { ok: false, reason: 'version' }
  const at = i.at
  if (typeof at !== 'number' || !Number.isFinite(at)) return { ok: false, reason: 'malformed' }
  if (at > now + ARRIVAL_FUTURE_SKEW_MS) return { ok: false, reason: 'future' }
  if (now - at > ARRIVAL_TTL_MS) return { ok: false, reason: 'stale' }
  const from = i.from
  if (typeof from !== 'string') return { ok: false, reason: 'malformed' }
  if (!arrivalSourceAllowed(from)) return { ok: false, reason: 'source' }
  const text = i.text
  if (typeof text !== 'string') return { ok: false, reason: 'malformed' }
  if (arrivalTextProblem(text)) return { ok: false, reason: 'text' }
  if (i.mcps !== undefined) {
    const mcps = i.mcps
    if (!Array.isArray(mcps) || mcps.length > ARRIVAL_MAX_MCPS || !mcps.every((s) => typeof s === 'string' && SLUG_RE.test(s))) return { ok: false, reason: 'malformed' }
  }
  return { ok: true }
}
