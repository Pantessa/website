// lib/roster-client.ts — THE ROSTER's client-safe sliver.
//
// The full mandate grammar (lib/roster.ts) imports the four executor
// modules, and spot-guard/aave drag the whole venue stack (uniswap-venue →
// auth …) — server-only. The rail must not bundle any of that, so the Team
// tab and the spine import ONLY from here: types, labels, the client flag,
// and dependency-free sanitizers. Live mandate validation goes through the
// API (POST /api/roster { preview: true }) — the server runs the one true
// parser; the client never forks the grammar.

export type MandateKind = 'shape' | 'dca' | 'protect' | 'yield'

/** The slot state machine (security CONTRACTS v1): pending → hired →
 *  benched ⇄ hired → fired (terminal; re-hire = a new slot row). */
export type SlotStatus = 'pending' | 'hired' | 'benched' | 'fired'

export const MANDATE_KIND_LABELS: Record<MandateKind, string> = {
  shape: 'Shape',
  dca: 'Recurring buy',
  protect: 'Protection',
  yield: 'Yield',
}

/** Per-proposal ceiling defaults (server truth lives in lib/roster.ts /
 *  roster-policy; these mirror the defaults for display only). */
export const ROSTER_DEFAULT_CAP_USD = 200

/** The client-bundle mirror of the kill switch — gates the Team tab's
 *  visibility. NEXT_PUBLIC_ so it inlines at build time; prod stays dark
 *  until the owner sets both flags. */
export function rosterEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_ROSTER_ENABLED === 'true'
}

/** The hired agent's PUBLIC handle — sha256(agent_key)[:16], the exact shape
 *  lib/agent-record's agentHandleFor mints. The raw key never lands here. */
export function cleanAgentKeyHash(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return /^[0-9a-f]{16}$/.test(s) ? s : null
}
