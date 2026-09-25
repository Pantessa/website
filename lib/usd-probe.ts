// ─────────────────────────────────────────────────────────────────────────
//  USD price probe for dollar-denominated swap asks ("swap $1 worth of ETH
//  for USDG", "buy $5 of AAPL"). Prices ONE whole token in the chain's
//  primary stable via the same venue quoters the build itself uses — v3
//  fee-tier scan first, v4 no-hook scan when v3 has no pool. Stables are $1
//  face value; Robinhood Chain stocks are their tape (lib/stock-tape), not
//  their pools.
//
//  A QUOTE IS NOT A PRICE UNLESS THE POOL CAN ABSORB IT (2026-09-18). Arc's
//  WETH/USDC 1% pool — empty at launch, so the chain shipped with WETH
//  honestly unpriceable (website#793) — woke up holding about $18 of USDC
//  total. One whole WETH in drains it, so the quoter answered $18.25 per
//  WETH while the same pool's marginal price was ~$2,485. That number is a
//  liquidation value, not a price, and it is wrong in the direction that
//  makes a real position look like pocket change: it values holdings, sizes
//  "$50 of X" asks, and is the figure a spend cap and a policy gate are
//  checked against. Every tier is therefore depth-checked before it is
//  trusted (`judgePoolDepth` below) and a tier that fails is dropped as if
//  it had no pool. Failing closed — no price, callers ask for a token
//  amount — beats a price that is two orders of magnitude out.
//
//  Lives in its own module (not lib/uniswap-venue.ts) because it needs BOTH
//  venue layers and uniswap-v4.ts already imports uniswap-venue.ts — a
//  reverse import would cycle.
// ─────────────────────────────────────────────────────────────────────────

import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { classifyDryRunError } from '@/lib/dry-run'
import { resolveToken, tokenDecimals, tokenLabel } from '@/lib/cow'
import { STOCK_TAPE_CHAIN_ID, stockTapeFor, swapLegOf } from '@/lib/stock-tape'
import { ensureTokenList } from '@/lib/token-list'
import { FEE_TIERS, QUOTER_V2_ABI, stableUsd } from '@/lib/uniswap-venue'
import { quoteV4BestOut } from '@/lib/uniswap-v4'

export interface UsdProbe {
  /** USD per ONE whole token. */
  usd: number
  /** Where the price came from — traced so a bad conversion is diagnosable. */
  via: string
}

// ── The depth fence ─────────────────────────────────────────────────────────

/**
 * How far the probe's average price may fall below the pool's own marginal
 * price before the quote stops being a price. Measured as DECAY: quote the
 * probe size and half of it, and compare `out(full)` against `2 × out(half)`.
 * The fee rate cancels in that ratio, so what is left is pure slippage —
 * how much of the book the probe ate.
 *
 * Constant-product arithmetic maps decay to the error we actually care
 * about. With x = probe ÷ reserve, decay = 1 − (1 + x/2)/(1 + x) and the
 * average price understates the marginal price by a factor 1/(1 + x). So
 * 5% decay ⟺ x ≈ 0.11 ⟺ a price within ~10% of the pool's marginal price —
 * the same 10% band lib/stock-tape holds 4663 stock fills to.
 *
 * Measured live 2026-09-18 across every app chain (the table is in the PR):
 * every pool that is really traded decays under 0.4% at one whole token, the
 * thinnest legitimate tier seen was 3.88% (ETH on Optimism's 1% pool, which
 * is not the winning tier anyway), and every drained pool decays 23.8% or
 * more — 50% in the constant-product limit, which is where Arc's WETH pool
 * sits. 5% is the gap's middle with room on both sides.
 */
export const MAX_PROBE_DECAY_BPS = 500

/**
 * Below this many raw units of the stable, the decay measure is rounding
 * noise rather than slippage — SHIB's half-token quote is 2 units of USDC,
 * and 1 − 5/(2×2) reads as −25% decay on a perfectly healthy pool. 100 units
 * is $0.0001 of a 6-decimal stable, so the check covers every token worth
 * more than ~$0.0002 a whole token (DEGEN at $0.001 clears it by 5×) and
 * steps aside only where a whole token is worth less than the quoter can
 * resolve — which is also where a thin pool cannot hide a real position.
 */
export const MIN_DEPTH_QUOTE_UNITS = BigInt(100)

export interface DepthVerdict {
  /** Decay in bps, or null when the quote is too small to measure. */
  decayBps: number | null
  /** False only when the decay was measured AND it blew the fence. */
  trusted: boolean
}

/**
 * Does `full` — the amount out for one whole token — describe a price, or a
 * pool being drained? Pure: both amounts come from the caller's quoter, so
 * the same rule fences v3 and v4 (and anything that quotes two sizes later).
 *
 * Negative decay (the half quote paying WORSE per token, a fee-rounding
 * artefact on tiny quotes) is clamped to zero: only a price that COLLAPSES
 * with size is evidence of thinness.
 */
export function judgePoolDepth(full: bigint | null, half: bigint | null): DepthVerdict {
  if (full === null || full <= BigInt(0)) return { decayBps: null, trusted: false }
  if (half === null || half < MIN_DEPTH_QUOTE_UNITS) return { decayBps: null, trusted: true }
  const decay = 1 - Number(full) / (2 * Number(half))
  if (!Number.isFinite(decay)) return { decayBps: null, trusted: true }
  const decayBps = Math.round(Math.max(0, decay) * 10_000)
  return { decayBps, trusted: decayBps <= MAX_PROBE_DECAY_BPS }
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
  // A Robinhood Chain stock is worth its tape, never its pool: a "$50 of
  // AMAT" sell sized off a pool paying under 1% of the tape (2026-09-16)
  // would have sold ~100× the shares, and a transfer valued that way slips
  // under a spend cap. No tape → null; callers already refuse or show the
  // row unpriced (lib/stock-tape).
  if (chainId === STOCK_TAPE_CHAIN_ID) {
    await ensureTokenList(chainId)
    const leg = swapLegOf(token, chainId)
    if (leg?.kind === 'stock') {
      const tape = await stockTapeFor(leg.symbol)
      return tape ? { usd: tape.usd, via: `${tape.feed === 'yahoo' ? 'the Yahoo Finance' : "Robinhood's"} tape for ${leg.symbol}` } : null
    }
  }
  const stable = primaryStable(chainId)
  if (!stable || stable.address.toLowerCase() === addr.toLowerCase()) return null
  const dec = tokenDecimals(token, chainId) ?? 18
  const oneToken = BigInt(10) ** BigInt(dec)
  const label = tokenLabel(token, chainId)

  // v3: the swap build's own fee-tier scan, for exactly one token in. The
  // registry client (pinned RPC + fallback) on EVERY chain — Base used to go
  // through lib/auth's unpinned default, and its 429 bursts were the
  // stranger's first chip dying with "I couldn't price ETH on Base" (squad
  // QA P-2, 2026-09-08). A tier that REVERTS has no pool — chain evidence,
  // no retry; a scan where every tier failed on the transport is retried
  // once after a short pause before the honest null.
  if (chain.uniswap) {
    const client = publicClientFor(chainId)
    if (client) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let transportFailures = 0
        const quote = async (amountIn: bigint, fee: number): Promise<bigint | null> => {
          if (amountIn <= BigInt(0)) return null
          try {
            const { result } = await client.simulateContract({
              address: chain.uniswap!.quoterV2,
              abi: QUOTER_V2_ABI,
              functionName: 'quoteExactInputSingle',
              args: [{ tokenIn: addr as `0x${string}`, tokenOut: stable.address, amountIn, fee, sqrtPriceLimitX96: BigInt(0) }],
            })
            return result[0]
          } catch (err) {
            if (classifyDryRunError(err).kind === 'unavailable') transportFailures++
            return null
          }
        }
        // Each tier is judged on its OWN depth, not the winner's: a thin tier
        // that happens to quote HIGH would otherwise win the max() below
        // (Base's cbBTC 0.01% tier and Arbitrum's LINK 0.05% tier are both
        // drained today, next to healthy siblings).
        const tiers = await Promise.all(
          FEE_TIERS.map(async (fee) => {
            const [full, half] = await Promise.all([quote(oneToken, fee), quote(oneToken / BigInt(2), fee)])
            return { fee, full, verdict: judgePoolDepth(full, half) }
          }),
        )
        const live = tiers.filter((t) => t.full !== null && t.full > BigInt(0))
        const trusted = live.filter((t) => t.verdict.trusted)
        for (const t of live) {
          if (t.verdict.trusted) continue
          console.warn(
            `[usd-probe] ${label}/${stable.symbol} on ${chain.name}: dropping the ${t.fee / 10_000}% tier — one whole token decays ${((t.verdict.decayBps ?? 0) / 100).toFixed(1)}% (fence ${MAX_PROBE_DECAY_BPS / 100}%), so its $${(Number(t.full) / 10 ** stable.decimals).toPrecision(6)} is the pool being drained, not a price.`,
          )
        }
        if (trusted.length) {
          const best = trusted.map((t) => t.full!).reduce((a, b) => (b > a ? b : a))
          const usd = Number(best) / 10 ** stable.decimals
          if (Number.isFinite(usd) && usd > 0) return { usd, via: `Uniswap v3 ${label}/${stable.symbol}` }
        }
        // Every tier answered (no pool / dust / too thin) → the chain spoke.
        if (transportFailures === 0 || attempt === 1) break
        await new Promise((r) => setTimeout(r, 400))
      }
    }
  }

  // v4 fallback — the stock-token pools (quoted against USDG on Robinhood).
  // Same fence: quoteV4BestOut already takes the best of its no-hook keys, so
  // both sizes ride the same selection and the ratio still isolates slippage.
  const [v4Out, v4Half] = await Promise.all([
    quoteV4BestOut(chainId, addr as `0x${string}`, stable.address, oneToken),
    quoteV4BestOut(chainId, addr as `0x${string}`, stable.address, oneToken / BigInt(2)),
  ])
  const v4Verdict = judgePoolDepth(v4Out, v4Half)
  if (v4Out !== null && !v4Verdict.trusted && v4Verdict.decayBps !== null) {
    console.warn(
      `[usd-probe] ${label}/${stable.symbol} on ${chain.name}: dropping the v4 quote — one whole token decays ${(v4Verdict.decayBps / 100).toFixed(1)}% (fence ${MAX_PROBE_DECAY_BPS / 100}%).`,
    )
  }
  if (v4Out !== null && v4Verdict.trusted) {
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

/** One side of a built swap, for {@link swapValueUsd}. */
export interface SwapSideAmount {
  /** The token as the build named it (a symbol or an address): what the probe resolves. */
  token: string
  /** Its resolved address on the chain, for the stable face-value check. */
  address: string
  atoms: bigint
  decimals: number
}

/**
 * A built swap's value in dollars. This is the number the spend policy checks
 * and the money-moved metric books. A dollar-stable side counts at face value,
 * sell side first because the outflow is the notional. With no stable side,
 * the sell side is priced with the depth-fenced probe above, then the buy
 * side. Null only when neither side has an honest price.
 *
 * Why (2026-09-25): every venue valued a swap by its stable side alone, so
 * ETH for UNI built with `valueUsd: null`. The policy gate read it as
 * unpriceable, and the signed turn booked $0 of money moved and no trade.
 * #874 made that the common shape: a buy that names no chain now pays with
 * the ETH the wallet holds. The first real one, a $12 UNI buy paid in ETH on
 * Ethereum, never reached the Growth page.
 *
 * `price` is injectable only so the harness can pin the rule without an RPC.
 */
export async function swapValueUsd(
  chainId: number,
  sell: SwapSideAmount,
  buy: SwapSideAmount,
  price: (chainId: number, token: string) => Promise<UsdProbe | null> = usdPerToken,
): Promise<number | null> {
  const atFace = stableUsd(chainId, sell.address, sell.atoms) ?? stableUsd(chainId, buy.address, buy.atoms)
  if (atFace !== null) return atFace
  for (const side of [sell, buy]) {
    const units = Number(side.atoms) / 10 ** side.decimals
    if (!Number.isFinite(units) || units <= 0) continue
    const probe = await price(chainId, side.token).catch(() => null)
    if (probe && Number.isFinite(probe.usd) && probe.usd > 0) return units * probe.usd
  }
  return null
}
