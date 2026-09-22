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
import { resolveToken } from '@/lib/cow'
import type { PolicyBlock } from '@/lib/tx-guardrails'
import { buildLifiSwap, NoLifiRouteError } from '@/lib/lifi-venue'
import { OffTapeError, TapeUnavailableError } from '@/lib/stock-tape'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap, NoV3PoolError, v3ApprovalSteps, type UniswapBuilt } from '@/lib/uniswap-venue'
import { buildUniswapV4Swap, GatedV4PoolError, NoV4PoolError } from '@/lib/uniswap-v4'

export interface GuardedSwapParams {
  sellToken: string
  buyToken: string
  /** Decimal string in HUMAN units. */
  amountHuman: string
  from: string
  chainId: number
  /** Fee tier in bps (default SWAP_FEE_BPS; link-originated turns pass
   *  LINK_SWAP_FEE_BPS). Threads to the v3 AND v4 builds AND the refresh
   *  recipe so re-quotes keep the tier. LiFi keeps its own fee step. */
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

/** The venue builders the cascade sequences. Injectable ONLY so the harness
 *  can pin the cascade's order and fall-throughs without a live chain. */
export interface SwapVenues {
  v3: typeof buildUniswapSwap
  v4: typeof buildUniswapV4Swap
  lifi: typeof buildLifiSwap
}
const LIVE_VENUES: SwapVenues = { v3: buildUniswapSwap, v4: buildUniswapV4Swap, lifi: buildLifiSwap }

/**
 * Build one guarded same-chain swap through the full venue cascade.
 * Deterministic; nothing signed or submitted. Throws only on transport
 * errors (an RPC, or a stock tape that didn't answer — TapeUnavailableError)
 * — venue misses and guard refusals come back as `{ ok: false }`.
 *
 * A Robinhood Chain stock pool that sits off Robinhood's tape (lib/stock-tape)
 * is skipped like a missing pool: the cascade tries the next venue, and
 * refuses by name when the chain's own settlement venue is off tape too.
 */
export async function buildGuardedSwap(params: GuardedSwapParams, venues: Partial<SwapVenues> = {}): Promise<GuardedSwapResult> {
  try {
    return await cascade(params, { ...LIVE_VENUES, ...venues })
  } catch (err) {
    // No feed exists for the stock at all: that's a refusal, not an outage.
    if (err instanceof TapeUnavailableError && err.permanent) return { ok: false, blockKind: 'execution', reasons: err.message }
    throw err
  }
}

/** Tickers whose real token on our chains is a wrapped form. Without this,
 *  "BTC" resolves to nothing on Ethereum and Arbitrum and to a SQUAT on Base
 *  ("Big Tom Coin", 0x35c8…1a3d, from the dynamic list) — so a chip that says
 *  BTC could build a swap into something that isn't Bitcoin. The routes API
 *  already quotes BTC through these forms (app/api/markets/routes tokenOn);
 *  this is the same fact on the BUILD side, where it decides calldata.
 *  Nothing else is aliased: a ticker means the ticker. */
const WRAPPED_FORMS: Readonly<Record<string, readonly string[]>> = { BTC: ['CBBTC', 'WBTC'] }

/** The token a swap of `sym` on this chain actually moves. Falls through to
 *  the ticker itself when no wrapped form is listed — the builder then refuses
 *  by name (UnknownTokenError), which is a refusal, never a wrong token. */
export function canonicalSwapToken(sym: string, chainId: number): string {
  const forms = WRAPPED_FORMS[sym.trim().toUpperCase()]
  if (!forms) return sym
  for (const f of forms) if (resolveToken(f, chainId)) return f
  return sym
}

async function cascade(paramsIn: GuardedSwapParams, venues: SwapVenues): Promise<GuardedSwapResult> {
  const chainId = paramsIn.chainId
  const chain = chainById(chainId)
  if (!chain) return { ok: false, blockKind: 'execution', reasons: `Chain ${chainId} isn't a first-class chain.` }
  await ensureTokenList(chainId)
  // Wrapped forms resolve only once the chain's list is warm.
  const params: GuardedSwapParams = {
    ...paramsIn,
    sellToken: canonicalSwapToken(paramsIn.sellToken, chainId),
    buyToken: canonicalSwapToken(paramsIn.buyToken, chainId),
  }
  const { sellToken, buyToken, amountHuman, from } = params
  const sell = sellToken.toUpperCase()
  const buy = buyToken.toUpperCase()
  const refreshParams = {
    sellToken,
    buyToken,
    amountHuman,
    chainId: String(chainId),
    ...(params.feeBps !== undefined ? { feeBps: String(params.feeBps) } : {}),
  }
  // The first venue whose fill sat off the stock's tape — it leads the
  // refusal if nothing further down the cascade fills near the tape.
  let offTape: OffTapeError | null = null

  // ── Uniswap v3 (the default venue on every first-class chain) ────────────
  let uni: UniswapBuilt | null = null
  try {
    uni = await venues.v3({ sellToken, buyToken, amountHuman, from, chainId, feeBps: params.feeBps })
  } catch (err) {
    if (err instanceof OffTapeError) offTape = err
    else if (!(err instanceof NoV3PoolError && chain.uniswapV4)) throw err
  }
  if (uni) {
    if (uni.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(uni.guardrails), guardrails: uni.guardrails, policyBlock: uni.guardrails.policyBlock }
    // [reset?, approve?, swap] — the refresh recipe below always aims at the
    // LAST step, however many approvals sit in front of it.
    const steps = [
      ...v3ApprovalSteps(uni, sell),
      { label: 'swap', title: `Swap ${amountHuman} ${sell} → ${buy}`, tx: uni.swapTx, validUntil: uni.validUntil },
    ]
    return {
      ok: true,
      txChain: { summary: uni.summary, steps, refresh: { kind: 'uniswap-swap', stepIndex: steps.length - 1, params: refreshParams } },
      buildPath: 'native-swap-uniswap',
      summary: uni.summary,
      guardrails: uni.guardrails,
    }
  }

  // ── v4 fallback (chain pins it; tokenized-stock pools live there) ────────
  if (chain.uniswapV4) {
    try {
      const v4 = await venues.v4({ sellToken, buyToken, amountHuman, from, chainId, feeBps: params.feeBps })
      if (v4.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(v4.guardrails), guardrails: v4.guardrails, policyBlock: v4.guardrails.policyBlock }
      return {
        ok: true,
        txChain: { summary: v4.summary, steps: v4.steps, refresh: { kind: 'uniswap-v4-swap', stepIndex: v4.steps.length - 1, params: refreshParams } },
        buildPath: 'native-swap-uniswap-v4',
        summary: v4.summary,
        guardrails: v4.guardrails,
      }
    } catch (err) {
      if (err instanceof OffTapeError) offTape = offTape ?? err
      else if (err instanceof NoV4PoolError) {
        if (!offTape) return { ok: false, blockKind: 'execution', reasons: `No Uniswap v3 or v4 pool on ${chain.name} can fill ${sell} → ${buy} for this amount.` }
      } else if (!(err instanceof GatedV4PoolError)) throw err
    }
  }

  // Venue-gated pool (quotes but a direct call can't fill), or a pool off
  // the stock's tape → LiFi wraps the chain's own settlement venue. Same
  // order as chat.
  try {
    const lifi = await venues.lifi({ sellToken, buyToken, amountHuman, from, chainId })
    if (lifi.blocked) return { ok: false, blockKind: 'policy', reasons: blockedOf(lifi.guardrails), guardrails: lifi.guardrails, policyBlock: lifi.guardrails.policyBlock }
    return {
      ok: true,
      txChain: { summary: lifi.summary, steps: lifi.steps, refresh: { kind: 'lifi-swap', stepIndex: lifi.swapStepIndex, params: refreshParams } },
      buildPath: 'native-swap-lifi',
      summary: lifi.summary,
      guardrails: lifi.guardrails,
    }
  } catch (lifiErr) {
    if (lifiErr instanceof OffTapeError) {
      return { ok: false, blockKind: 'execution', reasons: `${offTape ? `${offTape.message} ` : ''}${lifiErr.message} Nothing was built.` }
    }
    if (lifiErr instanceof NoLifiRouteError) {
      return {
        ok: false,
        blockKind: 'execution',
        reasons: offTape
          ? `${offTape.message} LiFi couldn't route it through the chain's own venue either — nothing was built.`
          : "This pair only settles through the chain's own venue, and LiFi couldn't route it either — nothing was built.",
      }
    }
    throw lifiErr
  }
}
