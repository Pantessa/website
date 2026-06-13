// ─────────────────────────────────────────────────────────────────────────
//  Spend grant — the policy primitive behind the "agent expense account."
//
//  A grant is a SCOPED authorization: which hostnames may be paid, a per-call
//  and per-day cap, and an expiry. Yeetful enforces it before any x402 payment
//  is signed and ledgers every decision (lib/db SpendLedgerEntry).
//
//  This is POLICY, not custody. Today the grant gates the house burner
//  (lib/agent-wallet.ts). In production the same grant maps to a Coinbase Smart
//  Wallet Spend Permission / ERC-4337 session key scoped to the cap — so the
//  user's own wallet contract enforces it and Yeetful never holds the funds.
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
}

/** The host of an x402 endpoint URL, lowercased (the unit the allowlist matches). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Exact host match (extend with wildcard support when needed). */
export function hostAllowed(host: string, allow: string[]): boolean {
  return allow.includes(host.toLowerCase())
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
  if (grant.status === 'revoked') {
    throw new GrantError('REVOKED', `Grant ${grant.id} has been revoked.`)
  }
  if (grant.paused) {
    throw new GrantError('ACCOUNT_FROZEN', `Grant ${grant.id} is frozen (paused).`)
  }
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
    return e instanceof GrantError ? e.code : null
  }
}
