// ─────────────────────────────────────────────────────────────────────────
//  Spend grant — the ledger home behind every receipt, and the kill switch.
//
//  Until 2026-10-30 a grant was also a POLICY: an allowlist of hosts, a
//  per-call cap, a daily and a lifetime budget, an expiry and a master
//  switch — the "agent expense account". That concept is retired. Nothing
//  Pantessa runs is capped, allowlisted or approval-gated any more: an x402
//  call the house pays is metered and receipted, never refused for policy,
//  and anything that moves the user's own money is signed by the user —
//  that signature is the consent. (A $3 send walled behind "approve the
//  agent on your dashboard" was friction, not protection.)
//
//  What survives is the kill switch: a grant that is `paused` (the
//  dashboard's Freeze) or `revoked` refuses everything, both directions, on
//  every path. The allow / caps / expiry columns still exist on the row —
//  the open-core SDK (guard-sdk/) enforces them in-process for agents that
//  pay from their own wallet, and historical ledger rows cite them — but
//  this gate ignores them.
//
//  Pure + DB-agnostic: the caller owns all I/O (loading the grant, writing
//  ledger entries). The spend arguments are kept so call sites don't change.
// ─────────────────────────────────────────────────────────────────────────

export type GrantViolation =
  | 'REVOKED'
  | 'ACCOUNT_FROZEN'
  // The gate itself failed (unreadable row, …). A broken gate REFUSES — it
  // never authorizes (fail-closed, 2026-07-20 audit).
  | 'POLICY_ERROR'

export class GrantError extends Error {
  constructor(public code: GrantViolation, message: string) {
    super(message)
    this.name = 'GrantError'
  }
}

/** The grant fields the gate (and the ledger / SDK readers) carry. Only
 *  `status` and `paused` are enforced here — see the header. */
export interface GrantPolicy {
  id: string
  status: string // 'active' | 'revoked' | 'expired'
  paused?: boolean // kill switch — a reversible freeze of the whole account
  // Carried from the row for the SDK and the dashboard; NOT enforced here.
  allow: string[]
  perCallUsd: number
  perDayUsd: number
  totalUsd?: number | null
  expiresAt: Date
}

/** The host of an x402 endpoint URL, lowercased (the unit ledger rows and the
 *  SDK's allowlist key on). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Exact host match, plus the open sentinel: `['*']` is the un-curated
 *  allowlist. Kept for lib/approvals (which still derives the SDK-facing
 *  list) — the gate below no longer consults it. */
export function hostAllowed(host: string, allow: string[]): boolean {
  if (!host) return false
  return allow.includes('*') || allow.includes(host.toLowerCase())
}

/**
 * The authorization gate. Throws GrantError when the account's kill switch
 * is on; returns cleanly otherwise. The host, price and spend arguments are
 * accepted for call-site compatibility and ignored — there is no allowlist
 * and there are no caps to check any more.
 */
export function checkGrant(
  grant: GrantPolicy,
  _host: string,
  _priceUsd: number,
  _spentTodayUsd: number,
  _spentTotalUsd = 0,
): void {
  if (grant.status === 'revoked') {
    throw new GrantError('REVOKED', `Grant ${grant.id} has been revoked.`)
  }
  if (grant.paused) {
    throw new GrantError('ACCOUNT_FROZEN', `Grant ${grant.id} is frozen (paused).`)
  }
}

/** Convenience: returns the violation code if refused, or null if authorized. */
export function grantViolation(
  grant: GrantPolicy,
  host: string,
  priceUsd: number,
  spentTodayUsd: number,
  spentTotalUsd = 0,
): GrantViolation | null {
  try {
    checkGrant(grant, host, priceUsd, spentTodayUsd, spentTotalUsd)
    return null
  } catch (e) {
    // A non-GrantError means the CHECK ITSELF broke (an unreadable row). That
    // used to return null — authorized-by-crash. A broken gate refuses; it
    // never waves through.
    return e instanceof GrantError ? e.code : 'POLICY_ERROR'
  }
}
