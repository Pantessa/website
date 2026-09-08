// lib/broker-policy.ts — the agent-tier fence for the broker desk (M1).
//
// The desk (/api/broker/mcp) opens Pantessa's guarded transaction layer to
// OTHER agents. The core safety is unchanged: deterministic builders write
// every transaction, every build is guarded fail-closed, and money moves
// ONLY through a wallet signature. This module adds the controls that make
// the SURFACE safe to keep building on before it is advertised:
//
//   1. A desk-level KILL SWITCH — fail-closed. The write/scan surface is OFF
//      unless BROKER_DESK_ENABLED === 'true'. An unaudited or abused desk
//      should be dark by default; the owner opts in when ready to demo, and
//      can pull it with one env flip. Read-only status + close stay open so
//      an in-flight agent can always check on or walk away from its intent.
//
//   2. A bound IDENTITY on the agent-signed EXECUTE path. broker_execute
//      compiles a job the agent's OWN key drives — the one path with no
//      human in the loop — so it refuses, by name, any intent that wasn't
//      opened with an agent_key. (M6 upgrades that key to an x402-payer-
//      verified identity; M1 binds, caps, and kill-switches it.)
//
//   3. A per-intent NOTIONAL CAP on the execute path. Human handoff carries
//      no desk cap — the human's signature is the ceiling — but an
//      agent-signed intent is capped at DESK_MAX_INTENT_USD.
//
// Pure: reads env, no DB, no fetch. The rate-limit tier lives at the route
// (it needs request headers) in lib/turn-limits.

/** Per-intent notional ceiling on the AGENT-SIGNED execute path (USD). */
export const DESK_MAX_INTENT_USD = (() => {
  const n = Number(process.env.BROKER_MAX_INTENT_USD)
  return Number.isFinite(n) && n > 0 ? n : 500
})()

/** The desk-level kill switch. FAIL-CLOSED: the write/scan surface serves
 *  only when BROKER_DESK_ENABLED is exactly 'true'. Prod owner sets it when
 *  ready to demo; the harness env sets it for the suite. */
export function deskEnabled(): boolean {
  return process.env.BROKER_DESK_ENABLED === 'true'
}

/** Guard the write/scan surface. Throws a caller-facing message when the
 *  desk is paused (or not yet enabled). */
export function assertDeskOpen(): void {
  if (!deskEnabled())
    throw new Error(
      'The Pantessa agent desk is not accepting new intents right now. ' +
        'Existing intents can still be checked (broker_status) and closed (broker_close).',
    )
}

/** The execute path's identity gate — refuses an unidentified agent BY NAME
 *  (the brief's M1 acceptance). Human handoff needs no identity because a
 *  human signs; only the agent-signed path binds one. */
export function assertAgentIdentity(agentKey: string | null | undefined): void {
  if (!agentKey)
    throw new Error(
      'broker_execute needs a bound agent identity — re-open the intent passing agent_key ' +
        '(your desk identity string). The agent-signed path has no human in the loop, so it will not ' +
        'run for an unidentified caller. For human signing, use broker_handoff — it needs no identity.',
    )
}

/** Per-intent cap on the agent-signed path. A null notional (non-dollar ask)
 *  passes here — the sign-side guards + spend policy remain the truth; this
 *  is the desk's own ceiling on what it will drive autonomously. */
export function assertUnderDeskCap(askUsd: number | null): void {
  if (askUsd != null && askUsd > DESK_MAX_INTENT_USD)
    throw new Error(
      `The agent desk caps agent-signed intents at $${DESK_MAX_INTENT_USD}; this ask (~$${askUsd}) is over. ` +
        'Hand it to a human with broker_handoff (a human signature carries no desk cap), or split it into smaller intents.',
    )
}

/** Per-ask notional ceiling on INBOX sends (USD) — a card that lands in a
 *  stranger's inbox unasked. The recipient still signs, but a "$50,000" card
 *  is a phishing prop, not a proposal; the desk refuses to deliver one. Human
 *  addressed sends (the mint door's `recipient`) ride the same ceiling. */
export const DESK_MAX_INBOX_USD = (() => {
  const n = Number(process.env.BROKER_MAX_INBOX_USD)
  return Number.isFinite(n) && n > 0 ? n : DESK_MAX_INTENT_USD
})()

/** The inbox cap. A null notional (non-dollar ask) passes — the sign-side
 *  guards remain the truth; a dollar ask over the ceiling is refused by name. */
export function assertUnderInboxCap(askUsd: number | null): void {
  if (askUsd != null && askUsd > DESK_MAX_INBOX_USD)
    throw new Error(
      `Inbox sends are capped at $${DESK_MAX_INBOX_USD} per ask; this one (~$${askUsd}) is over. ` +
        'Hand the human a plain link instead (broker_handoff), or split it into smaller asks.',
    )
}

/** broker_send's identity gate (SECURITY-AUDIT §C5): an unasked card in a
 *  stranger's inbox must be attributable. Refuses an unidentified sender BY
 *  NAME — the send door is not the anonymous mint door. */
export function assertSenderIdentity(agentKey: string | null | undefined): void {
  if (!agentKey)
    throw new Error(
      'broker_send needs a bound agent identity — pass agent_key (your desk identity string, 6–80 chars). ' +
        'A card that lands in someone’s inbox unasked must be attributable to a track record; an unidentified ' +
        'sender can still hand a human a plain link with broker_handoff.',
    )
}

/** Sanitize a caller-supplied agent identity string for binding/storage. */
export function cleanAgentKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[^\w.:@-]/g, '').trim().slice(0, 80)
  return s.length >= 6 ? s : null
}
