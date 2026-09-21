// ─────────────────────────────────────────────────────────────────────────────
//  NEAR Intents as the FALLBACK venue for a Robinhood funding plan's VALUE leg.
//
//  1Click listed Robinhood Chain ("hood") on 2026-09-21. Probed the same day
//  (dry quotes, nothing signed):
//
//      Base USDC → USDG   $3 97.1% · $9 98.8% · $50 99.5% · $5,000 99.6%  ~35s
//      Base ETH / Ethereum USDC → USDG                                  works
//      anything → ETH or WETH ON Robinhood Chain        "No liquidity available"
//
//  So NEAR can carry the USDG leg and cannot carry the gas leg. Against live
//  LiFi quotes the same day (Base / Ethereum / Arbitrum USDC → USDG, $5 to
//  $5,000) LiFi delivered 99.3–99.7% in 1–8s and won every row, so LiFi
//  stays the first venue (lib/lifi-bridge) and this module is what a value
//  leg falls back to when LiFi has no route, is rate-limited, or fails its
//  own price check. It builds ONE thing — origin USDC or ETH → USDG on
//  Robinhood Chain, delivered to the payer — in the LiFi builder's own shape
//  (one step + toAmountMin), so the job card, the refresh recipe and the
//  arrival wait are the ones a LiFi leg already uses.
//
//  The build goes through the near-intents MCP's `build_swap` (the same tool
//  the chat's cross-chain layer calls). The model never writes the deposit
//  address: guardCrossChainBuild pins the transfer to the quote's one-time
//  address for EXACTLY the quoted atoms, delivery + refunds to the payer, no
//  fee (funding legs are free). guardNearValueLeg then binds the quote to the
//  ASK — this sell token, these atoms, USDG on Robinhood Chain, a guaranteed
//  minimum inside the same parity floor the LiFi leg uses.
//
//  Any failure here (MCP not deployed yet, no liquidity, a guard refusal, a
//  timeout) returns null and the caller surfaces LiFi's own error, as before.
// ─────────────────────────────────────────────────────────────────────────────

import { callMcpTool } from '@/lib/mcp-call'
import { formatAtoms } from '@/lib/cow'
import { guardCrossChainBuild, type BuiltSwap } from '@/lib/cross-chain-swap'
import type { GuardrailCheck } from '@/lib/tx-guardrails'

export const NEAR_INTENTS_MCP = process.env.NEAR_INTENTS_MCP_URL || 'https://near-intents.yeetful.com/mcp'

/** 1Click's `blockchain` id for Robinhood Chain. */
export const NEAR_ROBINHOOD_CHAIN = 'hood'

/** Origin chain id → the chain word `build_swap` accepts. Only chains that
 *  are BOTH a funding origin and a 1Click EVM chain. */
export const NEAR_ORIGIN_WORD: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
  42161: 'arbitrum',
  10: 'optimism',
}

/** A deposit address dies at the quote deadline. The card re-quotes this
 *  long before it, so nobody signs into a dying address. */
export const NEAR_DEPOSIT_MARGIN_SEC = 5 * 60
/** The longest a NEAR step stays signable before the card re-quotes it. The
 *  venue's own deadline can run days (observed ~72h, 2026-09-21); the minimum
 *  is guaranteed for that long, but a funding leg should move at a fresh
 *  price. Also used when the venue returns no expiry. */
export const NEAR_STEP_MAX_TTL_SEC = 20 * 60

/** `NEAR_HOOD_FUNDING=off` is the one-env way back to LiFi-only. */
export function nearHoodFundingEnabled(): boolean {
  return (process.env.NEAR_HOOD_FUNDING ?? '').trim().toLowerCase() !== 'off'
}

/** The slices of `build_swap`'s quote this guard reads (the shared BuiltSwap
 *  type names only what the cross-chain guard verifies). */
type NearBuilt = BuiltSwap & {
  quote?: BuiltSwap['quote'] & { receive?: { token?: string; chain?: string; minimumAtoms?: string } }
}

export interface NearValueLegExpectations {
  originChainId: number
  from: string
  sell: { symbol: string; address: string; decimals: number }
  /** True when the sell side is native ETH (a value transfer, no calldata). */
  nativeSell: boolean
  sellAtoms: bigint
  /** The destination stable (USDG). */
  dest: { symbol: string; decimals: number }
  /** The guaranteed minimum must be ≥ this many destination atoms. */
  minOutFloorAtoms: bigint
}

export interface NearValueLegGuard {
  ok: boolean
  reasons: string[]
  tx?: { to: string; data: string; value: string; chainId: number }
  depositAddress?: string
  toAmountMin?: bigint
  /** Unix seconds the step stays signable. */
  validUntil?: number
}

const eq = (a?: string, b?: string): boolean => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/** PURE. Bind a `build_swap` result to the funding ask. Every refusal names
 *  what was wrong; on any of them the leg is not offered. */
export function guardNearValueLeg(raw: unknown, exp: NearValueLegExpectations, nowSec = Math.floor(Date.now() / 1000)): NearValueLegGuard {
  const built = (raw ?? {}) as NearBuilt
  const base = guardCrossChainBuild(built, { chainId: exp.originChainId, fee: null, confidential: false, deliverTo: exp.from, refundTo: exp.from })
  const reasons = [...base.reasons]
  if (!base.ok || !base.tx) return { ok: false, reasons: reasons.length ? reasons : ['The NEAR leg did not build into a signable deposit.'] }

  // The quote must be for THIS ask, not merely self-consistent.
  const sellAtoms = built.quote?.sell?.amountAtoms
  if (!sellAtoms || BigInt(sellAtoms) !== exp.sellAtoms) {
    reasons.push(`The quote sells ${sellAtoms ?? '?'} atoms, not the ${exp.sellAtoms} this leg moves.`)
  }
  if (exp.nativeSell) {
    if ((base.tx.data ?? '0x') !== '0x') reasons.push('An ETH-funded leg must be a plain value transfer.')
  } else if (!eq(base.tx.to, exp.sell.address)) {
    reasons.push(`The deposit transfers a token at ${base.tx.to}, not ${exp.sell.symbol} (${exp.sell.address}).`)
  }
  const receive = built.quote?.receive
  if ((receive?.token ?? '').toUpperCase() !== exp.dest.symbol.toUpperCase()) {
    reasons.push(`The quote delivers ${receive?.token ?? '?'}, not ${exp.dest.symbol}.`)
  }
  if (!/robinhood/i.test(receive?.chain ?? '')) {
    reasons.push(`The quote delivers to ${receive?.chain ?? '?'}, not Robinhood Chain.`)
  }
  let toAmountMin: bigint | undefined
  try {
    toAmountMin = receive?.minimumAtoms ? BigInt(receive.minimumAtoms) : undefined
  } catch {
    toAmountMin = undefined
  }
  if (toAmountMin === undefined || toAmountMin <= BigInt(0)) {
    reasons.push('The quote carries no guaranteed minimum — refusing an unbounded fill.')
  } else if (toAmountMin < exp.minOutFloorAtoms) {
    reasons.push(
      `The route guarantees only ${formatAtoms(toAmountMin.toString(), exp.dest.decimals)} ${exp.dest.symbol} — under the ${formatAtoms(exp.minOutFloorAtoms.toString(), exp.dest.decimals)} floor.`,
    )
  }

  // The deposit address dies at the quote deadline.
  const expiresMs = base.addressExpires ? Date.parse(base.addressExpires) : NaN
  const validUntil = Math.min(nowSec + NEAR_STEP_MAX_TTL_SEC, Number.isFinite(expiresMs) ? Math.floor(expiresMs / 1000) - NEAR_DEPOSIT_MARGIN_SEC : Infinity)
  if (validUntil <= nowSec + 60) reasons.push('The deposit address expires too soon to sign safely.')

  if (reasons.length > 0) return { ok: false, reasons }
  return {
    ok: true,
    reasons: [],
    tx: { to: base.tx.to, data: base.tx.data ?? '0x', value: base.tx.value ?? '0', chainId: exp.originChainId },
    depositAddress: base.depositAddress,
    toAmountMin,
    validUntil,
  }
}

export interface NearValueLegBuilt {
  step: { label: string; title: string; tx: { to: string; data: string; value: string; chainId: number; action: string }; validUntil: number }
  toAmountMin: bigint
  validUntil: number
  depositAddress: string
  priceCheck: GuardrailCheck
  venueCheck: GuardrailCheck
  summary: string
}

/** Build the value leg on NEAR Intents, or null when NEAR can't (the caller
 *  then builds the LiFi leg). Never throws. */
export async function buildNearValueLeg(args: {
  usd: number
  originName: string
  destName: string
  exp: NearValueLegExpectations
  /** The human sell amount `build_swap` takes ("9", "0.004"). */
  amountHuman: string
}): Promise<NearValueLegBuilt | null> {
  const originWord = NEAR_ORIGIN_WORD[args.exp.originChainId]
  if (!originWord) return null
  let raw: unknown
  try {
    raw = await callMcpTool(
      NEAR_INTENTS_MCP,
      'build_swap',
      {
        originChain: originWord,
        originToken: args.exp.sell.symbol,
        destinationChain: NEAR_ROBINHOOD_CHAIN,
        destinationToken: args.exp.dest.symbol,
        amount: args.amountHuman,
        from: args.exp.from,
      },
      { timeoutMs: 15_000 },
    )
  } catch (err) {
    console.warn(`[near-fund-leg] NEAR fallback unavailable (build_swap): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    return null
  }
  const guard = guardNearValueLeg(raw, args.exp)
  if (!guard.ok || !guard.tx || !guard.toAmountMin || !guard.validUntil || !guard.depositAddress) {
    console.warn(`[near-fund-leg] NEAR fallback refused its own build: ${guard.reasons.join(' ')}`)
    return null
  }
  const minOut = formatAtoms(guard.toAmountMin.toString(), args.exp.dest.decimals)
  const title = `Move $${args.usd} ${args.exp.sell.symbol} → ${args.exp.dest.symbol} on ${args.destName} (via NEAR Intents)`
  return {
    step: { label: 'bridge', title, tx: { ...guard.tx, action: 'deposit' }, validUntil: guard.validUntil },
    toAmountMin: guard.toAmountMin,
    validUntil: guard.validUntil,
    depositAddress: guard.depositAddress,
    priceCheck: {
      id: 'price',
      level: 'block',
      ok: true,
      note: `Guaranteed ≥ ${minOut} ${args.exp.dest.symbol} for $${args.usd}${args.exp.nativeSell ? " of ETH (sized at Pantessa's own on-chain read)" : ''} — inside the parity floor.`,
    },
    venueCheck: {
      id: 'venue',
      level: 'block',
      ok: true,
      note: `One transfer of exactly the quoted ${args.exp.sell.symbol} to NEAR Intents' one-time deposit address ${guard.depositAddress.slice(0, 8)}…; delivery and refunds both to your own address; no approval, no fee.`,
    },
    summary: `Move $${args.usd} of ${args.originName} ${args.exp.sell.symbol} → ≥ ${minOut} ${args.exp.dest.symbol} on ${args.destName} (NEAR Intents) — settles in about half a minute, delivered to your own address.`,
  }
}
