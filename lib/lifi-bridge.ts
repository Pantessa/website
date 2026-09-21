// ─────────────────────────────────────────────────────────────────────────
//  LiFi funding bridge — the cross-chain sibling of lib/lifi-venue.ts.
//  The moment it exists for: "buy $10 of AAPL" on Robinhood Chain from a
//  wallet whose money lives on Base, Ethereum, or Arbitrum. The canonical
//  Robinhood bridge only connects to Ethereum (ETH-only, L1 gas); LiFi's
//  cross-chain routes reach Robinhood Chain from all three first-class
//  origins directly and settle in seconds (probed live 2026-07-15 from
//  Base and 2026-07-17 from Ethereum + Arbitrum: USDC→USDG via across,
//  USDC→native ETH via relay — every quote through the SAME canonical
//  LiFi diamond address on each origin).
//
//  Three funding legs, each its own guarded approve→bridge chain the USER
//  signs on the origin chain:
//    · gas  — origin USDC → native ETH on Robinhood Chain (a few dollars,
//             enough gas for many Orbit-chain transactions)
//    · usdg — origin USDC → USDG on Robinhood Chain (the money that buys
//             the stock)
//    · eth  — origin ETH → native ETH on Robinhood Chain, sized as VALUE:
//             the move a buy of ETH gets instead of ETH → USDG → ETH
//             (2026-09-16; see planRobinhoodEthMove)
//
//  Trust shape mirrors the venue layer: LiFi's inner calldata is
//  aggregator-opaque, so everything AROUND it is pinned and fail-closed:
//    1. ROUTER PINNING — transactionRequest.to and approvalAddress must be
//       on the origin-chain LiFi diamond allowlist (env LIFI_BRIDGE_ROUTERS
//       REPLACES it; empty result = no venue).
//    2. QUOTE ECHO — the quote must echo the intent exactly: origin Base,
//       destination Robinhood Chain, our tokens, our atoms, delivery to the
//       SENDER's own address (never a third party), zero native value on an
//       ERC-20 input.
//    3. PRICE SANITY — USDC→USDG is dollar-to-dollar: toAmountMin below
//       ~96% of the input is a bad or hostile route → refuse. The gas leg
//       is priced against the venue quoters' own ETH/USD read (fail-soft:
//       no probe = warn, a live probe undercut by >10% = refuse).
//  No Pantessa fee on funding legs — the fee lives on the swap that follows
//  (lib/fees.ts via lib/lifi-venue.ts), never on moving your own money in.
//
//  Arrival verification: each built leg records the DESTINATION balance
//  baseline at build time plus the minimum expected delta; the jobs runner
//  polls checkChainArrival until every leg's delta shows up on Robinhood
//  Chain. Waits are the verification layer — the stock-swap build after
//  them re-checks balances anyway, so a lying arrival fails closed.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, erc20Abi, formatEther, parseEther } from 'viem'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { chainAlt } from '@/lib/chain-lexicon'
import { formatAtoms } from '@/lib/cow'
import { fetchLifiQuote, LIFI_POLICY_HOST, LIFI_QUOTE_TTL_SEC, NoLifiRouteError } from '@/lib/lifi-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { buildNearValueLeg, nearHoodFundingEnabled, NEAR_ORIGIN_WORD } from '@/lib/near-fund-leg'
import { buildReport, policyCheck, recipientCheck, validityCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, spentTotalUsd, toPolicy } from '@/lib/grant-store'

export const BASE_CHAIN_ID = 8453
// The destination set (Robinhood Chain + Arc) lives in lib/lifi-destinations
// (pure, client-safe) and is re-exported here so every importer keeps working.
export { ROBINHOOD_CHAIN_ID, ARC_CHAIN_ID, LIFI_DESTINATIONS, LIFI_DESTINATION_CHAINS, lifiDestination, isLifiFundedChain, type LifiDestination } from '@/lib/lifi-destinations'
import { ROBINHOOD_CHAIN_ID, LIFI_DESTINATIONS, lifiDestination, isLifiFundedChain, fundSegment as destFundSegment, type LifiDestination } from '@/lib/lifi-destinations'
/** Bridge tools an ARC leg may use — the 1–4s ones. LiFi's unconstrained
 *  pick for Base → Arc was Polymer at ~18 minutes (probed 2026-09-16);
 *  Across (4s) and Relay (1s) both land ≥99.4% of a $12 leg. */
export const ARC_BRIDGE_TOOLS = ['across', 'relaydepository'] as const
/** LiFi treats the zero address as the chain's native asset. */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as const

// The origin set + its words live in lib/funding-origins.ts (pure, client-
// safe) and are re-exported here so every existing importer keeps working.
export { FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, listWords, fundingOriginWords } from '@/lib/funding-origins'
import { FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, listWords } from '@/lib/funding-origins'
/** Bridged-USDC variants the scan ALSO reads, where lib/chains' stables map
 *  knows them. Arbitrum's USDC.e is the one that bites: a wallet holding only
 *  bridged USDC.e read as "no USDC on Arbitrum" (the 2026-07-21 gasless-scan
 *  sibling — same wallet class, different invisibility). LiFi routes USDC.e →
 *  USDG and → gas ETH onto Robinhood Chain through the SAME canonical diamond
 *  as native USDC (probed live 2026-07-21: across ~99.0% parity min /
 *  relaydepository, 1–2s). Entries must stay in the registry's stables map —
 *  fundingAltUsdcFor cross-checks and drops any the registry forgot. */
export const FUNDING_ALT_USDC: Record<number, { symbol: string; address: `0x${string}`; decimals: number }> = {
  42161: { symbol: 'USDC.e', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 },
  // Optimism's legacy bridged USDC — same bite as Arbitrum's. Its on-chain
  // symbol() returns "USDC", but LiFi (and every explorer) names it USDC.e,
  // and 1Click does NOT list it, so the LiFi lane is the only one that can
  // move it. Route probed live 2026-09-04: across, same canonical diamond,
  // 10 USDC.e -> 9.8388 USDG.
  10: { symbol: 'USDC.e', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 },
}

/** The registry-verified alt-USDC for an origin, or null. */
export function fundingAltUsdcFor(chainId: number): { symbol: string; address: `0x${string}`; decimals: number } | null {
  const alt = FUNDING_ALT_USDC[chainId]
  if (!alt) return null
  const chain = chainById(chainId)
  if (!chain || chain.stables[alt.address.toLowerCase()] === undefined) return null
  return alt
}
/** Native ETH an origin needs before its USDC is signable there — the
 *  approve + bridge pair must be payable, or the chip is a wall later.
 *  Mainnet's floor is real L1 gas; the L2 floors are cents. */
const ORIGIN_MIN_GAS_ETH: Record<number, number> = { 1: 0.002, 8453: 0.00003, 42161: 0.00003, 10: 0.00003 }
/** ETH kept back on an origin when ETH itself is the sell side — the leg's
 *  own signature (and one more after it) must stay payable once the value
 *  leaves. Mirrors lib/funding-plan's GAS_RESERVE_ETH. ETH became a funding
 *  source 2026-07-28: the most common stranger wallet holds ETH and no
 *  stables, and the flagship stock buy answered it "no USDC on Base,
 *  Ethereum, or Arbitrum" — real money, invisible. LiFi routes native ETH →
 *  USDG and → gas ETH from all three origins through the SAME canonical
 *  diamond as the USDC legs (probed live 2026-07-28: across /
 *  relaydepository, value = fromAmount exactly, 1–2s). */
export const ORIGIN_ETH_KEEPBACK: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002, 10: 0.0002 }
/** Sizing headroom when ONE ETH balance funds a gas-included plan — TWO
 *  legs off the same balance. Leg 1's own origin fee is paid out of the
 *  very keep-back leg 2's build re-checks in full, so a plan sized to the
 *  whole movable balance fails at leg 2 by exactly that fee (live
 *  2026-07-28: "~$8 from Ethereum ETH" bridged the $1.5 gas leg, then the
 *  $6.5 value leg refused — the wallet held $6.44 after leg 1's ~$0.06 L1
 *  fee). Covers the extra fee plus inter-leg ETH price drift; the sizing
 *  planners subtract it, the scan's movable number stays the true
 *  single-move capacity. */
export const ETH_TWO_LEG_HEADROOM_USD: Record<number, number> = { 1: 1, 8453: 0.1, 42161: 0.1, 10: 0.1 }
/** A native-ETH leg's build clamps DOWN to the wallet's real movable
 *  balance when it lands within this fraction of the ask (leg-1 fees and
 *  price drift between signatures shave a mid-flight job's balance; the
 *  FUNDING_MARGIN_BPS headroom absorbs the difference so the follow-up buy
 *  still covers). Below it, the honest refusal stands. */
export const NATIVE_CLAMP_MIN_BPS = 9_500

/** Pure core of the mid-flight clamp: the atoms a native-ETH leg should
 *  actually sell given the wallet's live balance. Fully funded → the ask,
 *  untouched. Marginally short (movable ≥ NATIVE_CLAMP_MIN_BPS of the ask)
 *  → the movable balance, keep-back preserved. Really short → null (the
 *  caller refuses by name). */
export function clampNativeSellAtoms(sellAtoms: bigint, balanceWei: bigint, keepbackWei: bigint): bigint | null {
  if (balanceWei >= sellAtoms + keepbackWei) return sellAtoms
  const movable = balanceWei - keepbackWei
  if (movable > BigInt(0) && movable * BigInt(10_000) >= sellAtoms * BigInt(NATIVE_CLAMP_MIN_BPS)) return movable
  return null
}

/** Dollars converted to native ETH on Robinhood Chain for gas — enough for
 *  many Orbit-chain transactions (observed live: $2 → ~0.0008 ETH). Sized to
 *  clear LiFi's small-transfer floor: the old $1.50 leg started getting
 *  "none of the available routes could successfully generate a tx" while $2
 *  filled via relaydepository (live 2026-09-02 — a stranger's flagship
 *  fund-then-buy job walled on step 1). */
export const GAS_LEG_USD = 2
/** Escalation ladder for the gas leg when LiFi's minimum drifts above the
 *  asked size — buildLifiBridgeLeg retries a no-quote gas leg at each size
 *  above the ask, in order, and gives up honestly past the last rung. Jobs
 *  compiled before a floor change carry the old dollar size in their step
 *  params forever, so the BUILDER must self-heal, not just the constant
 *  (probed live 2026-09-02: $1.50 → no quotes, $2 relaydepository, $5
 *  across). Gas-leg-only: a value leg moves the user's exact dollars and
 *  never resizes itself. */
export const GAS_LEG_LADDER_USD = [2, 2.5, 3, 5] as const
/** A Robinhood Chain wallet at/above this much native ETH doesn't need the
 *  gas leg (an Orbit swap chain costs well under a tenth of it). */
export const RH_GAS_FLOOR_WEI = parseEther('0.0002')
/** Headroom on the USDG leg so bridge fees never leave the buy short:
 *  fund(buyUsd) bridges buyUsd × (1 + margin). */
export const FUNDING_MARGIN_BPS = 400
/** USDC→USDG (dollar→dollar): a route guaranteeing less than this fraction
 *  of the input is refused as a bad or self-dealing fill. */
export const STABLE_LEG_MIN_OUT_BPS = 9_600
/** Gas leg (USDC→ETH): tolerated shortfall vs our own ETH/USD read. */
export const GAS_LEG_MIN_OUT_BPS = 9_000
/** ETH move (ETH→ETH): a route guaranteeing less than this share of the ETH
 *  that leaves is a bad or self-dealing fill. The same-asset twin of the
 *  stable leg's dollar-parity floor, checked in atoms, so no price read sits
 *  in the way. Probed 2026-09-16, min-out as a share of what leaves: Base,
 *  Arbitrum and Optimism 98.2–99.2% at $1–$100 (layerswap, relay); Ethereum
 *  96.8% at $1 and 98.0–99.7% from $2 (relay, across). */
export const ETH_MOVE_MIN_OUT_BPS = STABLE_LEG_MIN_OUT_BPS

// The canonical LiFi diamond per origin — the SAME address observed as both
// transactionRequest.to and approvalAddress on live cross-chain quotes to
// Robinhood Chain (Base probed 2026-07-15; Ethereum + Arbitrum probed
// 2026-07-17; Optimism probed 2026-09-04 — USDC, USDC.e, native-ETH value
// and native-ETH gas legs all across, all the same address). Env
// LIFI_BRIDGE_ROUTERS (comma-separated) REPLACES the list; an empty result
// fails closed.
const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE' as const
const DEFAULT_BRIDGE_ROUTERS: Record<number, `0x${string}`[]> = {
  [BASE_CHAIN_ID]: [LIFI_DIAMOND],
  1: [LIFI_DIAMOND],
  42161: [LIFI_DIAMOND],
  10: [LIFI_DIAMOND],
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

export function lifiBridgeRoutersFor(chainId: number): `0x${string}`[] {
  const env = process.env.LIFI_BRIDGE_ROUTERS
  if (env) {
    return env
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is `0x${string}` => ADDR_RE.test(s))
  }
  return DEFAULT_BRIDGE_ROUTERS[chainId] ?? []
}

/** What ONE LiFi value leg costs near the floor, with headroom — the number
 *  a percentage margin cannot express, because the PERCENTAGE is what moves
 *  with size and the percentage is exactly what STABLE_LEG_MIN_OUT_BPS
 *  measures.
 *
 *  Re-measured 2026-09-21: three passes between 14:50Z and 15:17Z, agreeing
 *  with a sample taken earlier the same day (li.quest quotes, slippage 0.5%,
 *  shortfall = dollars in minus toAmountMin; `npm run probe:lifi-leg`
 *  repeats it). USDC → USDG from Base, Ethereum, Arbitrum and Optimism:
 *
 *      $1 → $0.024   $1.50 → $0.025   $2 → $0.027
 *      $3 → $0.030   $5 → $0.036      $9 → $0.048 (across) / $0.045–0.062 (lifiIntents)
 *
 *  About $0.023 flat plus 0.3%, the same within a tenth of a cent from all
 *  four origins and across all three passes. `across` answers nearly every
 *  row; `lifiIntents` takes some $9 rows, and its guaranteed minimum sits
 *  further under its estimate. The legs that carry a swap cost more and move
 *  more: USDC.e → USDG (Arbitrum, Optimism) $0.012–0.045 up to $3, $0.061 at
 *  $5, $0.07–0.15 at $9 — and one $1 row answered by `relaydepository`
 *  guaranteed only 93.2%, which is why the floor stops at $3 and not lower.
 *  USDC → Arc USDC costs less ($0.006–0.028).
 *
 *  The 2026-09-03 probe read $0.16–0.46 at every size ($1 → $0.16,
 *  $5 → $0.21, $100 → $0.46) and the constant was 0.35. The venue got ten
 *  times cheaper in eighteen days, so it can move back: if legs at the floor
 *  start refusing on parity again, re-run the probe and raise this.
 *
 *  0.12 is 2.6× the worst sample from $1.50 to $3 (USDC.e from Optimism,
 *  $0.045), 1.8× the relaydepository $1 outlier, and 2× the worst USDC
 *  sample at any size probed. */
export const LIFI_LEG_FLAT_USD = 0.12

/** The smallest VALUE leg whose flat cost still clears the parity guard —
 *  derived FROM that guard, so moving the floor moves this with it.
 *
 *  Below it the guard can refuse, which means the chip may never fill:
 *  live 2026-09-03, when a leg cost ~$0.17 flat, a "$1.5 from Base" chip
 *  compiled into a job that died on step 1 with *"the route guarantees only
 *  1.329574 USDG for $1.5 — more than 4% below dollar parity, refusing a bad
 *  fill"*. The guard was right; the OFFER was the bug. The floor was $9 until
 *  the 2026-09-21 re-measure (see LIFI_LEG_FLAT_USD); today a $1 leg
 *  guarantees 97.6%, and the floor keeps its distance from that edge.
 *
 *  A value leg moves the user's exact dollars, so — unlike the gas leg's
 *  GAS_LEG_LADDER_USD — it must never resize itself at build time. The
 *  floor therefore lives in the PLANNER: we decline to offer sizes that
 *  cannot fill, and say why. */
export const MIN_VALUE_LEG_USD = Math.ceil(LIFI_LEG_FLAT_USD / (1 - STABLE_LEG_MIN_OUT_BPS / 10_000))

/** The value a funding segment actually bridges: a gas-bearing segment
 *  carries the gas leg's dollars on top (lib/jobs subtracts GAS_LEG_USD to
 *  size the USDG leg), so the parity floor applies to what's LEFT. */
export const valueLegUsd = (fundUsd: number, gasIncluded: boolean) => Number((fundUsd - (gasIncluded ? GAS_LEG_USD : 0)).toFixed(2))

/** Can this funding segment actually fill? The one predicate every chip
 *  passes before it's offered. */
export const fillableLeg = (fundUsd: number, gasIncluded: boolean) => valueLegUsd(fundUsd, gasIncluded) >= MIN_VALUE_LEG_USD

/** The dollars a funding plan must convert to cover a buy: the buy amount
 *  plus bridge-fee headroom, plus the gas leg when the destination wallet
 *  has no ETH. Rounded UP to the next $0.50 so chip labels read clean.
 *  The value portion is floored at MIN_VALUE_LEG_USD — a smaller plan is
 *  not a cheaper plan, it's an unfillable one. */
export function fundingNeedUsd(buyUsd: number, includeGas: boolean): number {
  const value = Math.max(buyUsd * (1 + FUNDING_MARGIN_BPS / 10_000), MIN_VALUE_LEG_USD)
  return Math.ceil((value + (includeGas ? GAS_LEG_USD : 0)) * 2) / 2
}

/** The buy size at which fundingNeedUsd stops being floored — below this
 *  the plan bridges MORE than the ask, which is a thing to SAY, never to
 *  do quietly. */
export const MIN_UNFLOORED_BUY_USD = MIN_VALUE_LEG_USD / (1 + FUNDING_MARGIN_BPS / 10_000)

/** One voice for "your ask is under the bridge's flat cost". Null when the
 *  ask clears on its own — the common case says nothing extra. */
export function minLegNote(buyUsd: number, dest: LifiDestination = LIFI_DESTINATIONS[ROBINHOOD_CHAIN_ID]): string | null {
  if (buyUsd >= MIN_UNFLOORED_BUY_USD) return null
  return (
    `Moving money between chains costs a few cents flat whatever the size, and on a move as small as $${buyUsd} that can be more than the ` +
    `${(10_000 - STABLE_LEG_MIN_OUT_BPS) / 100}% I allow before refusing the fill. The smallest move I can count on landing clean is ~$${MIN_VALUE_LEG_USD} — the rest stays yours as ${primaryStable(dest.chainId)?.symbol ?? 'the chain stable'} on ${dest.name}.`
  )
}

/** The dollars a Robinhood Chain buy must BRIDGE: the buy minus the USDG the
 *  wallet already holds there. Buys and acquisitions share this — a buy that
 *  ignored the held USDG once demanded a ~$12.5 bridge from a wallet holding
 *  $12 of Base USDC plus $0.48 of USDG, and the flagship "Buy $12 of AAPL"
 *  ask walled three times in a row (live 2026-07-27). */
export function robinhoodBuyNeedUsd(buyUsd: number, holdingUsd: number, includeGas: boolean): number {
  return fundingNeedUsd(Math.max(0.01, Number((buyUsd - holdingUsd).toFixed(2))), includeGas)
}

// ── Arrival predicate (built-time baseline + expected delta) ────────────────

export interface ChainArrival {
  chainId: number
  /** ERC-20 address, or 'native'. */
  token: string
  decimals: number
  symbol: string
  /** Destination balance at build time, in atoms (string — survives JSON). */
  baselineAtoms: string
  /** The minimum delta that counts as "arrived" (95% of toAmountMin). */
  minDeltaAtoms: string
}

/** True once EVERY leg's expected delta is visible on its destination chain.
 *  Throws on RPC trouble — the jobs runner treats that as "not yet", never
 *  as arrival. */
export async function checkChainArrival(user: string, arrivals: ChainArrival[]): Promise<{ done: boolean; note: string }> {
  const notes: string[] = []
  let done = true
  for (const a of arrivals) {
    const client = publicClientFor(a.chainId)
    if (!client) throw new Error(`no RPC client for chain ${a.chainId}`)
    const balance =
      a.token === 'native'
        ? await client.getBalance({ address: user as `0x${string}` })
        : await client.readContract({ address: a.token as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [user as `0x${string}`] })
    const arrived = balance >= BigInt(a.baselineAtoms) + BigInt(a.minDeltaAtoms)
    notes.push(`${a.symbol}: ${formatAtoms(balance.toString(), a.decimals)}${arrived ? ' ✓' : ' …'}`)
    if (!arrived) done = false
  }
  return { done, note: notes.join(' · ') }
}

// ── Guard (pure, fail-closed) ───────────────────────────────────────────────

export interface LifiBridgeStep {
  label: string
  title: string
  tx: { to: string; data: string; value: string; chainId: number; action: string }
  validUntil?: number
}

export interface LifiBridgeExpectations {
  originChainId: number
  destinationChainId: number
  routers: string[]
  approvalAddress: string
  sellToken: string
  sellAtoms: bigint
  destinationToken: string
  from: string
  /** Set (= sellAtoms) when the sell side is native ETH: the value rides as
   *  msg.value on the ONE bridge step — no approval exists, and the value
   *  must equal the sold amount exactly. Absent/0 = ERC-20 mode (every step
   *  zero-value). */
  nativeSellAtoms?: bigint
}

/** Echo check on the raw quote — the quote must restate OUR intent exactly.
 *  Shape mirrors verifyLifiQuoteEcho, cross-chain edition. */
export function verifyLifiBridgeEcho(
  quote: { action: { fromToken: { address: string }; toToken: { address: string }; fromAmount: string; fromChainId: number; toChainId: number; toAddress: string }; estimate: { fromAmount: string }; transactionRequest: { chainId: number; value: string } },
  exp: LifiBridgeExpectations,
): string[] {
  const reasons: string[] = []
  const eq = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()
  if (!eq(quote.action.fromToken.address, exp.sellToken)) reasons.push('LiFi echoed a different sell token.')
  if (!eq(quote.action.toToken.address, exp.destinationToken)) reasons.push('LiFi echoed a different destination token.')
  if (quote.action.fromAmount !== exp.sellAtoms.toString() || quote.estimate.fromAmount !== exp.sellAtoms.toString()) {
    reasons.push('LiFi echoed a different input amount.')
  }
  if (quote.action.fromChainId !== exp.originChainId) reasons.push(`LiFi routed from chain ${quote.action.fromChainId}, not ${exp.originChainId}.`)
  if (quote.action.toChainId !== exp.destinationChainId) reasons.push(`LiFi delivers to chain ${quote.action.toChainId}, not ${exp.destinationChainId}.`)
  if (quote.transactionRequest.chainId !== exp.originChainId) reasons.push('The built transaction does not target the origin chain.')
  if (!eq(quote.action.toAddress, exp.from)) reasons.push('Delivery is not to the sending wallet — refusing a third-party destination.')
  let value = BigInt(0)
  try {
    value = BigInt(quote.transactionRequest.value || '0')
  } catch {
    reasons.push('The bridge carries an unreadable native value — refusing.')
  }
  const expectedValue = exp.nativeSellAtoms ?? BigInt(0)
  if (value !== expectedValue) {
    reasons.push(
      expectedValue > BigInt(0)
        ? 'The bridge does not carry exactly the sold ETH as native value — refusing.'
        : 'The bridge carries native value — an ERC-20 input must not send ETH.',
    )
  }
  return reasons
}

/** Verify the assembled step chain: exact-amount approval to the allowlisted
 *  diamond, the bridge call addressed only to it, zero native value (or —
 *  native-ETH legs — exactly the sold amount on the single bridge step),
 *  origin chain only. Inner calldata is aggregator-opaque by design —
 *  pinning + price sanity + the sign-time estimateGas gate stand in for
 *  byte-decoding. */
export function guardLifiBridgeBuild(steps: LifiBridgeStep[], exp: LifiBridgeExpectations): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (exp.routers.length === 0) return { ok: false, reasons: ['No LiFi bridge router allowlist for the origin chain — refusing.'] }
  const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (!exp.routers.some((r) => eqAddr(r, exp.approvalAddress))) {
    reasons.push('The quoted approvalAddress is not on the pinned LiFi bridge allowlist — refusing.')
  }
  const nativeAtoms = exp.nativeSellAtoms ?? BigInt(0)
  if (nativeAtoms > BigInt(0) && steps.length !== 1) {
    return { ok: false, reasons: ['A native-ETH leg must be a single bridge step — no approval belongs in it.'] }
  }
  if (steps.length < 1 || steps.length > 2) {
    return { ok: false, reasons: [`Expected 1–2 steps (approve? → bridge), got ${steps.length}.`] }
  }
  const bridge = steps[steps.length - 1]
  const approvals = steps.slice(0, -1)
  for (const step of steps) {
    if (step.tx.chainId !== exp.originChainId) reasons.push(`A step targets chain ${step.tx.chainId}, not the origin chain ${exp.originChainId}.`)
    const expectValue = step === bridge ? nativeAtoms : BigInt(0)
    if (BigInt(step.tx.value || '0') !== expectValue) {
      reasons.push(
        expectValue > BigInt(0)
          ? 'The bridge step must carry exactly the sold ETH as native value — refusing.'
          : 'Every step must carry zero native value.',
      )
    }
  }
  for (const step of approvals) {
    if (!eqAddr(step.tx.to, exp.sellToken)) {
      reasons.push('The approval step does not target the sell token — refusing.')
      continue
    }
    try {
      const dec = decodeFunctionData({ abi: erc20Abi, data: step.tx.data as `0x${string}` })
      if (dec.functionName !== 'approve') {
        reasons.push(`The approval step calls "${dec.functionName}", not approve — refusing.`)
      } else {
        const [spender, amount] = dec.args as [string, bigint]
        if (!eqAddr(spender, exp.approvalAddress)) reasons.push('The approval spender is not the quoted approvalAddress.')
        if (!exp.routers.some((r) => eqAddr(r, spender))) reasons.push('The approval spender is not on the pinned LiFi bridge allowlist.')
        if (amount !== exp.sellAtoms) reasons.push('The approval is not exactly the bridged amount — exact-amount approvals only.')
      }
    } catch {
      reasons.push('Could not decode the approval calldata — refusing.')
    }
  }
  if (!exp.routers.some((r) => eqAddr(r, bridge.tx.to))) {
    reasons.push('The bridge call is not addressed to a pinned LiFi router — refusing.')
  }
  if (typeof bridge.tx.data !== 'string' || bridge.tx.data.length < 10) reasons.push('The bridge calldata is empty — refusing.')
  return { ok: reasons.length === 0, reasons }
}

// ── The builder ─────────────────────────────────────────────────────────────

export type FundingLeg = 'gas' | 'usdg' | 'eth'

export interface LifiBridgeBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  /** [approve?, bridge] — the bridge step carries validUntil. */
  steps: LifiBridgeStep[]
  /** Index of the bridge step (the refresh recipe's stepIndex). */
  bridgeStepIndex: number
  /** What the arrival wait polls for on Robinhood Chain. */
  arrival: ChainArrival
  valueUsd: number
  /** Who built the leg. A Robinhood USDG leg tries NEAR Intents first
   *  (lib/near-fund-leg) and falls back to LiFi; everything else is LiFi.
   *  The refresh recipe carries it, so a re-quote stays on the venue whose
   *  step list the card is already walking. */
  venue: FundingVenue
}

export type FundingVenue = 'near' | 'lifi'

/** Build + guard ONE funding leg: origin-chain USDC → (native ETH | USDG)
 *  delivered to the sender's own address on Robinhood Chain. The origin
 *  defaults to Base (every pre-existing job/refresh recipe omits it) and
 *  must be a FUNDING_ORIGIN_CHAINS member. `token` picks the origin-side
 *  sell stable: absent/USDC = the chain's native USDC (every pre-existing
 *  recipe), 'USDC.e' = the registry-known bridged variant (Arbitrum only —
 *  anywhere else throws). Throws on transport / no-route (the jobs runner
 *  surfaces the message); a guard or price failure comes back as blocked
 *  with the reasons in the report. */
export async function buildLifiBridgeLeg(params: { leg: FundingLeg; usd: number; from: string; origin?: number; token?: string; dest?: number; venue?: FundingVenue }): Promise<LifiBridgeBuilt> {
  const from = params.from as `0x${string}`
  if (!ADDR_RE.test(from)) throw new Error('A valid wallet address is required.')
  if (!Number.isFinite(params.usd) || params.usd <= 0) throw new Error(`Couldn't read the funding amount "${params.usd}".`)
  const originId = params.origin ?? BASE_CHAIN_ID
  if (!FUNDING_ORIGIN_WORD[originId]) throw new Error(`Chain ${originId} isn't a supported funding origin.`)
  const origin = chainById(originId)!
  // The destination defaults to Robinhood Chain (every pre-existing job /
  // refresh recipe omits it) and must be a LIFI_DESTINATIONS member.
  const destId = params.dest ?? ROBINHOOD_CHAIN_ID
  const destRec = lifiDestination(destId)
  if (!destRec) throw new Error(`Chain ${destId} isn't a LiFi funding destination.`)
  const destination = chainById(destId)!
  if (params.leg === 'gas' && !destRec.gasLeg) {
    throw new Error(`${destination.name} pays gas in ${destination.nativeSymbol} — a funding leg there needs no separate gas leg.`)
  }
  if (params.leg === 'eth' && destination.nativeSymbol !== 'ETH') {
    throw new Error(`${destination.name}'s native token is ${destination.nativeSymbol} — an ETH move lands only where ETH is native.`)
  }
  const routers = lifiBridgeRoutersFor(originId)
  if (routers.length === 0) throw new Error(`LiFi bridging isn’t allowlisted on ${origin.name}.`)
  const originClient = publicClientFor(originId)
  const destClient = publicClientFor(destId)
  if (!originClient || !destClient) throw new Error('No RPC client configured for the funding route.')

  // The origin-side sell asset: native USDC unless the recipe pinned a
  // registry-known bridged variant ('USDC.e') or native ETH ('ETH', sold by
  // value — probed live 2026-07-28, same canonical diamond as the stable
  // legs). Normalized so 'usdc.e'/'USDCE' both land.
  const tokenKey = (params.token ?? 'USDC').toUpperCase().replace(/[^A-Z]/g, '')
  const nativeSell = tokenKey === 'ETH'
  let sell: { symbol: string; address: `0x${string}`; decimals: number }
  if (tokenKey === 'USDC') {
    const native = origin.tokens.USDC
    if (!native) throw new Error(`${origin.name} has no USDC in the chain registry.`)
    sell = { symbol: 'USDC', ...native }
  } else if (tokenKey === 'USDCE') {
    const alt = fundingAltUsdcFor(originId)
    if (!alt) throw new Error(`${origin.name} has no registry-known USDC.e to fund from.`)
    sell = alt
  } else if (nativeSell) {
    sell = { symbol: 'ETH', address: NATIVE_TOKEN, decimals: 18 }
  } else {
    throw new Error(`"${params.token}" isn't a supported funding token — USDC, USDC.e, or ETH only.`)
  }
  const usdg = primaryStable(destId)!
  // Stables are the $1 unit; an ETH sell sizes at build time off Pantessa's
  // own venue-quoter read, so a chip minted yesterday still moves today's
  // right amount of ETH.
  let ethUsdRead: number | null = null
  if (nativeSell) {
    const probe = await usdPerToken(8453, 'ETH').catch(() => null)
    if (!probe) throw new Error("Couldn't price ETH to size the funding leg — try again in a moment.")
    ethUsdRead = probe.usd
  }
  const sizeSellAtoms = (usd: number): bigint =>
    nativeSell ? parseEther((usd / ethUsdRead!).toFixed(8)) : BigInt(Math.round(usd * 10 ** sell.decimals))
  let sellAtoms = sizeSellAtoms(params.usd)
  const gasLeg = params.leg === 'gas'
  // An ETH move carries the user's own ETH as ETH, so only native ETH can be
  // its sell side (USDC → ETH would be a buy, and buys live on the swap).
  const moveLeg = params.leg === 'eth'
  if (moveLeg && !nativeSell) throw new Error('An ETH move sells native ETH ("using eth") — nothing else moves as ETH.')
  const nativeOut = gasLeg || moveLeg
  const destinationToken = nativeOut ? NATIVE_TOKEN : usdg.address
  const destSymbol = nativeOut ? 'ETH' : usdg.symbol
  const destDecimals = nativeOut ? 18 : usdg.decimals

  // Funding must actually be fundable — read the origin balance up front.
  // A native sell must also clear the keep-back: the leg's own signature
  // (and one more) stays payable after the value leaves.
  const keepbackWei = nativeSell ? parseEther(String(ORIGIN_ETH_KEEPBACK[originId] ?? 0.002)) : BigInt(0)
  const sellBalance = nativeSell
    ? await originClient.getBalance({ address: from })
    : await originClient.readContract({ address: sell.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
  // Mid-flight self-heal: a native leg's sibling legs pay their fees out of
  // the SAME balance this leg sells, and ETH re-prices between signatures —
  // a marginal shortfall (within NATIVE_CLAMP_MIN_BPS of the ask) clamps
  // the sell down to the wallet's real movable balance instead of stranding
  // the job (live 2026-07-28: the $6.5 value leg refused over leg 1's
  // ~$0.06 fee). FUNDING_MARGIN_BPS headroom on the plan absorbs the shave;
  // a real shortfall past the tolerance still refuses by name.
  let clampedFromUsd: number | null = null
  if (nativeSell) {
    const clamped = clampNativeSellAtoms(sellAtoms, sellBalance, keepbackWei)
    if (clamped !== null && clamped !== sellAtoms) {
      clampedFromUsd = params.usd
      params = { ...params, usd: Number(((params.usd * Number(clamped)) / Number(sellAtoms)).toFixed(2)) }
      sellAtoms = clamped
    }
  }
  // ── NEAR Intents: the SECOND venue for the one leg it can carry ──────────
  // 1Click reaches Robinhood Chain since 2026-09-21 (USDG in fills at every
  // size; ETH in has no liquidity, so the gas leg and the ETH move never come
  // here). Measured the same day against live LiFi quotes, Base / Ethereum /
  // Arbitrum USDC → USDG, $5–$5,000: LiFi delivered 99.3–99.7% in 1–8s, NEAR
  // 98.1–99.6% in 26–46s. LiFi wins every row, so it stays first; NEAR is
  // what a value leg falls back to when LiFi has no route, is rate-limited
  // (live 2026-09-02) or fails its own price/venue check, instead of
  // stranding the job. Only a FUNDED leg asks: a real 1Click quote mints a
  // deposit address, and the unfunded case keeps LiFi's named refusal.
  // `venue` is the refresh recipe's memory: 'near' re-quotes on NEAR only
  // (a one-step card has no approval slot for a LiFi rebuild), 'lifi' on
  // LiFi only (the mirror).
  const nearCapable =
    params.leg === 'usdg' &&
    destId === ROBINHOOD_CHAIN_ID &&
    (tokenKey === 'USDC' || nativeSell) &&
    Boolean(NEAR_ORIGIN_WORD[originId])
  const nearFunded = sellBalance >= sellAtoms + keepbackWei
  const tryNear = async (): Promise<LifiBridgeBuilt | null> => {
    const floorBps = nativeSell ? GAS_LEG_MIN_OUT_BPS : STABLE_LEG_MIN_OUT_BPS
    const usdAtoms = BigInt(Math.round(params.usd * 10 ** destDecimals))
    const near = await buildNearValueLeg({
      usd: params.usd,
      originName: origin.name,
      destName: destination.name,
      amountHuman: formatAtoms(sellAtoms.toString(), sell.decimals),
      exp: {
        originChainId: originId,
        from,
        sell,
        nativeSell,
        sellAtoms,
        dest: { symbol: destSymbol, decimals: destDecimals },
        minOutFloorAtoms: (usdAtoms * BigInt(floorBps)) / BigInt(10_000),
      },
    })
    if (!near) return null
    const baseline = await destClient.readContract({ address: usdg.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
    const balanceCheck: GuardrailCheck = {
      id: 'balance',
      level: 'block',
      ok: true,
      note:
        clampedFromUsd !== null
          ? `Sized to what the wallet holds: ~$${params.usd} of ${sell.symbol} on ${origin.name} (the $${clampedFromUsd} ask, less fees already paid by earlier legs; gas keep-back kept).`
          : `The wallet holds ${formatAtoms(sellBalance.toString(), sell.decimals)} ${sell.symbol} on ${origin.name} — covered${nativeSell ? ' (gas keep-back included)' : ''}.`,
    }
    const gate = await fundingPolicyGate(from, params.usd, 'NEAR Intents')
    const checks: GuardrailCheck[] = [recipientCheck(from, from), validityCheck(near.validUntil), balanceCheck, near.priceCheck, near.venueCheck, gate.check]
    const guardrails = buildReport(params.usd, checks, gate.violation ? { violation: gate.violation, valueUsd: params.usd, host: LIFI_POLICY_HOST } : null)
    return {
      summary: near.summary,
      guardrails,
      blocked: !guardrails.ok,
      steps: [near.step],
      bridgeStepIndex: 0,
      arrival: {
        chainId: destId,
        token: usdg.address,
        decimals: destDecimals,
        symbol: destSymbol,
        baselineAtoms: baseline.toString(),
        minDeltaAtoms: ((near.toAmountMin * BigInt(95)) / BigInt(100)).toString(),
      },
      valueUsd: Number(params.usd.toFixed(2)),
      venue: 'near',
    }
  }
  if (params.venue === 'near') {
    if (!nearCapable) throw new Error('This funding leg cannot be rebuilt on NEAR Intents.')
    if (!nearFunded) throw new Error(`The wallet no longer holds the ${sell.symbol} on ${origin.name} this leg moves.`)
    const near = await tryNear()
    if (near) return near
    throw new Error('NEAR Intents could not re-quote this leg right now — the step you have stays valid until its deposit address expires.')
  }
  const nearFallback = params.venue === undefined && nearCapable && nearFunded && nearHoodFundingEnabled()

  // Quote — with the gas-leg escalation ladder. A gas leg whose asked size
  // sits under LiFi's live route minimum retries at each GAS_LEG_LADDER_USD
  // rung above the ask instead of stranding the job (live 2026-09-02: a
  // compiled job's $1.50 gas leg got "none of the available routes could
  // successfully generate a tx" while $2 filled — old jobs carry the old
  // size in their step params forever, so the constant alone can't fix
  // them). Escalation never promises past the wallet's real balance, and a
  // value leg (the user's exact dollars) never resizes — its no-route still
  // throws for the runner to surface.
  const quoteSizesUsd = gasLeg ? [params.usd, ...GAS_LEG_LADDER_USD.filter((u) => u > params.usd)] : [params.usd]
  let quote: Awaited<ReturnType<typeof fetchLifiQuote>> | null = null
  let escalatedFromUsd: number | null = null
  let lastNoRoute: NoLifiRouteError | null = null
  for (const usd of quoteSizesUsd) {
    let atoms = sellAtoms
    if (usd !== params.usd) {
      atoms = sizeSellAtoms(usd)
      if (atoms + keepbackWei > sellBalance) break
    }
    try {
      quote = await fetchLifiQuote({
        chainId: originId,
        toChainId: destId,
        sellAddr: sell.address,
        buyAddr: destinationToken,
        swapAtoms: atoms,
        from,
        slippageBps: 50,
        ...(destRec.key === 'arc' ? { allowBridges: ARC_BRIDGE_TOOLS } : {}),
      })
      if (usd !== params.usd) {
        escalatedFromUsd = params.usd
        params = { ...params, usd }
        sellAtoms = atoms
      }
      break
    } catch (err) {
      if (!gasLeg) {
        // A value leg never resizes — but it can change venue.
        if (nearFallback) {
          console.warn(`[lifi-bridge] LiFi could not quote the $${params.usd} value leg — trying NEAR Intents: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
          const near = await tryNear()
          if (near) return near
        }
        throw err
      }
      if (!(err instanceof NoLifiRouteError)) throw err
      lastNoRoute = err
    }
  }
  if (!quote) {
    throw new Error(
      `LiFi has no route for the gas leg from ${origin.name} right now (no quote at ${quoteSizesUsd.map((u) => `$${u}`).join(', ')}) — ${lastNoRoute?.message ?? 'the wallet cannot fund a larger try'}. Try again shortly.`,
    )
  }

  const funded = sellBalance >= sellAtoms + keepbackWei
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: funded,
    note: funded
      ? clampedFromUsd !== null
        ? `Sized to what the wallet holds: ~$${params.usd} of ${sell.symbol} on ${origin.name} (the $${clampedFromUsd} ask, less fees already paid by earlier legs; gas keep-back kept).`
        : `The wallet holds ${formatAtoms(sellBalance.toString(), sell.decimals)} ${sell.symbol} on ${origin.name} — covered${nativeSell ? ' (gas keep-back included)' : ''}${escalatedFromUsd !== null ? ` (gas leg sized up from $${escalatedFromUsd} to $${params.usd} — LiFi's route minimum)` : ''}.`
      : `Insufficient ${sell.symbol} on ${origin.name}: this leg needs $${params.usd}${nativeSell ? ' plus a gas keep-back' : ''} but the wallet holds ${formatAtoms(sellBalance.toString(), sell.decimals)}.`,
  }

  const exp: LifiBridgeExpectations = {
    originChainId: originId,
    destinationChainId: destId,
    routers,
    approvalAddress: quote.estimate.approvalAddress,
    sellToken: sell.address,
    sellAtoms,
    destinationToken,
    from,
    ...(nativeSell ? { nativeSellAtoms: sellAtoms } : {}),
  }
  const echoReasons = verifyLifiBridgeEcho(quote, exp)

  const toAmountMin = BigInt(quote.estimate.toAmountMin)
  const validUntil = Math.floor(Date.now() / 1000) + LIFI_QUOTE_TTL_SEC

  // Price sanity. Stable USDG leg: dollar→dollar, min-out floor in the same
  // 6-dec unit. ETH-sold USDG leg: the sell was sized off Pantessa's own
  // ETH/USD read, so the guaranteed USDG (≈ dollars) must land within the
  // priced-leg tolerance of the ask. Gas leg: value the guaranteed ETH
  // against our own venue-quoter ETH/USD read (fail-soft — a dead probe
  // warns instead of blocking).
  let priceCheck: GuardrailCheck
  if (moveLeg) {
    // ETH in, ETH out: parity in atoms, no oracle between them.
    const floor = (sellAtoms * BigInt(ETH_MOVE_MIN_OUT_BPS)) / BigInt(10_000)
    const ok = toAmountMin >= floor
    priceCheck = {
      id: 'price',
      level: 'block',
      ok,
      note: ok
        ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), 18)} ETH for the ${formatAtoms(sellAtoms.toString(), 18)} ETH that leaves — within ${(10_000 - ETH_MOVE_MIN_OUT_BPS) / 100}% of it.`
        : `The route guarantees only ${formatAtoms(toAmountMin.toString(), 18)} ETH for the ${formatAtoms(sellAtoms.toString(), 18)} ETH that leaves — more than ${(10_000 - ETH_MOVE_MIN_OUT_BPS) / 100}% lost on the way, refusing a bad fill.`,
    }
  } else if (!gasLeg && !nativeSell) {
    const floor = (sellAtoms * BigInt(STABLE_LEG_MIN_OUT_BPS)) / BigInt(10_000)
    const ok = toAmountMin >= floor
    priceCheck = {
      id: 'price',
      level: 'block',
      ok,
      note: ok
        ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} for $${params.usd} — within ${(10_000 - STABLE_LEG_MIN_OUT_BPS) / 100}% of dollar parity.`
        : `The route guarantees only ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} for $${params.usd} — more than ${(10_000 - STABLE_LEG_MIN_OUT_BPS) / 100}% below dollar parity, refusing a bad fill.`,
    }
  } else if (!gasLeg) {
    const minOutUsd = Number(toAmountMin) / 10 ** destDecimals
    const ok = minOutUsd >= params.usd * (GAS_LEG_MIN_OUT_BPS / 10_000)
    priceCheck = {
      id: 'price',
      level: 'block',
      ok,
      note: ok
        ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} for $${params.usd} of ETH (sized at Pantessa's own on-chain read).`
        : `The route guarantees only ~$${minOutUsd.toFixed(2)} of ${destSymbol} for $${params.usd} of ETH — more than ${(10_000 - GAS_LEG_MIN_OUT_BPS) / 100}% short of Pantessa's own on-chain read, refusing.`,
    }
  } else {
    const probe = await usdPerToken(destId, 'ETH').catch(() => null)
    if (!probe) {
      priceCheck = { id: 'price', level: 'warn', ok: true, note: 'No independent ETH/USD read available to cross-check the gas leg — relying on the pinned route + sign-time estimate.' }
    } else {
      const minOutUsd = Number(formatEther(toAmountMin)) * probe.usd
      const ok = minOutUsd >= params.usd * (GAS_LEG_MIN_OUT_BPS / 10_000)
      priceCheck = {
        id: 'price',
        level: 'block',
        ok,
        note: ok
          ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), 18)} ETH (~$${minOutUsd.toFixed(2)} at Pantessa's own on-chain read) for the $${params.usd} gas leg.`
          : `The route guarantees only ~$${minOutUsd.toFixed(2)} of ETH for $${params.usd} — more than ${(10_000 - GAS_LEG_MIN_OUT_BPS) / 100}% short of Pantessa's own on-chain read, refusing.`,
      }
    }
  }

  // Allowance → optional exact-amount approval step. Native ETH rides as
  // msg.value on the bridge call itself — no allowance exists to read.
  const approvalAddress = quote.estimate.approvalAddress as `0x${string}`
  let allowance = BigInt(0)
  if (!nativeSell) {
    try {
      allowance = await originClient.readContract({ address: sell.address, abi: erc20Abi, functionName: 'allowance', args: [from, approvalAddress] })
    } catch {
      allowance = BigInt(0)
    }
  }
  const needsApprove = !nativeSell && allowance < sellAtoms

  const steps: LifiBridgeStep[] = []
  if (needsApprove) {
    steps.push({
      label: 'approve',
      title: `Approve ${formatAtoms(sellAtoms.toString(), sell.decimals)} ${sell.symbol} to LiFi`,
      tx: {
        to: sell.address,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approvalAddress, sellAtoms] }),
        value: '0',
        chainId: originId,
        action: 'approve',
      },
    })
  }
  const bridgeStepIndex = steps.length
  steps.push({
    label: 'bridge',
    title: gasLeg
      ? `Bridge $${params.usd} ${sell.symbol} → gas ETH on ${destination.name} (via ${quote.tool})`
      : moveLeg
        ? `Move $${params.usd} of ${origin.name} ETH → ETH on ${destination.name} (via ${quote.tool})`
        : `Bridge $${params.usd} ${sell.symbol} → ${destSymbol} on ${destination.name} (via ${quote.tool})`,
    tx: {
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: nativeSell ? sellAtoms.toString() : '0',
      chainId: originId,
      action: 'bridge',
    },
    validUntil,
  })

  const guard = guardLifiBridgeBuild(steps, exp)
  const allGuardReasons = [...echoReasons, ...guard.reasons]
  const venueCheck: GuardrailCheck = {
    id: 'venue',
    level: 'block',
    ok: allGuardReasons.length === 0,
    note:
      allGuardReasons.length === 0
        ? `Bridge pinned to LiFi's ${origin.name} diamond ${quote.transactionRequest.to.slice(0, 8)}… (tool: ${quote.tool}); delivery to your own address on ${destination.name}; approval exact-amount.`
        : `Build failed verification: ${allGuardReasons.join(' ')}`,
  }

  // Destination baseline for the arrival wait — read BEFORE anything is
  // signed, so the wait measures the delta this leg is expected to add.
  const baseline = nativeOut
    ? await destClient.getBalance({ address: from })
    : await destClient.readContract({ address: usdg.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
  const arrival: ChainArrival = {
    chainId: destId,
    token: nativeOut ? 'native' : usdg.address,
    decimals: destDecimals,
    symbol: destSymbol,
    baselineAtoms: baseline.toString(),
    minDeltaAtoms: ((toAmountMin * BigInt(95)) / BigInt(100)).toString(),
  }

  // ── Cross-app policy gate: same as every native venue (2026-07-20 audit —
  // this builder used to skip it entirely, so a FROZEN or REVOKED account
  // could still build and sign a funding bridge; the direction-aware
  // invariant says kill switches survive everything). selfSigned: the owner
  // signs each leg, so the caps never wall it — kill switches + allowlist do.
  const { check: polCheck, violation } = await fundingPolicyGate(from, params.usd, 'LiFi')

  const checks: GuardrailCheck[] = [recipientCheck(quote.action.toAddress ?? '', from), validityCheck(validUntil), balanceCheck, priceCheck, venueCheck, polCheck]
  const guardrails = buildReport(params.usd, checks, violation ? { violation, valueUsd: params.usd, host: LIFI_POLICY_HOST } : null)

  if (nearFallback && (!priceCheck.ok || !venueCheck.ok)) {
    console.warn(`[lifi-bridge] LiFi's $${params.usd} value leg failed its ${!priceCheck.ok ? 'price' : 'venue'} check — trying NEAR Intents.`)
    const near = await tryNear()
    if (near && !near.blocked) return near
  }

  const summary = gasLeg
    ? `Bridge $${params.usd} of ${origin.name} ${sell.symbol} → ~${formatAtoms(toAmountMin.toString(), 18)} ETH on ${destination.name} for gas (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`
    : moveLeg
      ? `Move $${params.usd} of your ${origin.name} ETH → ≥ ${formatAtoms(toAmountMin.toString(), 18)} ETH on ${destination.name} (LiFi-routed, tool: ${quote.tool}) — the same ETH, arriving in seconds at your own address.`
      : `Bridge $${params.usd} of ${origin.name} ${sell.symbol} → ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} on ${destination.name} (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`

  return {
    summary,
    guardrails,
    blocked: !guardrails.ok,
    steps,
    bridgeStepIndex,
    arrival,
    valueUsd: Number(params.usd.toFixed(2)),
    venue: 'lifi',
  }
}

/** The cross-app policy gate every funding leg passes, whichever venue built
 *  it (2026-07-20 audit: this builder once skipped it, so a FROZEN or REVOKED
 *  account could still sign a funding bridge). selfSigned: the owner signs
 *  each leg, so the caps never wall it; kill switches + allowlist do. Funding
 *  is ONE policy surface (LIFI_POLICY_HOST, always allowed as a native
 *  venue); the ledger note names the venue that was refused. */
async function fundingPolicyGate(from: string, usd: number, venueName: string): Promise<{ check: GuardrailCheck; violation: ReturnType<typeof policyCheck>['violation'] }> {
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const { check, violation } = policyCheck(usd, policy, spentToday, LIFI_POLICY_HOST, spentTotal, { selfSigned: true })
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: LIFI_POLICY_HOST,
      serviceName: venueName,
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (${venueName.toLowerCase()} funding leg)`,
    })
  }
  return { check, violation }
}

// ── Funding shortfall read (the offer turn's evidence) ─────────────────────

export interface FundingOrigin {
  chainId: number
  /** The chain word chip resumes use ("Base", "Ethereum", "Arbitrum"). */
  word: string
  /** The token held there — 'USDC', a registry-known bridged variant
   *  ('USDC.e' on Arbitrum), or 'ETH' (native, sold by value). One
   *  FundingOrigin row per (chain, token). */
  token: string
  /** Whole dollars of that token there (floored; ETH rows price the
   *  MOVABLE balance — the keep-back never counts as buying power). */
  usd: number
  /** Native ETH held there — how a gas-stranded sibling finds a donor. */
  gasEth: number
  /** ETH rows only: true when the balance clears the keep-back and can be
   *  planned. False = a named-only row (real money under the floor) that
   *  refusals must mention but no chip may spend. */
  spendable?: boolean
}

/** Chip-label qualifier: "Base" for native USDC, "Arbitrum USDC.e" when the
 *  row holds a bridged variant — two rows can share a chain word. */
const originLabel = (o: FundingOrigin) => (o.token === 'USDC' ? o.word : `${o.word} ${o.token}`)

/** The dollars a plan may actually PROMISE from an origin. Stables spend
 *  their full row (gas is paid in ETH, the stable balance is untouched);
 *  an ETH row funding a gas-included segment runs TWO legs off the one
 *  balance and must keep ETH_TWO_LEG_HEADROOM_USD back for leg 1's own
 *  fee + inter-leg drift, or the chip is a mid-job wall. */
export const originCapUsd = (o: FundingOrigin, gasIncluded: boolean): number =>
  o.token === 'ETH' && gasIncluded ? Math.max(0, o.usd - (ETH_TWO_LEG_HEADROOM_USD[o.chainId] ?? 1)) : o.usd

export interface FundingShortfall {
  /** Atoms of the DESTINATION's primary stable the wallet holds there (USDG
   *  on Robinhood Chain, USDC on Arc). The field name is historical. */
  usdgAtoms: bigint
  /** True when the wallet can already pay gas there (always true on a
   *  stable-gas destination — the stable is the gas). */
  hasGas: boolean
  /** Whole dollars of native ETH already on an ETH-gas destination (null
   *  when ETH couldn't be priced or the destination's native token isn't
   *  ETH) — what a buy of ETH names beside the move, so a re-ask after a
   *  move sees the ETH that landed. */
  destEthUsd?: number | null
  /** Origins the plan may spend — stables first (dollar-parity legs), then
   *  movable ETH; richest first within each group. */
  origins: FundingOrigin[]
  /** Origins holding money the wallet CANNOT move — USDC with no ETH there
   *  for the approve + bridge pair, or ETH under its own keep-back.
   *  Dropping these silently made the product claim "no USDC anywhere"
   *  while $12 sat on Arbitrum (live 2026-07-21) — the user had just
   *  bridged it in and burned their last origin gas doing so. Money the
   *  user owns is never invisible; it's named, with the fix. */
  gaslessOrigins: FundingOrigin[]
  /** Every origin that scanned cleanly, any balance — a chain with ETH but
   *  no USDC still matters (it can donate gas to a stranded sibling). */
  allScanned: FundingOrigin[]
  /** Origin chain words whose reads failed — "unknown", NEVER "empty": a
   *  partial scan must not turn into a confident "you have nothing there". */
  failedOrigins: string[]
}

/** The balance reads that decide whether a Robinhood Chain buy needs the
 *  funding plan: USDG + native ETH there, then USDC, USDC.e, and movable
 *  ETH (and gas-to-sign) on every funding origin — Base, Ethereum, and
 *  Arbitrum, not just Base (live 2026-07-17: $15 of Ethereum USDC was
 *  invisible and a $5 buy hit a wall; 2026-07-28: ETH-only wallets — the
 *  most common stranger state — were refused with "no USDC anywhere").
 *  Throws only when the ROBINHOOD reads fail — those decide the whole
 *  plan; a failed origin lands in failedOrigins instead. */
export async function readFundingShortfall(user: string, destChainId: number = ROBINHOOD_CHAIN_ID): Promise<FundingShortfall> {
  const from = user as `0x${string}`
  const destRec = lifiDestination(destChainId)
  if (!destRec) throw new Error(`chain ${destChainId} is not a LiFi funding destination`)
  const rh = publicClientFor(destChainId)
  if (!rh) throw new Error('missing RPC client')
  const usdg = primaryStable(destChainId)!
  // ETH price for the ETH rows — fail-soft: unpriceable ETH just means no
  // ETH rows this scan (the USDC rows are untouched), never a thrown plan.
  const [usdgAtoms, nativeWei, ethUsd] = await Promise.all([
    rh.readContract({ address: usdg.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] }),
    rh.getBalance({ address: from }),
    usdPerToken(8453, 'ETH')
      .then((p) => p?.usd ?? null)
      .catch(() => null),
  ])
  const allScanned: FundingOrigin[] = []
  const failedOrigins: string[] = []
  await Promise.all(
    FUNDING_ORIGIN_CHAINS.map(async (chainId) => {
      const word = FUNDING_ORIGIN_WORD[chainId]
      const client = publicClientFor(chainId)
      const usdc = chainById(chainId)?.tokens.USDC
      if (!client || !usdc) return
      const alt = fundingAltUsdcFor(chainId)
      try {
        const [usdcAtoms, altAtoms, gasWei] = await Promise.all([
          client.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] }),
          alt ? client.readContract({ address: alt.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] }) : Promise.resolve(BigInt(0)),
          client.getBalance({ address: from }),
        ])
        const gasEth = Number(formatEther(gasWei))
        const usd = Math.floor(Number(usdcAtoms) / 10 ** usdc.decimals)
        allScanned.push({ chainId, word, token: 'USDC', usd, gasEth })
        // Bridged-variant row only when it actually holds money — the USDC
        // row above already carries the chain's donor-gas signal.
        const altUsd = alt ? Math.floor(Number(altAtoms) / 10 ** alt.decimals) : 0
        if (alt && altUsd > 0) allScanned.push({ chainId, word, token: alt.symbol, usd: altUsd, gasEth })
        // ETH as buying power: movable = balance minus the keep-back that
        // keeps the wallet signable after the leg. Real ETH under the floor
        // becomes a NAMED row (spendable: false) — refusals must say it,
        // chips must never spend it.
        if (ethUsd) {
          const movableUsd = Math.floor((gasEth - (ORIGIN_ETH_KEEPBACK[chainId] ?? 0.002)) * ethUsd)
          if (movableUsd > 0) allScanned.push({ chainId, word, token: 'ETH', usd: movableUsd, gasEth, spendable: true })
          else if (Math.floor(gasEth * ethUsd) >= 1) allScanned.push({ chainId, word, token: 'ETH', usd: Math.floor(gasEth * ethUsd), gasEth, spendable: false })
        }
      } catch {
        failedOrigins.push(word)
      }
    }),
  )
  // Stables lead (dollar-parity legs, no spread), ETH follows; richest
  // first within each group. The chip planner picks the FIRST origin that
  // covers, so a $3 USDC row never forces a combine past a $500 ETH row.
  allScanned.sort((a, b) => (a.token === 'ETH' ? 1 : 0) - (b.token === 'ETH' ? 1 : 0) || b.usd - a.usd)
  const signable = (o: FundingOrigin) => o.gasEth >= (ORIGIN_MIN_GAS_ETH[o.chainId] ?? 0.002)
  const movable = (o: FundingOrigin) => (o.token === 'ETH' ? o.spendable === true : signable(o))
  return {
    usdgAtoms,
    // A stable-gas destination (Arc) never needs a gas leg: the landed
    // stable IS the gas. Its native read is the same money as usdgAtoms.
    hasGas: destRec.gasLeg ? nativeWei >= RH_GAS_FLOOR_WEI : true,
    destEthUsd: destRec.gasLeg && ethUsd ? Math.floor(Number(formatEther(nativeWei)) * ethUsd) : null,
    origins: allScanned.filter((o) => o.usd > 0 && movable(o)),
    gaslessOrigins: allScanned.filter((o) => o.usd > 0 && !movable(o)),
    allScanned,
    failedOrigins,
  }
}

// ── Chip planner (pure — the resume strings ARE the contract) ──────────────

export interface RobinhoodFundingChip {
  label: string
  resume: string
}

/** One funding-ask segment: lib/jobs.ts parseRobinhoodFunding's grammar.
 *  A non-USDC token rides the "using usdc.e" clause (before "including gas"). */
const fundSegment = (usd: number, word: string, gas: boolean, token = 'USDC', dest?: LifiDestination) => destFundSegment(usd, word, gas, token, dest)

/** The gas leg on its own: lib/jobs.ts parseRobinhoodGasFunding's grammar.
 *  Robinhood Chain only — Arc has no separate gas leg. */
const gasSegment = (word: string, token = 'USDC') =>
  `Fund robinhood chain gas from ${word.toLowerCase()}${token === 'USDC' ? '' : ` using ${token.toLowerCase()}`}`

/** An ETH move: lib/jobs.ts parseRobinhoodEthMove's grammar. */
const moveSegment = (usd: number, word: string) => `Move $${usd} of ETH from ${word.toLowerCase()} to robinhood chain`

/**
 * Is this origin row the token the follow-up BUYS? A holding of it is what
 * the buy ends with, so it never funds the buy's VALUE leg: "Buy $10 of ETH
 * on robinhood chain" from an ETH-only wallet planned "Fund robinhood chain
 * with $12.5 from base using eth including gas, then buy $10 of ETH", which
 * is ETH → USDG → ETH, two conversions and two fees to land the asset it
 * started from (2026-09-16). The rule is per leg: the gas leg is spent on
 * gas, never bought back, so ETH may still pay it.
 *
 * Exact symbols, like lib/funding-plan's isBuyToken (the generic planner's
 * side of the same rule): the scan's ETH is native and there is no wrap
 * builder, so converting through the stable is the only way ETH becomes
 * WETH, and a WETH buy may spend it.
 */
export const buysOrigin = (buyToken: string | undefined, o: { token: string }): boolean =>
  !!buyToken && o.token.trim().toUpperCase() === buyToken.trim().toUpperCase()

/**
 * Turn a multi-origin scan into chips. `followup` is appended to every
 * resume (", then buy $5 of NVDA"); empty = bridge-only (the MCP-path
 * fallback — the user re-asks once funds land). Ranking: origins arrive
 * richest first; the richest covering origin leads, another covering
 * origin gets an "instead" chip, and when NO single origin covers but
 * several combined do, one chip carries a fund segment per origin (gas on
 * the first leg only). Returns null when the whole wallet can't cover it.
 *
 * `buyToken` names what the follow-up buys: a row of that token never funds
 * the value leg (buysOrigin). It can still pay the gas leg, as its own
 * segment ahead of a value leg from another origin.
 */
export function planRobinhoodFundingChips(params: {
  origins: FundingOrigin[]
  needUsd: number
  gasIncluded: boolean
  followup: string
  /** The chain the legs land on — Robinhood Chain when omitted (every
   *  pre-existing caller); Arc's chips read "Fund arc with …". */
  dest?: LifiDestination
  buyToken?: string
}): RobinhoodFundingChip[] | null {
  const { needUsd, gasIncluded, followup, dest, buyToken } = params
  const origins = params.origins.filter((o) => !buysOrigin(buyToken, o))
  const withFollowup = (segs: string[]) => (followup ? `${segs.join(', then ')}, then ${followup}` : segs.join(', then '))
  const chips: RobinhoodFundingChip[] = []
  // The FIRST covering origin leads — origins arrive stables-first, so a
  // dust USDC row never forces a combine past an ETH balance that covers
  // the whole plan on its own. "Covers" means the origin's PROMISABLE
  // capacity (originCapUsd), not its raw row — an ETH row spending its
  // whole movable balance across two legs was a mid-job wall.
  // Nothing below the parity floor is offerable at all — a sub-minimum leg
  // is a chip that compiles into a job and dies on step 1 (live 2026-09-03).
  if (!fillableLeg(needUsd, gasIncluded)) return null
  const best = origins.find((o) => originCapUsd(o, gasIncluded) >= needUsd)
  if (best) {
    const bestCap = originCapUsd(best, gasIncluded)
    // At the floor the plan is bigger than the ask, so "just enough" would
    // be the wrong words for the right number — name it for what it is.
    const atFloor = valueLegUsd(needUsd, gasIncluded) <= MIN_VALUE_LEG_USD
    chips.push({
      label: `${atFloor ? 'Smallest clean move' : 'Just enough'} (~$${needUsd} from ${originLabel(best)})`,
      resume: withFollowup([fundSegment(needUsd, best.word, gasIncluded, best.token, dest)]),
    })
    // Half/all only when they're sensible whole-balance moves — a $15k
    // balance covering a $7 need doesn't get a $7.5k chip (same 10× rule
    // as lib/funding-plan's all-in cap). "All" is the full PROMISABLE
    // capacity, never the raw ETH row.
    const sensible = best.usd <= needUsd * 10
    const half = Math.floor(bestCap / 2)
    if (sensible && half > needUsd && fillableLeg(half, gasIncluded)) chips.push({ label: `Half my ${best.word} ${best.token} ($${half})`, resume: withFollowup([fundSegment(half, best.word, gasIncluded, best.token, dest)]) })
    if (sensible && bestCap > needUsd && fillableLeg(bestCap, gasIncluded)) chips.push({ label: `All my ${best.word} ${best.token} ($${bestCap})`, resume: withFollowup([fundSegment(bestCap, best.word, gasIncluded, best.token, dest)]) })
    const alt = origins.find((o) => o !== best && originCapUsd(o, gasIncluded) >= needUsd)
    if (alt) chips.push({ label: `Use ${originLabel(alt)} instead (~$${needUsd})`, resume: withFollowup([fundSegment(needUsd, alt.word, gasIncluded, alt.token, dest)]) })
    return chips.slice(0, 4)
  }
  // The bought token pays the gas leg alone and another origin pays the
  // value: "$11 of Arbitrum USDC + ETH on Base" buying $10 of ETH is $2 short
  // of a USDC plan that carries its own gas, and exactly covered when the
  // ETH buys the gas. The gas payer's row must cover the leg by itself (a
  // single leg, so no two-leg headroom); L2 rows sign cheaper than mainnet.
  if (gasIncluded && (dest?.gasLeg ?? true)) {
    const valueUsd = valueLegUsd(needUsd, true)
    const payer = params.origins
      .filter((o) => buysOrigin(buyToken, o) && o.usd >= GAS_LEG_USD)
      .sort((a, b) => Number(a.chainId === 1) - Number(b.chainId === 1) || b.usd - a.usd)[0]
    const value = payer ? origins.find((o) => originCapUsd(o, false) >= valueUsd) : undefined
    if (payer && value) {
      chips.push({
        label: `Just enough (~$${valueUsd} from ${originLabel(value)}, gas from ${payer.word} ${payer.token})`,
        resume: withFollowup([gasSegment(payer.word, payer.token), fundSegment(valueUsd, value.word, false, value.token, dest)]),
      })
      return chips
    }
  }
  // No single origin covers it — combine legs richest-first. The first leg
  // carries the gas segment and must be worth more than the gas leg alone;
  // sub-$2 origins are dust for a bridge. Each origin contributes at most
  // its promisable capacity (the gas-bearing first leg is the two-leg one).
  const usable = origins.filter((o) => o.usd >= 2)
  const total = usable.reduce((a, o) => a + originCapUsd(o, gasIncluded && o === usable[0]), 0)
  if (usable.length >= 2 && total >= needUsd) {
    const segs: string[] = []
    const words: string[] = []
    let remaining = needUsd
    for (const o of usable) {
      if (remaining <= 0) break
      const first = segs.length === 0
      const take = Math.min(originCapUsd(o, first && gasIncluded), remaining)
      if (first && gasIncluded && take <= GAS_LEG_USD + 1) continue
      if (take <= 0) continue
      // Each leg pays the flat bridge cost SEPARATELY, so each must clear
      // the parity floor on its own — splitting a fillable total into two
      // unfillable halves is the same dead offer, twice.
      if (!fillableLeg(take, first && gasIncluded)) return null
      segs.push(fundSegment(take, o.word, first && gasIncluded, o.token, dest))
      words.push(originLabel(o))
      remaining = Number((remaining - take).toFixed(2))
    }
    if (remaining <= 0 && segs.length >= 2) {
      chips.push({ label: `Combine ${words.join(' + ')} (~$${needUsd})`, resume: withFollowup(segs) })
      return chips
    }
  }
  return null
}

// ── Advice planner (pure) — the single voice for "the wallet is short" ─────
//
// Both refusal sites (the swap layer's unfunded Robinhood buy and the
// MCP-failure funding fallback) route their scan through here so the answer
// is the same everywhere: chips when the signable USDC covers it, a gas
// rescue when the money EXISTS but can't sign (live 2026-07-21: $12 of
// freshly-bridged Arbitrum USDC was reported as "none on Base, Ethereum, or
// Arbitrum" because the wallet's last origin gas went into the bridge
// signatures — the user then got a planner-invented NEAR Intents plan to a
// chain NEAR can't reach), and an honest per-chain accounting otherwise.

/** ETH moved to a gas-stranded origin so its USDC becomes signable — big
 *  enough to clear NEAR Intents minimums and leave real signing headroom on
 *  any origin, small enough to be a rounding error next to the buy. The
 *  string IS the cross-chain job segment amount (lib/cross-chain-swap.ts
 *  grammar: "swap 0.001 ETH from base to arbitrum"). */
export const GAS_TOPUP_ETH = '0.001'

/** The smallest ETH move the planner offers: the size the gas leg already
 *  proves fills. LiFi quoted $1 moves from every origin on 2026-09-16, but a
 *  route minimum that drifted once (GAS_LEG_LADDER_USD) can drift again. */
export const ETH_MOVE_MIN_USD = GAS_LEG_USD

export interface RobinhoodEthMove {
  /** ONE action chip plus the decline chip. */
  chips: RobinhoodFundingChip[]
  legs: { origin: FundingOrigin; usd: number }[]
  /** The dollars of ETH the move carries (at least ETH_MOVE_MIN_USD). */
  moveUsd: number
}

/**
 * A buy of ETH on Robinhood Chain from a wallet whose only money is ETH on
 * the funding origins. With the bought token out of the value leg
 * (buysOrigin) nothing is left to fund the buy, and every plan the old
 * planner drew sold that ETH for USDG to buy ETH back. The honest offer is
 * the ETH itself, carried over as ETH: one LiFi leg per origin, native ETH
 * in and native ETH out through the same pinned diamond as every funding
 * leg (probed 2026-09-16 from Base, Arbitrum, Optimism and Ethereum: 1–3s,
 * 96.8–99.7% of the dollars delivered even at $1). It lands the same native
 * ETH the buy would (a v3 ETH buy unwraps, website#801), and that ETH is
 * Robinhood Chain's gas too, so no gas leg rides along. The canonical bridge
 * reaches Robinhood Chain from Ethereum only and takes minutes, so it isn't
 * the move's lane. lib/funding-plan planBuyTokenMove is the generic
 * planner's twin (NEAR Intents there; 1Click can't deliver to 4663).
 *
 * Sized to the dollars of the buy the wallet can't already cover there
 * (`shortUsd`), with no margin: nothing runs after the move, so no follow-up
 * needs a fee buffer. One covering origin → one segment (L2 rows first, their
 * signatures cost cents); no single covering origin → one segment per origin,
 * richest first, which compiles as a job.
 *
 * Null unless the buy is ETH itself (a WETH buy may spend the ETH, see
 * buysOrigin, and a move lands native ETH) and no other row could fund a value leg: a USDC row
 * at or above the parity floor buys the ETH instead, so a move beside it
 * would be an answer to a question nobody asked. Robinhood Chain only — Arc's
 * native token is USDC.
 */
export function planRobinhoodEthMove(params: {
  scan: Pick<FundingShortfall, 'origins' | 'gaslessOrigins'>
  buyToken: string | undefined
  shortUsd: number
}): RobinhoodEthMove | null {
  const { scan, buyToken, shortUsd } = params
  if (buyToken?.trim().toUpperCase() !== 'ETH' || !(shortUsd > 0)) return null
  const held = [...scan.origins, ...scan.gaslessOrigins]
  if (held.some((o) => !buysOrigin(buyToken, o) && o.usd >= MIN_VALUE_LEG_USD)) return null
  const moveUsd = Math.max(ETH_MOVE_MIN_USD, Number(shortUsd.toFixed(2)))
  const movable = scan.origins
    .filter((o) => o.token === 'ETH' && o.spendable !== false && o.usd >= ETH_MOVE_MIN_USD)
    .sort((a, b) => Number(a.chainId === 1) - Number(b.chainId === 1) || b.usd - a.usd)
  const legs: RobinhoodEthMove['legs'] = []
  const single = movable.find((o) => o.usd >= moveUsd)
  if (single) {
    legs.push({ origin: single, usd: moveUsd })
  } else {
    // Richest first, every leg at least the move minimum (the last one may
    // carry a little more than the remainder — it lands in the user's own
    // wallet either way).
    let covered = 0
    for (const o of [...movable].sort((a, b) => b.usd - a.usd)) {
      const usd = Math.min(o.usd, Math.max(Number((moveUsd - covered).toFixed(2)), ETH_MOVE_MIN_USD))
      legs.push({ origin: o, usd })
      covered = Number((covered + usd).toFixed(2))
      if (covered >= moveUsd) break
    }
    if (covered < moveUsd) return null
  }
  return {
    chips: [
      {
        label: single ? `Move ~$${moveUsd} of my ETH from ${single.word} to Robinhood Chain` : `Move ~$${moveUsd} of my ETH to Robinhood Chain (${legs.length} legs)`,
        resume: legs.map((l) => moveSegment(l.usd, l.origin.word)).join(', then '),
      },
      { label: 'Not now', resume: 'Never mind — leave my funds where they are.' },
    ],
    legs,
    moveUsd,
  }
}

/** One scanned row as the copy names it, with what the row can't do said out
 *  loud. Money the user owns is never invisible, least of all the token the
 *  buy is for. */
const heldRowWords = (o: FundingOrigin, gasless: boolean, buyToken: string | undefined) =>
  `~$${o.usd} of ${o.token} on ${o.word}${
    gasless
      ? o.token === 'ETH'
        ? ' (under what a move from there costs)'
        : ' (no ETH there to sign with)'
      : buysOrigin(buyToken, o)
        ? ` (not counted: ${buyToken!.trim().toUpperCase()} is what this buy gets you)`
        : ''
  }`

export type RobinhoodFundingAdvice =
  /** Signable USDC covers the plan — offer the chips. */
  | { kind: 'chips'; chips: RobinhoodFundingChip[] }
  /** The money is there but its chain can't sign (no ETH). `chips` carries a
   *  donor-funded topup job when another origin can send gas; null = the
   *  user must top up ETH themselves and `copy` says exactly where/how much. */
  | { kind: 'gas-stranded'; stranded: FundingOrigin; donor: FundingOrigin | null; chips: RobinhoodFundingChip[] | null; copy: string }
  /** A buy of ETH whose wallet holds nothing but ETH: the ETH moves over as
   *  ETH (planRobinhoodEthMove). `copy` names every row and says the move
   *  isn't a buy. */
  | ({ kind: 'move'; copy: string } & RobinhoodEthMove)
  /** Nothing covers it — `copy` is the honest per-chain accounting. */
  | { kind: 'none'; copy: string }

export function planRobinhoodFundingAdvice(params: {
  scan: Pick<FundingShortfall, 'origins' | 'gaslessOrigins' | 'allScanned' | 'failedOrigins'>
  needUsd: number
  gasIncluded: boolean
  /** Appended to chip resumes (empty = bridge-only, user re-asks after). */
  followup: string
  /** Destination — Robinhood Chain when omitted. */
  dest?: LifiDestination
  /** What the follow-up buys (buysOrigin): never spent on the value leg. */
  buyToken?: string
  /** Dollars of the buy not already covered at the destination — sizes the
   *  ETH move. No move without it. */
  buyShortUsd?: number
}): RobinhoodFundingAdvice {
  const { scan, needUsd, gasIncluded, followup, buyToken } = params
  const dest = params.dest ?? LIFI_DESTINATIONS[ROBINHOOD_CHAIN_ID]
  const chips = planRobinhoodFundingChips({ origins: scan.origins, needUsd, gasIncluded, followup, dest, buyToken })
  if (chips) return { kind: 'chips', chips }

  // Gas-stranded rescue: the richest gasless STABLE origin covering the
  // need. ETH rows never land here — sub-keep-back ETH IS the (missing)
  // gas, so "send gas to unstick it" would be nonsense advice. Nor does the
  // token the buy is for: unsticking it to sell it and buy it back is the
  // round trip. The donor below may be any chain, ETH-only ones included:
  // the topup is gas, and ETH still pays gas.
  const stranded = scan.gaslessOrigins.find((o) => o.token !== 'ETH' && !buysOrigin(buyToken, o) && o.usd >= needUsd) ?? null
  if (stranded) {
    // A donor origin can sign there AND part with the topup: its own signing
    // floor, the leg itself, and 50% headroom so the donation never leaves
    // the donor stranded in turn.
    const topup = Number(GAS_TOPUP_ETH)
    const donor =
      scan.allScanned.find(
        (o) => o.chainId !== stranded.chainId && o.gasEth >= (ORIGIN_MIN_GAS_ETH[o.chainId] ?? 0.002) + topup * 1.5,
      ) ?? null
    const strandedLc = stranded.word.toLowerCase()
    if (donor) {
      const segs = [
        `swap ${GAS_TOPUP_ETH} ETH from ${donor.word.toLowerCase()} to ${strandedLc}`,
        fundSegment(needUsd, stranded.word, gasIncluded, stranded.token, dest),
      ]
      const resume = followup ? `${segs.join(', then ')}, then ${followup}` : segs.join(', then ')
      return {
        kind: 'gas-stranded',
        stranded,
        donor,
        chips: [
          { label: `Send gas to ${stranded.word} + use its $${stranded.usd}`, resume },
          { label: 'Not now', resume: 'Never mind — leave my funds where they are.' },
        ],
        copy:
          `your ~$${stranded.usd} of ${stranded.token} is already on **${stranded.word}** — the wallet just has no ETH there to pay for the two tiny signatures the bridge needs. ` +
          `I can fix that from ${donor.word}: move ~${GAS_TOPUP_ETH} ETH over first, then convert the ${stranded.word} ${stranded.token}${gasIncluded ? ` (gas for ${dest.name} included)` : ''} — one job, each step built and checked when it's your turn to sign.`,
      }
    }
    return {
      kind: 'gas-stranded',
      stranded,
      donor: null,
      chips: null,
      copy:
        `you're holding ~$${stranded.usd} of ${stranded.token} on **${stranded.word}** — enough for this — but the wallet has no ETH on ${stranded.word} to pay for the two tiny signatures the bridge needs (about a dollar's worth is plenty). ` +
        `Send a little ETH to your address on ${stranded.word} from an exchange or another wallet, then ask again — I'll build the whole path from there.`,
    }
  }

  const held = [...scan.origins, ...scan.gaslessOrigins].sort((a, b) => b.usd - a.usd)
  const move = dest.key === 'robinhood' && params.buyShortUsd !== undefined ? planRobinhoodEthMove({ scan, buyToken, shortUsd: params.buyShortUsd }) : null
  if (move) {
    const eth = held.filter((o) => buysOrigin(buyToken, o))
    const others = held.filter((o) => !buysOrigin(buyToken, o))
    const moves = move.legs.length === 1 ? 'one move brings' : `${move.legs.length} moves bring`
    return {
      kind: 'move',
      ...move,
      copy:
        `**You already hold ETH**: ${eth.map((o) => heldRowWords(o, scan.gaslessOrigins.includes(o), undefined)).join(', ')}` +
        (others.length > 0
          ? `, plus ${others.map((o) => (scan.gaslessOrigins.includes(o) ? heldRowWords(o, true, undefined) : `${heldRowWords(o, false, undefined)} (too little to bridge on its own)`)).join(', ')}`
          : '') +
        `. ETH is what this buy gets you, so I won't sell it for USDG just to buy it back: that's two conversions and two fees to end with the ETH you started with. ` +
        `If you want ~$${move.moveUsd} of it on Robinhood Chain, ${moves} it over (LiFi-routed, a few seconds, to your own address), and ETH is Robinhood Chain's gas, so nothing else has to land. ` +
        `That moves ETH you already own; it doesn't buy more.`,
    }
  }

  // Nothing covers it — say exactly what was seen, per chain, including
  // money that exists but can't sign, the token the buy is for (named, never
  // counted), and chains that couldn't be read.
  const parts: string[] = []
  if (held.length > 0) parts.push(held.map((o) => heldRowWords(o, scan.gaslessOrigins.includes(o), buyToken)).join(', '))
  // Derived, never hardcoded: this sentence names every chain we actually
  // looked at, so widening FUNDING_ORIGIN_CHAINS can't leave it claiming we
  // checked three places when we checked four.
  else parts.push(`no USDC or ETH on ${listWords(FUNDING_ORIGIN_CHAINS.map((c) => FUNDING_ORIGIN_WORD[c]))}`)
  if (scan.failedOrigins.length > 0) parts.push(`couldn't check ${scan.failedOrigins.join(' or ')}`)
  return { kind: 'none', copy: parts.join('; ') }
}

// ── Near-miss downsize (pure) — the rescue between chips and the wall ──────

export interface DownsizedRobinhoodBuy {
  /** The largest buy the wallet CAN fund (whole cents). */
  buyUsd: number
  /** ONE action chip (the caller appends its own decline chip). */
  chips: RobinhoodFundingChip[]
  /** The ~$ the chip's plan moves — for the reply copy. */
  needUsd: number
}

/**
 * When the 'none' outcome is a NEAR miss, offer the buy the wallet can
 * actually fund instead of a wall: "Buy $12 of AAPL" against $12 of movable
 * USDC misses the ~$12.5 margined plan by cents, and the honest per-chain
 * accounting — correct as it is — converts nobody (live 2026-07-27: that
 * exact wallet retried the flagship ask three times and left). The chip's
 * resume rides the normal chip planner, so it stays a compiling contract.
 * Null when the wallet can't fund a meaningful fraction of the ask (a $1.20
 * counter-offer to a $100 ask is noise, not a rescue) — the caller falls
 * back to the honest refusal.
 */
export function planDownsizedRobinhoodBuy(params: {
  /** Destination — Robinhood Chain when omitted. */
  dest?: LifiDestination
  scan: Pick<FundingShortfall, 'origins'>
  /** The asked size (USDG dollars). */
  buyUsd: number
  /** USDG already held on Robinhood Chain — part of what the buy spends. */
  holdingUsd: number
  includeGas: boolean
  /** Woven into the follow-up segment; ignored when acquiring. */
  buySym: string
  /** Acquisition = the landing funds ARE the outcome (no follow-up buy). */
  acquiring: boolean
}): DownsizedRobinhoodBuy | null {
  const { scan, buyUsd, holdingUsd, includeGas, buySym, acquiring } = params
  // A smaller buy of ETH is still a buy of ETH: the ETH rows never fund it
  // (buysOrigin), so they never size it either.
  const buyToken = acquiring ? undefined : buySym
  const origins = scan.origins.filter((o) => !buysOrigin(buyToken, o))
  // Capacity: the richest single origin, or combined non-dust origins when
  // no single one leads (mirrors planRobinhoodFundingChips' two shapes).
  // Origins count at their PROMISABLE capacity (originCapUsd) — sizing the
  // max buy off an ETH row's raw movable balance offered a plan whose
  // second leg couldn't clear leg 1's own fee (live 2026-07-28).
  const usable = origins.filter((o) => o.usd >= 2)
  const combined = usable.length >= 2 ? usable.reduce((a, o) => a + originCapUsd(o, includeGas && o === usable[0]), 0) : 0
  const capUsd = Math.max(...origins.map((o) => originCapUsd(o, includeGas)), combined, 0)
  // The bought token can still pay the gas leg (the chip planner's
  // gas-payer shape), and then one origin's whole row is value.
  const gasPaidByBuyToken = includeGas && scan.origins.some((o) => buysOrigin(buyToken, o) && o.usd >= GAS_LEG_USD)
  const valueOnlyCapUsd = gasPaidByBuyToken ? Math.max(...origins.map((o) => originCapUsd(o, false)), 0) : 0
  if (capUsd <= 0 && valueOnlyCapUsd <= 0) return null
  const gasLeg = includeGas ? GAS_LEG_USD : 0
  // Invert fundingNeedUsd, then floor to a clean quarter-dollar label.
  const margin = 1 + FUNDING_MARGIN_BPS / 10_000
  const maxRaw = holdingUsd + Math.max((capUsd - gasLeg) / margin, valueOnlyCapUsd / margin)
  let max = Math.floor(maxRaw * 4) / 4
  // Only a genuine downsize, and only a meaningful one: at least a tenth of
  // what was asked, and never under the size at which fundingNeedUsd starts
  // flooring — a "$3 instead" counter-offer whose plan bridges $9 reads as
  // arithmetic nobody asked for. Under that, the honest refusal (which
  // NAMES the flat cost) is the better answer.
  if (!(max < buyUsd) || max < Math.max(MIN_UNFLOORED_BUY_USD, buyUsd * 0.1)) return null
  // fundingNeedUsd rounds UP to $0.50 — the floored candidate can still
  // overshoot the cap by a rounding step, so verify against the real chip
  // planner and step down (bounded) until it fits.
  for (let i = 0; i < 8 && max >= 1; i++, max = Number((max - 0.25).toFixed(2))) {
    const needUsd = robinhoodBuyNeedUsd(max, holdingUsd, includeGas)
    const chips = planRobinhoodFundingChips({
      origins: scan.origins,
      needUsd,
      gasIncluded: includeGas,
      followup: acquiring ? '' : `buy $${max} of ${buySym}`,
      dest: params.dest,
      buyToken,
    })
    if (!chips) continue
    // Lead with the downsize; keep the planner label's "(~$N from X)" tail.
    const via = chips[0].label.match(/\(([^)]+)\)\s*$/)?.[1] ?? `~$${needUsd}`
    return {
      buyUsd: max,
      needUsd,
      chips: [{ label: acquiring ? `Land $${max} of it instead (${via})` : `Buy $${max} of ${buySym} instead (${via})`, resume: chips[0].resume }],
    }
  }
  return null
}

// ── Unfunded-buy continuity (workingContext.pending) ───────────────────────
//
// Every funding refusal/offer leaves the buy pending so the NEXT typed
// message can resolve against it deterministically. Without this, "I have
// $10 USDC on arbitrum" after a refusal fell to the planner, which invented
// a NEAR Intents bridge to Robinhood Chain — a chain NEAR Intents can't
// reach — and asked the user to say "yes" to a plan that could never build
// (live 2026-07-21).

/** The pending payload a funding refusal/offer attaches to its response.
 *  `inflight` forwards a just-built cross-chain deposit's facts (lib/
 *  inflight-funding.ts inflightPendingData) so the "check again" turn still
 *  knows a transfer is settling — writing this pending REPLACES the xchain
 *  pending that carried them, and without the forward the awareness dies
 *  after one turn. */
export function rhFundingPending(buyUsd: number, buySym: string, inflight?: Record<string, string>, dest: LifiDestination = LIFI_DESTINATIONS[ROBINHOOD_CHAIN_ID]) {
  return {
    kind: 'rh-funding',
    summary: `Unfunded buy on ${dest.name}: $${buyUsd} of ${buySym} — waiting for USDC${dest.gasLeg ? ' or gas' : ''} to land`,
    // `dest` rides only for a non-default destination so every pre-existing
    // Robinhood pending stays byte-identical (and under the key cap).
    data: { buyUsd: String(buyUsd), buySym, ...(dest.chainId !== ROBINHOOD_CHAIN_ID ? { dest: String(dest.chainId) } : {}), ...(inflight ?? {}) },
  }
}

export type RhFundingFollowUp = { kind: 'recheck' } | { kind: 'cancel' }

/**
 * Does this message continue a pending unfunded buy? Conservative on
 * purpose — only two shapes claim the turn:
 *   · a holdings/top-up assertion ("I have $10 USDC on arbitrum", "just
 *     sent the ETH", "topped up gas on base") — a have/sent verb PLUS a
 *     funding noun or origin chain word;
 *   · an explicit re-check ("check again", "rescan", "done", "ready").
 * Questions never match (a "what do I have on arbitrum?" is a portfolio
 * ask, not a funding follow-up), and anything else falls through to the
 * normal ladder untouched.
 */
export function parseRhFundingFollowUp(message: string): RhFundingFollowUp | null {
  const m = message.trim()
  if (!m || m.length > 120) return null
  if (/\?\s*$/.test(m) || /^(what|which|how|why|where|who|when|do|does|did|can|could|would|should|is|are)\b/i.test(m)) return null
  if (/\b(never\s*mind|cancel|forget\s+it|leave\s+(?:it|my))\b/i.test(m)) return { kind: 'cancel' }
  if (/\b(?:check|scan|look|try)\s+again\b|\bre-?(?:check|scan)\b|^\s*(?:done|ready|ok(?:ay)?|it'?s\s+(?:there|landed|settled))\s*[.!]*$/i.test(m)) {
    return { kind: 'recheck' }
  }
  const assertVerb = /\b(?:i|we)(?:'ve)?\s+(?:now\s+|just\s+|already\s+|do\s+)?(?:have|hold|got)\b|\b(?:just\s+)?(?:sent|moved|bridged|deposited|funded|added|topped\s*(?:up|off))\b/i
  const fundingNoun = /\b(usdc|usdg|eth|gas|funds?|money)\b/i
  const originWord = new RegExp(String.raw`\b(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism', 'robinhood'])})\b`, 'i')
  if (assertVerb.test(m) && (fundingNoun.test(m) || originWord.test(m))) return { kind: 'recheck' }
  return null
}

// ── Off-chain source inference (pure) ──────────────────────────────────────

/** The token symbols readFundingShortfall can actually SOURCE from an origin
 *  chain — derived from what it reads, never a hand-typed list, so a symbol
 *  named here is one the chips can really spend. USDT/DAI are deliberately
 *  absent: the scan doesn't read them, and promising money we can't see is
 *  the same lie as denying money we can. */
export function fundingSourceSymbols(): string[] {
  const out = new Set<string>(['ETH'])
  for (const chainId of FUNDING_ORIGIN_CHAINS) {
    if (chainById(chainId)?.tokens.USDC) out.add('USDC')
    const alt = fundingAltUsdcFor(chainId)
    if (alt) out.add(alt.symbol.toUpperCase())
  }
  return [...out]
}

/** Origin symbols that are a $1 unit — their named amount IS its dollar
 *  value, so the ask can be restated in the destination's own stable
 *  without a price probe. ETH is a funding source but not a parity one. */
function parityFundingSymbol(symbol: string): string | null {
  const sym = symbol.trim().toUpperCase()
  return fundingSourceSymbols().includes(sym) && sym !== 'ETH' ? sym : null
}

export interface OffChainStableSource {
  /** What the user named as the spend side ("USDC"). */
  sourceSymbol: string
  /** The destination chain's own $1 unit, which the plan spends instead. */
  stableSymbol: string
  /** The dollars the named amount is worth (parity, so no price probe). */
  usd: number
}

/**
 * "Convert 1 USDC to 1 USDG on robinhood" (live 2026-09-03) answered
 * *"I don't know the token USDC on Robinhood Chain"* — true, and useless:
 * USDC is the exact token the funding plan below bridges FROM, and that
 * wallet was holding it on Base. A spend token that doesn't exist on the
 * destination but IS a dollar-parity funding source isn't an unknown
 * token — it's the ask naming its own origin, one chain over.
 *
 * Restate it in the destination's $1 unit ("$1 of USDG on Robinhood Chain")
 * and the existing funding plan owns the turn: it scans Base, Ethereum and
 * Arbitrum for that USDC, ranks the origins, adds a gas leg ONLY when the
 * destination wallet can't already pay Orbit gas, and compiles the pick
 * into a job the user signs step by step.
 *
 * Null when the symbol isn't sourceable, the destination has no stable of
 * its own, the ask is a limit order (no funding plan behind those), or no
 * dollar amount was named — every one of those falls through to the honest
 * unknown-token refusal rather than guessing.
 */
export function offChainStableSource(params: {
  chainId: number
  sellSymbol: string | undefined
  /** True when the destination chain already knows the symbol — then it is
   *  a normal same-chain sell and this gate must not claim it. */
  knownOnChain: boolean
  amountHuman?: string
  amountUsd?: string
}): OffChainStableSource | null {
  const { chainId, sellSymbol, knownOnChain, amountHuman, amountUsd } = params
  // Only a LiFi-funded destination (Robinhood Chain, Arc — lib/lifi-
  // destinations, each route live-probed) lands the plan. Widening the set
  // without a probed route would offer a path that can't build.
  if (!isLifiFundedChain(chainId) || knownOnChain || !sellSymbol) return null
  const stable = primaryStable(chainId)
  if (!stable) return null
  const sourceSymbol = parityFundingSymbol(sellSymbol)
  if (!sourceSymbol || sourceSymbol === stable.symbol.toUpperCase()) return null
  const usd = Number(amountUsd ?? amountHuman)
  if (!Number.isFinite(usd) || usd <= 0) return null
  return { sourceSymbol, stableSymbol: stable.symbol, usd: Number(usd.toFixed(2)) }
}
