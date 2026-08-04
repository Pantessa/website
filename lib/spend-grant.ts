// ─────────────────────────────────────────────────────────────────────────
//  Spend grant — the policy primitive behind the "agent expense account."
//
//  A grant is a SCOPED authorization: which hostnames may be paid, a per-call
//  and per-day cap, and an expiry. Pantessa enforces it before any x402 payment
//  is signed and ledgers every decision (lib/db SpendLedgerEntry).
//
//  This is POLICY, not custody. Today the grant gates the house burner
//  (lib/agent-wallet.ts). In production the same grant maps to a Coinbase Smart
//  Wallet Spend Permission / ERC-4337 session key scoped to the cap — so the
//  user's own wallet contract enforces it and Pantessa never holds the funds.
//
//  Ported from the demo/ prototype (demo/lib/grant.ts) and made pure +
//  DB-agnostic: the checks take the already-computed `spentTodayUsd` so the
//  caller owns all I/O (loading the grant, summing the ledger, writing entries).
// ─────────────────────────────────────────────────────────────────────────

export type GrantViolation =
  | 'EXPIRED'
  | 'REVOKED'
  | 'ACCOUNT_FROZEN'
  | 'NOT_ALLOWED'
  | 'OVER_PER_CALL'
  | 'BUDGET_EXCEEDED'
  // The gate itself failed (malformed policy row, non-Date expiresAt, …).
  // A broken gate REFUSES — it never authorizes (fail-closed, 2026-07-20 audit).
  | 'POLICY_ERROR'

export class GrantError extends Error {
  constructor(public code: GrantViolation, message: string) {
    super(message)
    this.name = 'GrantError'
  }
}

/** The grant fields the policy checks need (a subset of the SpendGrant row). */
export interface GrantPolicy {
  id: string
  allow: string[]
  perCallUsd: number
  perDayUsd: number
  totalUsd?: number | null
  expiresAt: Date
  status: string // 'active' | 'revoked' | 'expired'
  paused?: boolean // kill switch — a reversible freeze of the whole account
  // Master power switch for the whole policy. Default OFF for new users so the
  // first run is unrestricted (a big trial blocker otherwise). When false, the
  // gate below short-circuits: no allowlist, no caps — access to any host. The
  // per-agent approval rows are untouched, so flipping this back on restores the
  // user's curated allowlist + caps exactly as they were.
  spendPolicyEnabled?: boolean
}

/** The host of an x402 endpoint URL, lowercased (the unit the allowlist matches). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Exact host match, plus the open-by-default sentinel: `['*']` is the
 *  un-curated allowlist (everything enabled out of the gate — the caps are
 *  the protection). The moment an owner toggles any agent OFF, the sync
 *  replaces the wildcard with a concrete curated list. */
export function hostAllowed(host: string, allow: string[]): boolean {
  if (!host) return false
  return allow.includes('*') || allow.includes(host.toLowerCase())
}

/**
 * The authorization gate. Throws GrantError on the first violation; returns
 * cleanly if the call is authorized. Pure — pass in today's spend and (for a
 * lifetime cap) the all-time spend; the caller computes both from the ledger.
 */
export function checkGrant(
  grant: GrantPolicy,
  host: string,
  priceUsd: number,
  spentTodayUsd: number,
  spentTotalUsd = 0,
): void {
  // Kill switches are emergency overrides — they apply even when the policy is
  // off, so a user in "unrestricted" mode can still freeze a runaway agent.
  if (grant.status === 'revoked') {
    throw new GrantError('REVOKED', `Grant ${grant.id} has been revoked.`)
  }
  if (grant.paused) {
    throw new GrantError('ACCOUNT_FROZEN', `Grant ${grant.id} is frozen (paused).`)
  }
  // Master switch off → skip the policy itself: no expiry, no allowlist, no
  // caps — the agent may pay any host. (Default OFF for new users; existing
  // users are backfilled ON.) The per-agent approval rows are untouched.
  if (!grant.spendPolicyEnabled) return
  if (Date.now() > grant.expiresAt.getTime()) {
    throw new GrantError('EXPIRED', `Grant ${grant.id} has expired.`)
  }
  if (!hostAllowed(host, grant.allow)) {
    throw new GrantError('NOT_ALLOWED', `${host} is not in this grant's allowlist.`)
  }
  if (priceUsd > grant.perCallUsd) {
    throw new GrantError(
      'OVER_PER_CALL',
      `$${priceUsd.toFixed(4)} exceeds the per-call cap of $${grant.perCallUsd}.`,
    )
  }
  if (spentTodayUsd + priceUsd > grant.perDayUsd) {
    throw new GrantError(
      'BUDGET_EXCEEDED',
      `$${(spentTodayUsd + priceUsd).toFixed(2)} would exceed the daily cap of $${grant.perDayUsd} (already spent $${spentTodayUsd.toFixed(2)} today).`,
    )
  }
  if (grant.totalUsd != null && spentTotalUsd + priceUsd > grant.totalUsd) {
    throw new GrantError(
      'BUDGET_EXCEEDED',
      `$${(spentTotalUsd + priceUsd).toFixed(2)} would exceed the lifetime cap of $${grant.totalUsd}.`,
    )
  }
}

/** Convenience: returns the violation code if blocked, or null if authorized. */
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
    // A non-GrantError means the CHECK ITSELF broke (e.g. a policy row whose
    // expiresAt deserialized as a string). That used to return null —
    // authorized-by-crash. A broken gate refuses; it never waves through.
    return e instanceof GrantError ? e.code : 'POLICY_ERROR'
  }
}
