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
//  Two funding legs, each its own guarded approve→bridge chain the USER
//  signs on the origin chain:
//    · gas  — origin USDC → native ETH on Robinhood Chain (a few dollars,
//             enough gas for many Orbit-chain transactions)
//    · usdg — origin USDC → USDG on Robinhood Chain (the money that buys
//             the stock)
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
//  No Yeetful fee on funding legs — the fee lives on the swap that follows
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
import { fetchLifiQuote, LIFI_POLICY_HOST, LIFI_QUOTE_TTL_SEC } from '@/lib/lifi-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { buildReport, policyCheck, recipientCheck, validityCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

export const BASE_CHAIN_ID = 8453
export const ROBINHOOD_CHAIN_ID = 4663
/** LiFi treats the zero address as the chain's native asset. */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as const

/** Origin chains the funding plan scans and bridges from, in scan order.
 *  Each is a first-class lib/chains member holding USDC with a live-probed
 *  LiFi route onto Robinhood Chain. */
export const FUNDING_ORIGIN_CHAINS = [8453, 1, 42161] as const
/** The chain word each chip resume uses — the parse contract with
 *  lib/jobs.ts parseRobinhoodFunding (lower-cased in the resume string). */
export const FUNDING_ORIGIN_WORD: Record<number, string> = {
  8453: 'Base',
  1: 'Ethereum',
  42161: 'Arbitrum',
}
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
const ORIGIN_MIN_GAS_ETH: Record<number, number> = { 1: 0.002, 8453: 0.00003, 42161: 0.00003 }
/** ETH kept back on an origin when ETH itself is the sell side — the leg's
 *  own signature (and one more after it) must stay payable once the value
 *  leaves. Mirrors lib/funding-plan's GAS_RESERVE_ETH. ETH became a funding
 *  source 2026-07-28: the most common stranger wallet holds ETH and no
 *  stables, and the flagship stock buy answered it "no USDC on Base,
 *  Ethereum, or Arbitrum" — real money, invisible. LiFi routes native ETH →
 *  USDG and → gas ETH from all three origins through the SAME canonical
 *  diamond as the USDC legs (probed live 2026-07-28: across /
 *  relaydepository, value = fromAmount exactly, 1–2s). */
export const ORIGIN_ETH_KEEPBACK: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002 }

/** Dollars converted to native ETH on Robinhood Chain for gas — ~0.0008 ETH,
 *  enough for many Orbit-chain transactions (observed live: $2 → 0.00105). */
export const GAS_LEG_USD = 1.5
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

// The canonical LiFi diamond per origin — the SAME address observed as both
// transactionRequest.to and approvalAddress on live cross-chain quotes to
// Robinhood Chain (Base probed 2026-07-15; Ethereum + Arbitrum probed
// 2026-07-17, across/relaydepository routes, USDG and gas legs both). Env
// LIFI_BRIDGE_ROUTERS (comma-separated) REPLACES the list; an empty result
// fails closed.
const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE' as const
const DEFAULT_BRIDGE_ROUTERS: Record<number, `0x${string}`[]> = {
  [BASE_CHAIN_ID]: [LIFI_DIAMOND],
  1: [LIFI_DIAMOND],
  42161: [LIFI_DIAMOND],
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

/** The dollars a funding plan must convert to cover a buy: the buy amount
 *  plus bridge-fee headroom, plus the gas leg when the destination wallet
 *  has no ETH. Rounded UP to the next $0.50 so chip labels read clean. */
export function fundingNeedUsd(buyUsd: number, includeGas: boolean): number {
  const raw = buyUsd * (1 + FUNDING_MARGIN_BPS / 10_000) + (includeGas ? GAS_LEG_USD : 0)
  return Math.ceil(raw * 2) / 2
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

export type FundingLeg = 'gas' | 'usdg'

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
}

/** Build + guard ONE funding leg: origin-chain USDC → (native ETH | USDG)
 *  delivered to the sender's own address on Robinhood Chain. The origin
 *  defaults to Base (every pre-existing job/refresh recipe omits it) and
 *  must be a FUNDING_ORIGIN_CHAINS member. `token` picks the origin-side
 *  sell stable: absent/USDC = the chain's native USDC (every pre-existing
 *  recipe), 'USDC.e' = the registry-known bridged variant (Arbitrum only —
 *  anywhere else throws). Throws on transport / no-route (the jobs runner
 *  surfaces the message); a guard or price failure comes back as blocked
 *  with the reasons in the report. */
export async function buildLifiBridgeLeg(params: { leg: FundingLeg; usd: number; from: string; origin?: number; token?: string }): Promise<LifiBridgeBuilt> {
  const from = params.from as `0x${string}`
  if (!ADDR_RE.test(from)) throw new Error('A valid wallet address is required.')
  if (!Number.isFinite(params.usd) || params.usd <= 0) throw new Error(`Couldn't read the funding amount "${params.usd}".`)
  const originId = params.origin ?? BASE_CHAIN_ID
  if (!FUNDING_ORIGIN_WORD[originId]) throw new Error(`Chain ${originId} isn't a supported funding origin.`)
  const origin = chainById(originId)!
  const destination = chainById(ROBINHOOD_CHAIN_ID)!
  const routers = lifiBridgeRoutersFor(originId)
  if (routers.length === 0) throw new Error(`LiFi bridging isn’t allowlisted on ${origin.name}.`)
  const originClient = publicClientFor(originId)
  const destClient = publicClientFor(ROBINHOOD_CHAIN_ID)
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
  const usdg = primaryStable(ROBINHOOD_CHAIN_ID)!
  // Stables are the $1 unit; an ETH sell sizes at build time off Yeetful's
  // own venue-quoter read, so a chip minted yesterday still moves today's
  // right amount of ETH.
  let sellAtoms: bigint
  if (nativeSell) {
    const probe = await usdPerToken(8453, 'ETH').catch(() => null)
    if (!probe) throw new Error("Couldn't price ETH to size the funding leg — try again in a moment.")
    sellAtoms = parseEther((params.usd / probe.usd).toFixed(8))
  } else {
    sellAtoms = BigInt(Math.round(params.usd * 10 ** sell.decimals))
  }
  const gasLeg = params.leg === 'gas'
  const destinationToken = gasLeg ? NATIVE_TOKEN : usdg.address
  const destSymbol = gasLeg ? 'ETH' : usdg.symbol
  const destDecimals = gasLeg ? 18 : usdg.decimals

  // Funding must actually be fundable — read the origin balance up front.
  // A native sell must also clear the keep-back: the leg's own signature
  // (and one more) stays payable after the value leaves.
  const keepbackWei = nativeSell ? parseEther(String(ORIGIN_ETH_KEEPBACK[originId] ?? 0.002)) : BigInt(0)
  const sellBalance = nativeSell
    ? await originClient.getBalance({ address: from })
    : await originClient.readContract({ address: sell.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
  const funded = sellBalance >= sellAtoms + keepbackWei
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: funded,
    note: funded
      ? `The wallet holds ${formatAtoms(sellBalance.toString(), sell.decimals)} ${sell.symbol} on ${origin.name} — covered${nativeSell ? ' (gas keep-back included)' : ''}.`
      : `Insufficient ${sell.symbol} on ${origin.name}: this leg needs $${params.usd}${nativeSell ? ' plus a gas keep-back' : ''} but the wallet holds ${formatAtoms(sellBalance.toString(), sell.decimals)}.`,
  }

  const quote = await fetchLifiQuote({
    chainId: originId,
    toChainId: ROBINHOOD_CHAIN_ID,
    sellAddr: sell.address,
    buyAddr: destinationToken,
    swapAtoms: sellAtoms,
    from,
    slippageBps: 50,
  })

  const exp: LifiBridgeExpectations = {
    originChainId: originId,
    destinationChainId: ROBINHOOD_CHAIN_ID,
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
  // 6-dec unit. ETH-sold USDG leg: the sell was sized off Yeetful's own
  // ETH/USD read, so the guaranteed USDG (≈ dollars) must land within the
  // priced-leg tolerance of the ask. Gas leg: value the guaranteed ETH
  // against our own venue-quoter ETH/USD read (fail-soft — a dead probe
  // warns instead of blocking).
  let priceCheck: GuardrailCheck
  if (!gasLeg && !nativeSell) {
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
        ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} for $${params.usd} of ETH (sized at Yeetful's own on-chain read).`
        : `The route guarantees only ~$${minOutUsd.toFixed(2)} of ${destSymbol} for $${params.usd} of ETH — more than ${(10_000 - GAS_LEG_MIN_OUT_BPS) / 100}% short of Yeetful's own on-chain read, refusing.`,
    }
  } else {
    const probe = await usdPerToken(ROBINHOOD_CHAIN_ID, 'ETH').catch(() => null)
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
          ? `Guaranteed ≥ ${formatAtoms(toAmountMin.toString(), 18)} ETH (~$${minOutUsd.toFixed(2)} at Yeetful's own on-chain read) for the $${params.usd} gas leg.`
          : `The route guarantees only ~$${minOutUsd.toFixed(2)} of ETH for $${params.usd} — more than ${(10_000 - GAS_LEG_MIN_OUT_BPS) / 100}% short of Yeetful's own on-chain read, refusing.`,
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
  const baseline = gasLeg
    ? await destClient.getBalance({ address: from })
    : await destClient.readContract({ address: usdg.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
  const arrival: ChainArrival = {
    chainId: ROBINHOOD_CHAIN_ID,
    token: gasLeg ? 'native' : usdg.address,
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
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(params.usd, policy, spentToday, LIFI_POLICY_HOST, 0, { selfSigned: true })
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: LIFI_POLICY_HOST,
      serviceName: 'LiFi',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (lifi funding bridge)`,
    })
  }

  const checks: GuardrailCheck[] = [recipientCheck(quote.action.toAddress ?? '', from), validityCheck(validUntil), balanceCheck, priceCheck, venueCheck, polCheck]
  const guardrails = buildReport(params.usd, checks, violation ? { violation, valueUsd: params.usd, host: LIFI_POLICY_HOST } : null)

  const summary = gasLeg
    ? `Bridge $${params.usd} of ${origin.name} ${sell.symbol} → ~${formatAtoms(toAmountMin.toString(), 18)} ETH on ${destination.name} for gas (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`
    : `Bridge $${params.usd} of ${origin.name} ${sell.symbol} → ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} on ${destination.name} (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`

  return {
    summary,
    guardrails,
    blocked: !guardrails.ok,
    steps,
    bridgeStepIndex,
    arrival,
    valueUsd: Number(params.usd.toFixed(2)),
  }
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

export interface FundingShortfall {
  /** USDG atoms the wallet holds on Robinhood Chain. */
  usdgAtoms: bigint
  /** True when the wallet can already pay Orbit gas. */
  hasGas: boolean
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
export async function readFundingShortfall(user: string): Promise<FundingShortfall> {
  const from = user as `0x${string}`
  const rh = publicClientFor(ROBINHOOD_CHAIN_ID)
  if (!rh) throw new Error('missing RPC client')
  const usdg = primaryStable(ROBINHOOD_CHAIN_ID)!
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
    hasGas: nativeWei >= RH_GAS_FLOOR_WEI,
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
const fundSegment = (usd: number, word: string, gas: boolean, token = 'USDC') =>
  `Fund robinhood chain with $${usd} from ${word.toLowerCase()}${token === 'USDC' ? '' : ` using ${token.toLowerCase()}`}${gas ? ' including gas' : ''}`

/**
 * Turn a multi-origin scan into chips. `followup` is appended to every
 * resume (", then buy $5 of NVDA"); empty = bridge-only (the MCP-path
 * fallback — the user re-asks once funds land). Ranking: origins arrive
 * richest first; the richest covering origin leads, another covering
 * origin gets an "instead" chip, and when NO single origin covers but
 * several combined do, one chip carries a fund segment per origin (gas on
 * the first leg only). Returns null when the whole wallet can't cover it.
 */
export function planRobinhoodFundingChips(params: {
  origins: FundingOrigin[]
  needUsd: number
  gasIncluded: boolean
  followup: string
}): RobinhoodFundingChip[] | null {
  const { origins, needUsd, gasIncluded, followup } = params
  const withFollowup = (segs: string[]) => (followup ? `${segs.join(', then ')}, then ${followup}` : segs.join(', then '))
  const chips: RobinhoodFundingChip[] = []
  // The FIRST covering origin leads — origins arrive stables-first, so a
  // dust USDC row never forces a combine past an ETH balance that covers
  // the whole plan on its own.
  const best = origins.find((o) => o.usd >= needUsd)
  if (best && best.usd >= needUsd) {
    chips.push({ label: `Just enough (~$${needUsd} from ${originLabel(best)})`, resume: withFollowup([fundSegment(needUsd, best.word, gasIncluded, best.token)]) })
    // Half/all only when they're sensible whole-balance moves — a $15k
    // balance covering a $7 need doesn't get a $7.5k chip (same 10× rule
    // as lib/funding-plan's all-in cap).
    const sensible = best.usd <= needUsd * 10
    const half = Math.floor(best.usd / 2)
    if (sensible && half > needUsd) chips.push({ label: `Half my ${best.word} ${best.token} ($${half})`, resume: withFollowup([fundSegment(half, best.word, gasIncluded, best.token)]) })
    if (sensible && best.usd > needUsd) chips.push({ label: `All my ${best.word} ${best.token} ($${best.usd})`, resume: withFollowup([fundSegment(best.usd, best.word, gasIncluded, best.token)]) })
    const alt = origins.find((o) => o !== best && o.usd >= needUsd)
    if (alt) chips.push({ label: `Use ${originLabel(alt)} instead (~$${needUsd})`, resume: withFollowup([fundSegment(needUsd, alt.word, gasIncluded, alt.token)]) })
    return chips.slice(0, 4)
  }
  // No single origin covers it — combine legs richest-first. The first leg
  // carries the gas segment and must be worth more than the gas leg alone;
  // sub-$2 origins are dust for a bridge.
  const usable = origins.filter((o) => o.usd >= 2)
  const total = usable.reduce((a, o) => a + o.usd, 0)
  if (usable.length >= 2 && total >= needUsd) {
    const segs: string[] = []
    const words: string[] = []
    let remaining = needUsd
    for (const o of usable) {
      if (remaining <= 0) break
      const first = segs.length === 0
      const take = Math.min(o.usd, remaining)
      if (first && gasIncluded && take <= GAS_LEG_USD + 1) continue
      segs.push(fundSegment(take, o.word, first && gasIncluded, o.token))
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

export type RobinhoodFundingAdvice =
  /** Signable USDC covers the plan — offer the chips. */
  | { kind: 'chips'; chips: RobinhoodFundingChip[] }
  /** The money is there but its chain can't sign (no ETH). `chips` carries a
   *  donor-funded topup job when another origin can send gas; null = the
   *  user must top up ETH themselves and `copy` says exactly where/how much. */
  | { kind: 'gas-stranded'; stranded: FundingOrigin; donor: FundingOrigin | null; chips: RobinhoodFundingChip[] | null; copy: string }
  /** Nothing covers it — `copy` is the honest per-chain accounting. */
  | { kind: 'none'; copy: string }

export function planRobinhoodFundingAdvice(params: {
  scan: Pick<FundingShortfall, 'origins' | 'gaslessOrigins' | 'allScanned' | 'failedOrigins'>
  needUsd: number
  gasIncluded: boolean
  /** Appended to chip resumes (empty = bridge-only, user re-asks after). */
  followup: string
}): RobinhoodFundingAdvice {
  const { scan, needUsd, gasIncluded, followup } = params
  const chips = planRobinhoodFundingChips({ origins: scan.origins, needUsd, gasIncluded, followup })
  if (chips) return { kind: 'chips', chips }

  // Gas-stranded rescue: the richest gasless STABLE origin covering the
  // need. ETH rows never land here — sub-keep-back ETH IS the (missing)
  // gas, so "send gas to unstick it" would be nonsense advice.
  const stranded = scan.gaslessOrigins.find((o) => o.token !== 'ETH' && o.usd >= needUsd) ?? null
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
        fundSegment(needUsd, stranded.word, gasIncluded, stranded.token),
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
          `I can fix that from ${donor.word}: move ~${GAS_TOPUP_ETH} ETH over first, then convert the ${stranded.word} ${stranded.token}${gasIncluded ? ' (gas for Robinhood Chain included)' : ''} — one job, each step built and checked when it's your turn to sign.`,
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

  // Nothing covers it — say exactly what was seen, per chain, including
  // money that exists but can't sign and chains that couldn't be read.
  const parts: string[] = []
  const held = [...scan.origins, ...scan.gaslessOrigins].sort((a, b) => b.usd - a.usd)
  if (held.length > 0)
    parts.push(
      held
        .map(
          (o) =>
            `~$${o.usd} of ${o.token} on ${o.word}${
              scan.gaslessOrigins.includes(o) ? (o.token === 'ETH' ? ' (under what a move from there costs)' : ' (no ETH there to sign with)') : ''
            }`,
        )
        .join(', '),
    )
  else parts.push('no USDC or ETH on Base, Ethereum, or Arbitrum')
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
  // Capacity: the richest single origin, or combined non-dust origins when
  // no single one leads (mirrors planRobinhoodFundingChips' two shapes).
  const usable = scan.origins.filter((o) => o.usd >= 2)
  const combined = usable.length >= 2 ? usable.reduce((a, o) => a + o.usd, 0) : 0
  const capUsd = Math.max(scan.origins[0]?.usd ?? 0, combined)
  if (capUsd <= 0) return null
  const gasLeg = includeGas ? GAS_LEG_USD : 0
  // Invert fundingNeedUsd, then floor to a clean quarter-dollar label.
  const maxRaw = holdingUsd + (capUsd - gasLeg) / (1 + FUNDING_MARGIN_BPS / 10_000)
  let max = Math.floor(maxRaw * 4) / 4
  // Only a genuine downsize, and only a meaningful one: at least a dollar
  // AND at least a tenth of what was asked.
  if (!(max < buyUsd) || max < Math.max(1, buyUsd * 0.1)) return null
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
export function rhFundingPending(buyUsd: number, buySym: string, inflight?: Record<string, string>) {
  return {
    kind: 'rh-funding',
    summary: `Unfunded buy on Robinhood Chain: $${buyUsd} of ${buySym} — waiting for USDC or gas to land`,
    data: { buyUsd: String(buyUsd), buySym, ...(inflight ?? {}) },
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
  const originWord = new RegExp(String.raw`\b(${chainAlt(['base', 'ethereum', 'arbitrum', 'robinhood'])})\b`, 'i')
  if (assertVerb.test(m) && (fundingNoun.test(m) || originWord.test(m))) return { kind: 'recheck' }
  return null
}
