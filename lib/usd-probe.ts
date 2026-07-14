// ─────────────────────────────────────────────────────────────────────────
//  USD price probe for dollar-denominated swap asks ("swap $1 worth of ETH
//  for USDG", "buy $5 of AAPL"). Prices ONE whole token in the chain's
//  primary stable via the same venue quoters the build itself uses — v3
//  fee-tier scan first, v4 no-hook scan when v3 has no pool (Robinhood's
//  tokenized stocks are v4-only). Stables are $1 face value.
//
//  Lives in its own module (not lib/uniswap-venue.ts) because it needs BOTH
//  venue layers and uniswap-v4.ts already imports uniswap-venue.ts — a
//  reverse import would cycle.
// ─────────────────────────────────────────────────────────────────────────

import { publicClient } from '@/lib/auth'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals, tokenLabel } from '@/lib/cow'
import { FEE_TIERS, QUOTER_V2_ABI } from '@/lib/uniswap-venue'
import { quoteV4BestOut } from '@/lib/uniswap-v4'

export interface UsdProbe {
  /** USD per ONE whole token. */
  usd: number
  /** Where the price came from — traced so a bad conversion is diagnosable. */
  via: string
}

/**
 * Price one token in USD, or null when it's honestly unpriceable on this
 * chain — callers ask the user for a token amount instead of guessing.
 */
export async function usdPerToken(chainId: number, token: string): Promise<UsdProbe | null> {
  const chain = chainById(chainId)
  if (!chain) return null
  const addr = resolveToken(token, chainId)
  if (!addr) return null
  if (chain.stables[addr.toLowerCase()] !== undefined) return { usd: 1, via: 'stable face value' }
  const stable = primaryStable(chainId)
  if (!stable || stable.address.toLowerCase() === addr.toLowerCase()) return null
  const dec = tokenDecimals(token, chainId) ?? 18
  const oneToken = BigInt(10) ** BigInt(dec)
  const label = tokenLabel(token, chainId)

  // v3: the swap build's own fee-tier scan, for exactly one token in.
  if (chain.uniswap) {
    const client = chainId === 8453 ? publicClient : publicClientFor(chainId)
    if (client) {
      const tiers = await Promise.all(
        FEE_TIERS.map(async (fee): Promise<bigint | null> => {
          try {
            const { result } = await client.simulateContract({
              address: chain.uniswap!.quoterV2,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [{ tokenIn: addr as `0x${string}`, tokenOut: stable.address, amountIn: oneToken, fee, sqrtPriceLimitX96: BigInt(0) }],
            })
            return result[0]
          } catch {
            return null
          }
        }),
      )
      const live = tiers.filter((t): t is bigint => t !== null && t > BigInt(0))
      if (live.length) {
        const best = live.reduce((a, b) => (b > a ? b : a))
        const usd = Number(best) / 10 ** stable.decimals
        if (Number.isFinite(usd) && usd > 0) return { usd, via: `Uniswap v3 ${label}/${stable.symbol}` }
      }
    }
  }

  // v4 fallback — the stock-token pools (quoted against USDG on Robinhood).
  const v4Out = await quoteV4BestOut(chainId, addr as `0x${string}`, stable.address, oneToken)
  if (v4Out !== null) {
    const usd = Number(v4Out) / 10 ** stable.decimals
    if (Number.isFinite(usd) && usd > 0) return { usd, via: `Uniswap v4 ${label}/${stable.symbol}` }
  }
  return null
}

/**
 * "$1" at $3,241.55/ETH → "0.00030849" — a HUMAN amount string bounded by the
 * token's decimals, trailing zeros trimmed. Null when the division produces
 * nothing representable (zero, NaN, negative).
 */
export function usdToTokenAmount(usd: number, usdPerWhole: number, maxDecimals: number): string | null {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(usdPerWhole) || usdPerWhole <= 0) return null
  const raw = usd / usdPerWhole
  if (!Number.isFinite(raw) || raw <= 0) return null
  const s = raw.toFixed(Math.min(maxDecimals, 8)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return Number(s) > 0 ? s : null
}
