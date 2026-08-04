// Pure mapping: a Pantessa SpendGrant → the on-chain Coinbase Spend Permission
// that backs it. The grant's per-day USD cap becomes a SpendPermission allowance
// over a 1-day period on Base, so the wallet contract caps spend regardless of
// the SDK — the hard stop the advisory pause/budget points at.
//
// This module is PURE (no CDP SDK, no network, no clock): it turns grant terms
// into the exact params `cdp.evm.createSpendPermission()` wants. The live create
// lives in lib/cdp.ts + the route (slice 2, owner-gated on CDP_WALLET_SECRET +
// a funded Smart Account). Keeping the math here makes it unit-testable and
// keeps "the budget you set is the number that moves on-chain" honest.

/** SpendPermissionManager — the same address on Base, Base Sepolia, and the
 *  other CDP-supported chains. */
export const SPEND_PERMISSION_MANAGER =
  '0xf85210B21cC50302F477BA56686d2019dC9b67Ad' as const

/** Canonical USDC on Base (6 decimals). Base Sepolia uses its own address; the
 *  CDP SDK resolves the friendly `token: 'usdc'` per network, so we never have
 *  to hardcode the testnet one. */
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

export const SECONDS_PER_DAY = 86_400

export type SpendPermissionNetwork = 'base' | 'base-sepolia'

export function isSpendPermissionNetwork(v: unknown): v is SpendPermissionNetwork {
  return v === 'base' || v === 'base-sepolia'
}

/** USD → USDC atomic units (6 decimals), rounded to the nearest micro-dollar to
 *  avoid float dust. e.g. 5 → 5_000_000n, 2.5 → 2_500_000n, 0.1 → 100_000n. */
export function usdcAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`spend-permission: per-day cap must be a positive number (got ${usd})`)
  }
  return BigInt(Math.round(usd * 1_000_000))
}

/** The friendly input shape `cdp.evm.createSpendPermission({ spendPermission })`
 *  consumes (the SDK converts it to the on-chain struct). */
export interface SpendPermissionParams {
  /** the funded CDP Smart Account that owns the USDC (the grantor) */
  account: `0x${string}`
  /** who may pull — the agent's payer address */
  spender: `0x${string}`
  token: 'usdc'
  /** atomic USDC, mirrors the grant's per-day cap */
  allowance: bigint
  /** 1 — the cap is a per-day allowance */
  periodInDays: number
  /** valid-from (grant mint time) */
  start: Date
  /** expiry (grant expiry) */
  end: Date
}

export interface GrantTerms {
  perDayUsd: number
  expiresAt: Date
  createdAt: Date
}

/**
 * Map a grant's terms onto a Spend Permission. The per-day cap becomes the
 * allowance over a 1-day rolling period; the grant's mint/expiry become
 * start/end. (The grant's per-CALL cap stays SDK-enforced — the on-chain
 * manager only enforces the period allowance.)
 */
export function grantToSpendPermission(
  grant: GrantTerms,
  parties: { account: `0x${string}`; spender: `0x${string}` },
): SpendPermissionParams {
  if (grant.expiresAt.getTime() <= grant.createdAt.getTime()) {
    throw new Error('spend-permission: grant expiry must be after its start')
  }
  return {
    account: parties.account,
    spender: parties.spender,
    token: 'usdc',
    allowance: usdcAtomic(grant.perDayUsd),
    periodInDays: 1,
    start: grant.createdAt,
    end: grant.expiresAt,
  }
}

/** A human/JSON-friendly summary of what will be enforced on-chain — used by the
 *  dashboard and the (slice-2) preview, derived purely from the grant. */
export function spendPermissionSummary(grant: GrantTerms): {
  allowanceAtomic: string
  allowanceUsd: number
  periodSeconds: number
  manager: string
  startUnix: number
  endUnix: number
} {
  const allowance = usdcAtomic(grant.perDayUsd)
  return {
    allowanceAtomic: allowance.toString(),
    allowanceUsd: grant.perDayUsd,
    periodSeconds: SECONDS_PER_DAY,
    manager: SPEND_PERMISSION_MANAGER,
    startUnix: Math.floor(grant.createdAt.getTime() / 1000),
    endUnix: Math.floor(grant.expiresAt.getTime() / 1000),
  }
}
