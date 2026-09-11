// ─────────────────────────────────────────────────────────────────────────
//  Pool-price honesty for tokenized stocks on Robinhood Chain (4663). The
//  chart draws the TAPE (Robinhood's 24/7 historicals, Yahoo as fallback);
//  the trade fills in a Uniswap pool. Those two numbers differ, and the
//  difference is exactly what a trader pays that a TradingView chart can
//  never show. This module quotes "what would $100 of USDG buy right now"
//  through the same venue quoters the build itself uses (v3 fee-tier scan
//  first, v4 no-hook fallback — lib/usd-probe's discipline, but sized at a
//  real order instead of one whole token so impact is IN the number).
//
//  Server-only (viem clients). Fail-soft by contract: any miss returns null
//  and the chart shows nothing — a wrong pool price is worse than none.
// ─────────────────────────────────────────────────────────────────────────

import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { chartPairFor } from '@/lib/charts'
import { classifyDryRunError } from '@/lib/dry-run'
import { dynamicTokenBySymbol, ensureTokenList } from '@/lib/token-list'
import { FEE_TIERS, QUOTER_V2_ABI } from '@/lib/uniswap-venue'
import { quoteV4BestOut } from '@/lib/uniswap-v4'

export const STOCK_CHAIN_ID = 4663
/** The order the quote is sized at — a real small buy, so impact shows. */
export const POOL_QUOTE_USD = 100

export interface PoolPrice {
  symbol: string
  chainId: number
  /** Dollars quoted in (USDG). */
  quoteUsd: number
  /** Token units that many dollars buys right now. */
  tokenOut: number
  /** Effective USD per token for that order — the "you'd pay" number. */
  usdPerToken: number
  /** Which venue answered (traced like usd-probe). */
  via: string
  asOf: number
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: PoolPrice | null }>()
const inflight = new Map<string, Promise<PoolPrice | null>>()

async function quotePool(symbol: string): Promise<PoolPrice | null> {
  const chain = chainById(STOCK_CHAIN_ID)
  const stable = primaryStable(STOCK_CHAIN_ID)
  if (!chain || !stable) return null
  await ensureTokenList(STOCK_CHAIN_ID).catch(() => undefined)
  const token = dynamicTokenBySymbol(symbol, STOCK_CHAIN_ID)
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token.address)) return null
  const tokenAddr = token.address as `0x${string}`
  const amountIn = BigInt(POOL_QUOTE_USD) * BigInt(10) ** BigInt(stable.decimals)

  let best: bigint | null = null
  let via = ''
  if (chain.uniswap) {
    const client = publicClientFor(STOCK_CHAIN_ID)
    if (client) {
      let transportFailures = 0
      const tiers = await Promise.all(
        FEE_TIERS.map(async (fee): Promise<bigint | null> => {
          try {
            const { result } = await client.simulateContract({
              address: chain.uniswap!.quoterV2,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [{ tokenIn: stable.address, tokenOut: tokenAddr, amountIn, fee, sqrtPriceLimitX96: BigInt(0) }],
            })
            return result[0]
          } catch (err) {
            if (classifyDryRunError(err).kind === 'unavailable') transportFailures++
            return null
          }
        }),
      )
      const live = tiers.filter((t): t is bigint => t !== null && t > BigInt(0))
      if (live.length) {
        best = live.reduce((a, b) => (b > a ? b : a))
        via = `Uniswap v3 ${stable.symbol}/${symbol}`
      } else if (transportFailures === FEE_TIERS.length) {
        // Every tier died on the transport — no chain evidence at all; the
        // v4 probe below reads the same RPC, so stop here (fail-soft).
        return null
      }
    }
  }
  if (best === null) {
    const v4 = await quoteV4BestOut(STOCK_CHAIN_ID, stable.address, tokenAddr, amountIn).catch(() => null)
    if (v4 !== null && v4 > BigInt(0)) {
      best = v4
      via = `Uniswap v4 ${stable.symbol}/${symbol}`
    }
  }
  if (best === null) return null
  const tokenOut = Number(best) / 10 ** token.decimals
  if (!Number.isFinite(tokenOut) || tokenOut <= 0) return null
  const usdPerToken = POOL_QUOTE_USD / tokenOut
  if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) return null
  return { symbol, chainId: STOCK_CHAIN_ID, quoteUsd: POOL_QUOTE_USD, tokenOut, usdPerToken, via, asOf: Date.now() }
}

/**
 * The pool price for a charted Robinhood Chain stock, or null: not a stock,
 * not listed on 4663's warmed token list, no pool, or the RPC was down.
 * Cached 30s per symbol with inflight dedupe (the chart polls).
 */
export async function poolPriceFor(symbolRaw: string): Promise<PoolPrice | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair || pair.source !== 'robinhood') return null
  const key = pair.symbol
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const running = inflight.get(key)
  if (running) return running
  const p = quotePool(key)
    .catch(() => null)
    .then((value) => {
      cache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** "+0.4%" — pool vs tape, signed; null when either side is missing. */
export function poolPremiumPct(pool: PoolPrice | null, tapeLast: number | null): number | null {
  if (!pool || tapeLast === null || !Number.isFinite(tapeLast) || tapeLast <= 0) return null
  return ((pool.usdPerToken - tapeLast) / tapeLast) * 100
}
