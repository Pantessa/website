// ─────────────────────────────────────────────────────────────────────────
//  What a signed JOB STEP tells telemetry about itself.
//
//  A job step is a real transaction on a real venue — the funded
//  "Fund Robinhood Chain with $12.50 from Base, then buy $12 of AAPL" flow
//  IS a Uniswap swap with our fee on it — but until this module the
//  `job-step` beacon reported `buildPath: <the raw job builder id>` and
//  `chain: 'multi'`. Most builder ids aren't BuildPaths, so the telemetry
//  route's allowlist dropped them: the row landed with build_path NULL.
//
//  Everything downstream that prices a turn needs a fee-bearing path —
//  lib/fees (FEE_BEARING_BUILD_PATHS / netFeeBpsForTurn), the creator
//  studio + claims, the public fee strip, the admin Growth books — so a
//  swap that DID pay 20/50 bps on-chain counted as volume and earned $0,
//  and a link creator earned nothing on link-driven funded buys even though
//  the visitor paid the link tier. Prod, 2026-09-18: $308.50 of $347.50 of
//  real signed 30-day volume was job steps with a NULL path.
//
//  The rule this module encodes: a step reports the path of what it ACTUALLY
//  built. Swap steps run the shared venue cascade (lib/swap-exec), so only
//  the build knows whether it settled on v3, v4 or LiFi — the runner stamps
//  that winner onto the artifact. Every other builder has one answer, and it
//  lives in the table below. Funding/bridge legs get their own fee-free
//  paths: they charge nothing (lib/lifi-bridge, and the runner's
//  no-appFees cross-chain build), so they must never resolve to a
//  fee-bearing path.
// ─────────────────────────────────────────────────────────────────────────

import { isBuildPath, type BuildPath } from '@/lib/build-path'

/** The artifact key the runner stamps the winning path onto. */
export const STEP_BUILD_PATH_KEY = 'buildPath'

/**
 * job_steps.builder → the BuildPath a step of that builder settles as.
 *
 * The SWAP builders (`native-swap`, `native-lifi-swap`) are deliberately
 * absent: both run the v3 → v4 → LiFi cascade and only the build knows which
 * venue answered. They resolve from the artifact instead (see below) — a
 * static guess here would print a LiFi stock fill as a Uniswap one.
 *
 * `wait` / `native-hl-guardian` are absent too: a wait predicate is not a
 * build, and the guardian arm is an `auto` step nobody signs — neither ever
 * reaches a beacon.
 */
export const BUILD_PATH_OF_JOB_BUILDER: Record<string, BuildPath> = {
  // Fee-free legs — the money is being MOVED so the next step can happen.
  'native-lifi-fund': 'native-fund-bridge',
  'native-cross-chain': 'native-cross-chain-leg',
  'native-transfer': 'native-transfer',
  // Fee-free actions.
  'native-nft-buy': 'native-nft-buy',
  'native-nft-transfer': 'native-nft-transfer',
  'native-nft-list': 'native-nft-list',
  'native-aave-supply': 'native-aave-supply',
  'native-aave-repay': 'native-aave-op',
  'native-morpho-lend': 'native-morpho-lend',
  'native-morpho-repay': 'native-morpho-op',
  'native-lido': 'native-lido',
  // Fee-BEARING: an HL perp order carries the builder fee. The deposit leg
  // shares the builder id and does not — lib/hyperliquid-exec names its own
  // path per branch and the runner forwards it, so this entry is only the
  // fallback for a legacy artifact that carries neither.
  'native-hl-exec': 'native-hl-exec',
}

/**
 * txChain.refresh.kind → the venue path. The recipe rides inside the stored
 * artifact, so this resolves a swap step the runner stamped BEFORE this
 * shipped (an offer already on screen at deploy time, and every legacy row a
 * backfill walks).
 */
export const BUILD_PATH_OF_REFRESH_KIND: Record<string, BuildPath> = {
  'uniswap-swap': 'native-swap-uniswap',
  'uniswap-v4-swap': 'native-swap-uniswap-v4',
  'lifi-swap': 'native-swap-lifi',
  'lifi-bridge': 'native-fund-bridge',
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * The BuildPath a signed job step should report. Ladder, most-specific first:
 *   1. the path the runner stamped on the artifact (the cascade's own winner);
 *   2. the txChain refresh recipe's kind (legacy + in-flight offers);
 *   3. the builder's one static answer.
 * Undefined when nothing maps — NEVER a guess, and never the raw builder id
 * (the telemetry route would drop it and we'd be back to a NULL path).
 */
export function jobStepBuildPath(builder: string, artifact: unknown): BuildPath | undefined {
  const a = obj(artifact)
  const stamped = a?.[STEP_BUILD_PATH_KEY]
  if (isBuildPath(stamped)) return stamped
  const kind = obj(a?.txChain)?.refresh
  const refreshKind = obj(kind)?.kind
  if (typeof refreshKind === 'string' && BUILD_PATH_OF_REFRESH_KIND[refreshKind]) return BUILD_PATH_OF_REFRESH_KIND[refreshKind]
  return BUILD_PATH_OF_JOB_BUILDER[builder]
}

/**
 * Stamp the built path onto a freshly built step artifact — the offer-time
 * half of {@link jobStepBuildPath}. `built` is the venue cascade's own
 * winner when the builder ran one; otherwise the builder's static answer.
 * A builder with no answer is left unstamped (the beacon then reports no
 * path, which is the honest reading — never a guess).
 */
export function stampJobStepPath(
  builder: string,
  artifact: Record<string, unknown>,
  built?: string,
): Record<string, unknown> {
  const path = isBuildPath(built) ? built : BUILD_PATH_OF_JOB_BUILDER[builder]
  return path ? { ...artifact, [STEP_BUILD_PATH_KEY]: path } : artifact
}

const chainIdOf = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? (v.startsWith('0x') ? parseInt(v, 16) : Number(v)) : typeof v === 'number' ? v : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * The chain the step is SIGNED on, read from the artifact it was signed from
 * — a bridge leg's chain is its origin, the chain that saw the transaction.
 * Undefined for an off-chain order (a Hyperliquid L1 action has no EVM
 * chain); the caller keeps its 'multi' fallback for that.
 */
export function jobStepChainId(artifact: unknown): number | undefined {
  const a = obj(artifact)
  const direct = chainIdOf(obj(a?.txRequest)?.chainId)
  if (direct) return direct
  const steps = obj(a?.txChain)?.steps
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const id = chainIdOf(obj(obj(s)?.tx)?.chainId)
      if (id) return id
    }
  }
  return undefined
}
