// ─────────────────────────────────────────────────────────────────────────
//  The guarded same-chain swap cascade as ONE shared function — the venue
//  order chat and the App-Mode swap panel both use (Uniswap v3 → v4
//  fallback when the chain pins it → LiFi settlement for venue-gated
//  pools), extracted so the JOBS RUNNER can build swap steps too ("fund
//  Arbitrum, then swap 20 USDC for WETH on Arbitrum" — the universal
//  funding plan's same-chain follow-up). Identical builders, identical
//  guardrails, identical txChain artifact. This module must NEVER grow its
//  own quoting or calldata logic — it only sequences the venue builders.
// ─────────────────────────────────────────────────────────────────────────

import { chainById } from '@/lib/chains'
import type { PolicyBlock } from '@/lib/tx-guardrails'
import { buildLifiSwap, NoLifiRouteError } from '@/lib/lifi-venue'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap, NoV3PoolError, type UniswapBuilt } from '@/lib/uniswap-venue'
import { buildUniswapV4Swap, GatedV4PoolError, NoV4PoolError } from '@/lib/uniswap-v4'

export interface GuardedSwapParams {
  sellToken: string
  buyToken: string
  /** Decimal string in HUMAN units. */
  amountHuman: string
  from: string
  chainId: number
  /** Fee tier in bps (default SWAP_FEE_BPS; link-originated turns pass
   *  LINK_SWAP_FEE_BPS). Threads to the v3 build AND the refresh recipe so
   *  re-quotes keep the tier. v4 has no venue-fee mechanism — unaffected. */
  feeBps?: number
}

export type GuardedSwapResult =
  | {
      ok: true
      txChain: {
        summary: string
        steps: { label: string; title: string; tx: unknown; validUntil?: number }[]
        refresh: { kind: string; stepIndex: number; params: Record<string, string> }
      }
      buildPath: string
      summary: string
      guardrails: { ok: boolean; valueUsd?: number | null; checks: { id: string; ok: boolean; level: string; note: string }[]; policyBlock?: PolicyBlock }
    }
  | { ok: false; blockKind: 'policy' | 'execution'; reasons: string; guardrails?: unknown; policyBlock?: PolicyBlock }

const blockedOf = (guardrails: { checks: { ok: boolean; level: string; note: string }[] }) =>
  guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') || 'a safety check failed'

/**
 * Build one guarded same-chain swap through the full venue cascade.
 * Deterministic; nothing signed or submitted. Throws only on transport
 * errors — venue misses and guard refusals come back as `{ ok: false }`.
 */
export async function buildGuardedSwap(params: GuardedSwapParams): Promise<GuardedSwapResult> {
  const { sellToken, buyToken, amountHuman, from, chainId } = params
  const chain = chainById(chainId)
  if (!chain) return { ok: false, blockKind: 'execution', reasons: `Chain ${chainId} isn't a first-class chain.` }
  await ensureTokenList(chainId)
  const sell = sellToken.toUpperCase()
  const buy = buyToken.toUpperCase()
  const refreshParams = {
    sellToken,
    buyToken,
    amountHuman,
    chainId: String(chainId),
    ...(params.feeBps !== undefined ? { feeBps: String(params.feeBps) } : {}),
  }

  // ── Uniswap v3 (the default venue on every first-class chain) ────────────
  let uni: UniswapBuilt | null = null
  try {
    uni = await buildUniswapSwap({ sellToken, buyToken, amountHuman, from, chainId, feeBps: params.feeBps })
  } catch (err) {
    if (!(err instanceof NoV3PoolError && chain.uniswapV4)) throw err
  }
  if (uni) {
    if (uni.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(uni.guardrails), guardrails: uni.guardrails, policyBlock: uni.guardrails.policyBlock }
    const steps = uni.approveTx
      ? [
          { label: 'approve', title: `Approve ${sell} to Uniswap's SwapRouter02`, tx: uni.approveTx },
          { label: 'swap', title: `Swap ${amountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil },
        ]
      : [{ label: 'swap', title: `Swap ${amountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil }]
    return {
      ok: true,
      txChain: { summary: uni.summary, steps, refresh: { kind: 'uniswap-swap', stepIndex: steps.length - 1, params: refreshParams } },
      buildPath: 'native-swap-uniswap',
      summary: uni.summary,
      guardrails: uni.guardrails,
    }
  }

  // ── v4 fallback (chain pins it; tokenized-stock pools live there) ────────
  try {
    const v4 = await buildUniswapV4Swap({ sellToken, buyToken, amountHuman, from, chainId })
    if (v4.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(v4.guardrails), guardrails: v4.guardrails, policyBlock: v4.guardrails.policyBlock }
    return {
      ok: true,
      txChain: { summary: v4.summary, steps: v4.steps, refresh: { kind: 'uniswap-v4-swap', stepIndex: v4.steps.length - 1, params: refreshParams } },
      buildPath: 'native-swap-uniswap-v4',
      summary: v4.summary,
      guardrails: v4.guardrails,
    }
  } catch (err) {
    if (err instanceof NoV4PoolError) {
      return { ok: false, blockKind: 'execution', reasons: `No Uniswap v3 or v4 pool on ${chain.name} can fill ${sell} → ${buy} for this amount.` }
    }
    if (!(err instanceof GatedV4PoolError)) throw err
    // Venue-gated pool (quotes but a direct call can't fill) → LiFi wraps
    // the chain's own settlement venue. Same order as chat.
    try {
      const lifi = await buildLifiSwap({ sellToken, buyToken, amountHuman, from, chainId })
      if (lifi.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(lifi.guardrails), guardrails: lifi.guardrails, policyBlock: lifi.guardrails.policyBlock }
      return {
        ok: true,
        txChain: { summary: lifi.summary, steps: lifi.steps, refresh: { kind: 'lifi-swap', stepIndex: lifi.swapStepIndex, params: refreshParams } },
        buildPath: 'native-swap-lifi',
        summary: lifi.summary,
        guardrails: lifi.guardrails,
      }
    } catch (lifiErr) {
      if (lifiErr instanceof NoLifiRouteError) {
        return { ok: false, blockKind: 'execution', reasons: "This pair only settles through the chain's own venue, and LiFi couldn't route it either — nothing was built." }
      }
      throw lifiErr
    }
  }
}
