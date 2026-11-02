// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the desk policy (SIGNER lane)
//
//  The off-chain half of the policy: before the signer attests, the desk asks
//  `policyDecision`. Pure and synchronous — env only, no DB, no chain. The
//  on-chain hook enforces the attestation; this decides whether to issue one.
//
//  Env (shape fixed in the squad README):
//    POLICY_POOL_MAX_USD       per-order cap in dollars (default 500)
//    POLICY_POOL_CHAIN_ID      the one chain the pool lives on
//    POLICY_POOL_HOOK          the hook address (unset = feature off)
//    POLICY_POOL_CURRENCY0/1   the pool key's currencies
//    POLICY_POOL_FEE           the pool key's fee (pips)
//    POLICY_POOL_TICK_SPACING  the pool key's tick spacing
// ─────────────────────────────────────────────────────────────────────────

import { getAddress, isAddress, type Address, type Hex } from 'viem'
import { poolIdFor } from './spec'

export const POLICY_POOL_DEFAULT_MAX_USD = 500

/** The env the policy reads; defaults to process.env, tests pass a plain object. */
export type PolicyEnv = Record<string, string | undefined>

export type PolicyDecision =
  | { allowed: true; capUsd: number }
  | { allowed: false; reason: string; capUsd: number }

/** The per-order cap from POLICY_POOL_MAX_USD; anything unreadable, zero or negative falls back to the default. */
export function policyCapUsd(env: PolicyEnv = process.env): number {
  const raw = env.POLICY_POOL_MAX_USD?.trim().replace(/[$,_\s]/g, '')
  if (!raw) return POLICY_POOL_DEFAULT_MAX_USD
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : POLICY_POOL_DEFAULT_MAX_USD
}

function intEnv(v: string | undefined): number | null {
  const s = v?.trim()
  if (!s || !/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/** The pinned pool from env, or the name of what is missing. */
export function pinnedPolicyPool(
  env: PolicyEnv = process.env,
): { ok: true; chainId: number; hook: Address; poolId: Hex } | { ok: false; missing: string[] } {
  const missing: string[] = []
  const hookRaw = env.POLICY_POOL_HOOK?.trim()
  const c0 = env.POLICY_POOL_CURRENCY0?.trim()
  const c1 = env.POLICY_POOL_CURRENCY1?.trim()
  const chainId = intEnv(env.POLICY_POOL_CHAIN_ID)
  const fee = intEnv(env.POLICY_POOL_FEE)
  const tickSpacing = intEnv(env.POLICY_POOL_TICK_SPACING)
  if (!hookRaw || !isAddress(hookRaw)) missing.push('POLICY_POOL_HOOK')
  if (chainId === null || chainId <= 0) missing.push('POLICY_POOL_CHAIN_ID')
  if (!c0 || !isAddress(c0)) missing.push('POLICY_POOL_CURRENCY0')
  if (!c1 || !isAddress(c1)) missing.push('POLICY_POOL_CURRENCY1')
  if (fee === null || fee < 0 || fee > 0xffffff) missing.push('POLICY_POOL_FEE')
  if (tickSpacing === null || tickSpacing <= 0 || tickSpacing > 0x7fffff) missing.push('POLICY_POOL_TICK_SPACING')
  if (missing.length) return { ok: false, missing }
  const hook = getAddress(hookRaw!)
  const poolId = poolIdFor({
    currency0: getAddress(c0!),
    currency1: getAddress(c1!),
    fee: fee!,
    tickSpacing: tickSpacing!,
    hooks: hook,
  })
  return { ok: true, chainId: chainId!, hook, poolId }
}

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: n % 1 === 0 ? 0 : 2, minimumFractionDigits: n % 1 === 0 ? 0 : 2 })}`

/** Should the desk attest this order? Pure, synchronous, env only. Refusals are sentences a trader can read. */
export function policyDecision(
  input: { usd: number; chainId: number; hook: Address; poolId: Hex },
  env: PolicyEnv = process.env,
): PolicyDecision {
  const capUsd = policyCapUsd(env)
  const pinned = pinnedPolicyPool(env)
  if (!pinned.ok) {
    return {
      allowed: false,
      capUsd,
      reason: `The policy pool is not configured on this desk yet (missing ${pinned.missing.join(', ')}).`,
    }
  }
  if (input.chainId !== pinned.chainId) {
    return { allowed: false, capUsd, reason: `The policy pool runs on chain ${pinned.chainId}, not chain ${input.chainId}.` }
  }
  if (!isAddress(input.hook) || getAddress(input.hook) !== pinned.hook) {
    return { allowed: false, capUsd, reason: "That is not the desk's policy pool hook." }
  }
  if (typeof input.poolId !== 'string' || input.poolId.toLowerCase() !== pinned.poolId.toLowerCase()) {
    return { allowed: false, capUsd, reason: "That is not the desk's policy pool." }
  }
  if (typeof input.usd !== 'number' || !Number.isFinite(input.usd) || input.usd <= 0) {
    return { allowed: false, capUsd, reason: 'The order has no dollar size the desk can check against its cap.' }
  }
  if (input.usd > capUsd) {
    return { allowed: false, capUsd, reason: `Over the desk's per-order cap of ${fmtUsd(capUsd)}.` }
  }
  return { allowed: true, capUsd }
}
