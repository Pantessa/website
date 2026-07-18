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
import { formatAtoms } from '@/lib/cow'
import { fetchLifiQuote, LIFI_QUOTE_TTL_SEC } from '@/lib/lifi-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { buildReport, recipientCheck, validityCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'

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
/** Native ETH an origin needs before its USDC is signable there — the
 *  approve + bridge pair must be payable, or the chip is a wall later.
 *  Mainnet's floor is real L1 gas; the L2 floors are cents. */
const ORIGIN_MIN_GAS_ETH: Record<number, number> = { 1: 0.002, 8453: 0.00003, 42161: 0.00003 }

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
  if (value !== BigInt(0)) reasons.push('The bridge carries native value — an ERC-20 input must not send ETH.')
  return reasons
}

/** Verify the assembled step chain: exact-amount approval to the allowlisted
 *  diamond, the bridge call addressed only to it, zero native value, origin
 *  chain only. Inner calldata is aggregator-opaque by design — pinning +
 *  price sanity + the sign-time estimateGas gate stand in for byte-decoding. */
export function guardLifiBridgeBuild(steps: LifiBridgeStep[], exp: LifiBridgeExpectations): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (exp.routers.length === 0) return { ok: false, reasons: ['No LiFi bridge router allowlist for the origin chain — refusing.'] }
  const eqAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (!exp.routers.some((r) => eqAddr(r, exp.approvalAddress))) {
    reasons.push('The quoted approvalAddress is not on the pinned LiFi bridge allowlist — refusing.')
  }
  if (steps.length < 1 || steps.length > 2) {
    return { ok: false, reasons: [`Expected 1–2 steps (approve? → bridge), got ${steps.length}.`] }
  }
  const bridge = steps[steps.length - 1]
  const approvals = steps.slice(0, -1)
  for (const step of steps) {
    if (step.tx.chainId !== exp.originChainId) reasons.push(`A step targets chain ${step.tx.chainId}, not the origin chain ${exp.originChainId}.`)
    if (BigInt(step.tx.value || '0') !== BigInt(0)) reasons.push('Every step must carry zero native value.')
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
 *  must be a FUNDING_ORIGIN_CHAINS member. Throws on transport / no-route
 *  (the jobs runner surfaces the message); a guard or price failure comes
 *  back as blocked with the reasons in the report. */
export async function buildLifiBridgeLeg(params: { leg: FundingLeg; usd: number; from: string; origin?: number }): Promise<LifiBridgeBuilt> {
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

  const usdc = origin.tokens.USDC
  if (!usdc) throw new Error(`${origin.name} has no USDC in the chain registry.`)
  const usdg = primaryStable(ROBINHOOD_CHAIN_ID)!
  const sellAtoms = BigInt(Math.round(params.usd * 10 ** usdc.decimals))
  const gasLeg = params.leg === 'gas'
  const destinationToken = gasLeg ? NATIVE_TOKEN : usdg.address
  const destSymbol = gasLeg ? 'ETH' : usdg.symbol
  const destDecimals = gasLeg ? 18 : usdg.decimals

  // Funding must actually be fundable — read the origin USDC balance up front.
  const usdcBalance = await originClient.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] })
  const funded = usdcBalance >= sellAtoms
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: funded,
    note: funded
      ? `The wallet holds ${formatAtoms(usdcBalance.toString(), usdc.decimals)} USDC on ${origin.name} — covered.`
      : `Insufficient USDC on ${origin.name}: this leg needs $${params.usd} but the wallet holds ${formatAtoms(usdcBalance.toString(), usdc.decimals)}.`,
  }

  const quote = await fetchLifiQuote({
    chainId: originId,
    toChainId: ROBINHOOD_CHAIN_ID,
    sellAddr: usdc.address,
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
    sellToken: usdc.address,
    sellAtoms,
    destinationToken,
    from,
  }
  const echoReasons = verifyLifiBridgeEcho(quote, exp)

  const toAmountMin = BigInt(quote.estimate.toAmountMin)
  const validUntil = Math.floor(Date.now() / 1000) + LIFI_QUOTE_TTL_SEC

  // Price sanity. USDG leg: dollar→dollar, min-out floor in the same 6-dec
  // unit. Gas leg: value the guaranteed ETH against our own venue-quoter
  // ETH/USD read (fail-soft — a dead probe warns instead of blocking).
  let priceCheck: GuardrailCheck
  if (!gasLeg) {
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

  // Allowance → optional exact-amount approval step.
  const approvalAddress = quote.estimate.approvalAddress as `0x${string}`
  let allowance = BigInt(0)
  try {
    allowance = await originClient.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'allowance', args: [from, approvalAddress] })
  } catch {
    allowance = BigInt(0)
  }
  const needsApprove = allowance < sellAtoms

  const steps: LifiBridgeStep[] = []
  if (needsApprove) {
    steps.push({
      label: 'approve',
      title: `Approve ${formatAtoms(sellAtoms.toString(), usdc.decimals)} USDC to LiFi`,
      tx: {
        to: usdc.address,
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
      ? `Bridge $${params.usd} USDC → gas ETH on ${destination.name} (via ${quote.tool})`
      : `Bridge $${params.usd} USDC → ${destSymbol} on ${destination.name} (via ${quote.tool})`,
    tx: {
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: '0',
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

  const checks: GuardrailCheck[] = [recipientCheck(quote.action.toAddress ?? '', from), validityCheck(validUntil), balanceCheck, priceCheck, venueCheck]
  const guardrails = buildReport(params.usd, checks)

  const summary = gasLeg
    ? `Bridge $${params.usd} of ${origin.name} USDC → ~${formatAtoms(toAmountMin.toString(), 18)} ETH on ${destination.name} for gas (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`
    : `Bridge $${params.usd} of ${origin.name} USDC → ≥ ${formatAtoms(toAmountMin.toString(), destDecimals)} ${destSymbol} on ${destination.name} (LiFi-routed, tool: ${quote.tool}) — arrives in seconds, delivered to your own address.`

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
  /** Whole dollars of USDC there (floored), gas-to-sign already verified. */
  usd: number
}

export interface FundingShortfall {
  /** USDG atoms the wallet holds on Robinhood Chain. */
  usdgAtoms: bigint
  /** True when the wallet can already pay Orbit gas. */
  hasGas: boolean
  /** Origins holding signable USDC, richest first. */
  origins: FundingOrigin[]
  /** Origin chain words whose reads failed — "unknown", NEVER "empty": a
   *  partial scan must not turn into a confident "you have nothing there". */
  failedOrigins: string[]
}

/** The balance reads that decide whether a Robinhood Chain buy needs the
 *  funding plan: USDG + native ETH there, then USDC (and gas-to-sign) on
 *  every funding origin — Base, Ethereum, and Arbitrum, not just Base
 *  (live 2026-07-17: $15 of Ethereum USDC was invisible and a $5 buy hit
 *  a wall). Throws only when the ROBINHOOD reads fail — those decide the
 *  whole plan; a failed origin lands in failedOrigins instead. */
export async function readFundingShortfall(user: string): Promise<FundingShortfall> {
  const from = user as `0x${string}`
  const rh = publicClientFor(ROBINHOOD_CHAIN_ID)
  if (!rh) throw new Error('missing RPC client')
  const usdg = primaryStable(ROBINHOOD_CHAIN_ID)!
  const [usdgAtoms, nativeWei] = await Promise.all([
    rh.readContract({ address: usdg.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] }),
    rh.getBalance({ address: from }),
  ])
  const origins: FundingOrigin[] = []
  const failedOrigins: string[] = []
  await Promise.all(
    FUNDING_ORIGIN_CHAINS.map(async (chainId) => {
      const word = FUNDING_ORIGIN_WORD[chainId]
      const client = publicClientFor(chainId)
      const usdc = chainById(chainId)?.tokens.USDC
      if (!client || !usdc) return
      try {
        const [usdcAtoms, gasWei] = await Promise.all([
          client.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [from] }),
          client.getBalance({ address: from }),
        ])
        const usd = Math.floor(Number(usdcAtoms) / 10 ** usdc.decimals)
        const gasEth = Number(formatEther(gasWei))
        if (usd > 0 && gasEth >= (ORIGIN_MIN_GAS_ETH[chainId] ?? 0.002)) {
          origins.push({ chainId, word, usd })
        }
      } catch {
        failedOrigins.push(word)
      }
    }),
  )
  origins.sort((a, b) => b.usd - a.usd)
  return { usdgAtoms, hasGas: nativeWei >= RH_GAS_FLOOR_WEI, origins, failedOrigins }
}

// ── Chip planner (pure — the resume strings ARE the contract) ──────────────

export interface RobinhoodFundingChip {
  label: string
  resume: string
}

/** One funding-ask segment: lib/jobs.ts parseRobinhoodFunding's grammar. */
const fundSegment = (usd: number, word: string, gas: boolean) =>
  `Fund robinhood chain with $${usd} from ${word.toLowerCase()}${gas ? ' including gas' : ''}`

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
  const best = origins[0]
  if (best && best.usd >= needUsd) {
    chips.push({ label: `Just enough (~$${needUsd} from ${best.word})`, resume: withFollowup([fundSegment(needUsd, best.word, gasIncluded)]) })
    // Half/all only when they're sensible whole-balance moves — a $15k
    // balance covering a $7 need doesn't get a $7.5k chip (same 10× rule
    // as lib/funding-plan's all-in cap).
    const sensible = best.usd <= needUsd * 10
    const half = Math.floor(best.usd / 2)
    if (sensible && half > needUsd) chips.push({ label: `Half my ${best.word} USDC ($${half})`, resume: withFollowup([fundSegment(half, best.word, gasIncluded)]) })
    if (sensible && best.usd > needUsd) chips.push({ label: `All my ${best.word} USDC ($${best.usd})`, resume: withFollowup([fundSegment(best.usd, best.word, gasIncluded)]) })
    const alt = origins.find((o) => o !== best && o.usd >= needUsd)
    if (alt) chips.push({ label: `Use ${alt.word} instead (~$${needUsd})`, resume: withFollowup([fundSegment(needUsd, alt.word, gasIncluded)]) })
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
      segs.push(fundSegment(take, o.word, first && gasIncluded))
      words.push(o.word)
      remaining = Number((remaining - take).toFixed(2))
    }
    if (remaining <= 0 && segs.length >= 2) {
      chips.push({ label: `Combine ${words.join(' + ')} (~$${needUsd})`, resume: withFollowup(segs) })
      return chips
    }
  }
  return null
}
