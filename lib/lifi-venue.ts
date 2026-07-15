// ─────────────────────────────────────────────────────────────────────────
//  LiFi settlement venue — the fallback BEHIND the Uniswap v4 fallback,
//  consulted only when v4 throws GatedV4PoolError: the pool quotes on the
//  public V4 Quoter but direct Universal Router execution bare-reverts.
//  The motivating case: Robinhood Chain's tokenized-stock pools (AAPL/TSLA/…
//  vs USDG) settle exclusively through Robinhood's backend-signed
//  DexAggregator — LiFi's "fly" tool wraps that venue, so a LiFi-built
//  transaction is the ONE public path that actually fills these pools.
//
//  Trust shape — different from the other native venues, deliberately:
//  LiFi's inner calldata is aggregator-opaque (backend-signed quote blobs we
//  can't byte-verify like we decode Universal Router calls). The guard
//  compensates with three independent gates, all fail-closed:
//    1. ADDRESS PINNING — transactionRequest.to and estimate.approvalAddress
//       must be on the per-chain LiFi router allowlist (env LIFI_ROUTERS);
//       the approval is exact-amount, the fee transfer is calldata WE encode.
//    2. INDEPENDENT PRICE CHECK — LiFi's toAmount is compared against our
//       own V4 Quoter quote for the same pair/amount (the quoter prices
//       gated pools fine — only execution is gated). More than ~2% below
//       our quote → refuse; a bad or self-dealing route can't underpay.
//    3. SIMULATION — the swap tx is estimateGas-simulated before it is
//       offered. A real revert refuses; transport trouble fails open to the
//       /api/tx/refresh estimateGas gate that re-fires at sign time.
//
//  FEE: 0.20% of the input (lib/fees.ts SWAP_FEE_BPS — deliberately below
//  Uniswap's 25 bps interface fee), taken as an explicit ERC-20 transfer
//  step appended to the chain. LiFi's native integrator-fee param
//  (integrator=yeetful&fee=0.002) 400s without portal.li.fi registration
//  (verified live 2026-07-15), so the fee is deterministic calldata we build
//  ourselves: transfer(TREASURY_ADDRESS, feeAtoms) on the sell token. The
//  swap is quoted for amount MINUS fee — the user's asked amount is the
//  total debit, and the fee is its own visible, decodable step.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, erc20Abi } from 'viem'
import { chainById, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals, tokenLabel, humanToAtoms, formatAtoms } from '@/lib/cow'
import { stableUsd } from '@/lib/uniswap-venue'
import { quoteV4BestOut } from '@/lib/uniswap-v4'
import { SWAP_FEE_BPS, TREASURY_ADDRESS, swapFeeAtoms } from '@/lib/fees'
import {
  buildReport,
  policyCheck,
  recipientCheck,
  validityCheck,
  type GuardrailCheck,
  type GuardrailReport,
} from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

/** Spend-policy attribution host for LiFi-settled swaps. */
export const LIFI_POLICY_HOST = 'lifi.yeetful.com'

const LIFI_API = 'https://li.quest/v1/quote'

/** LiFi quotes wrap backend-signed venue fills — they go STALE fast. The
 *  swap step carries this validity window so SendTxChain's deadline watch
 *  re-quotes (POST /api/tx/refresh) before the calldata dies, instead of
 *  reverting at the wallet's gas estimate (the $32M-fee pattern). */
export const LIFI_QUOTE_TTL_SEC = 90

/** LiFi's toAmount may sit at most this far below our own independent V4
 *  Quoter quote for the same pair/amount (venue fees + spread are real;
 *  a route paying worse than this is refused as a bad or hostile fill). */
export const LIFI_MAX_QUOTE_SHORTFALL_BPS = 200

// Per-chain LiFi diamond/router allowlist. LiFi deploys one canonical
// diamond per chain; Robinhood Chain's was observed as both
// transactionRequest.to and estimate.approvalAddress on live quotes
// (2026-07-15). Env LIFI_ROUTERS (comma-separated addresses) REPLACES the
// list for every chain — an invalid entry is dropped, and an empty result
// fails closed (no allowlist = no venue).
const DEFAULT_LIFI_ROUTERS: Record<number, `0x${string}`[]> = {
  4663: ['0xB477751B76CF82d00a686A1232f5fCD772414Af3'],
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

export function lifiRoutersFor(chainId: number): `0x${string}`[] {
  const env = process.env.LIFI_ROUTERS
  if (env) {
    const list = env
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is `0x${string}` => ADDR_RE.test(s))
    return list
  }
  return DEFAULT_LIFI_ROUTERS[chainId] ?? []
}

/** LiFi has no route either — the honest refusal stays honest. */
export class NoLifiRouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoLifiRouteError'
  }
}

// ── The LiFi quote (narrowed to the fields we verify) ───────────────────────

export interface LifiQuote {
  tool: string
  action: {
    fromToken: { address: string; decimals: number; symbol?: string }
    toToken: { address: string; decimals: number; symbol?: string }
    fromAmount: string
    fromChainId: number
    toChainId: number
    fromAddress: string
    toAddress: string
  }
  estimate: {
    approvalAddress: string
    toAmount: string
    toAmountMin: string
    fromAmount: string
    feeCosts?: { name: string; amount: string; amountUSD?: string; percentage?: string; included?: boolean }[]
  }
  transactionRequest: {
    to: string
    data: string
    value: string
    chainId: number
    from?: string
    gasLimit?: string
  }
}

function narrowQuote(raw: unknown): LifiQuote | null {
  const q = raw as Partial<LifiQuote> | null
  if (!q || typeof q !== 'object') return null
  const a = q.action
  const e = q.estimate
  const t = q.transactionRequest
  if (!a?.fromToken?.address || !a?.toToken?.address || typeof a.fromAmount !== 'string') return null
  if (!e?.approvalAddress || !ADDR_RE.test(e.approvalAddress)) return null
  if (typeof e.toAmount !== 'string' || !/^\d+$/.test(e.toAmount)) return null
  if (typeof e.toAmountMin !== 'string' || !/^\d+$/.test(e.toAmountMin)) return null
  if (!t?.to || !ADDR_RE.test(t.to) || typeof t.data !== 'string' || t.data.length < 10) return null
  return q as LifiQuote
}

/**
 * The quote must ECHO the parsed intent exactly — same tokens, same atoms,
 * same (single) chain, proceeds to the payer. Pure + fail-closed: any
 * mismatch is a reason string; the caller refuses the whole build.
 */
export function verifyLifiQuoteEcho(
  quote: LifiQuote,
  exp: { chainId: number; sellToken: string; buyToken: string; swapAtoms: bigint; from: string },
): string[] {
  const reasons: string[] = []
  const eq = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()
  if (!eq(quote.action.fromToken.address, exp.sellToken)) reasons.push('LiFi echoed a different sell token.')
  if (!eq(quote.action.toToken.address, exp.buyToken)) reasons.push('LiFi echoed a different buy token.')
  if (quote.action.fromAmount !== exp.swapAtoms.toString() || quote.estimate.fromAmount !== exp.swapAtoms.toString()) {
    reasons.push('LiFi echoed a different input amount than the quoted swap amount.')
  }
  if (quote.action.fromChainId !== exp.chainId || quote.action.toChainId !== exp.chainId) {
    reasons.push('LiFi routed across chains — this venue is same-chain settlement only.')
  }
  if (quote.transactionRequest.chainId !== exp.chainId) reasons.push('The built transaction targets a different chain.')
  if (!eq(quote.action.toAddress, exp.from)) reasons.push('Proceeds would not return to the requesting wallet.')
  let value = BigInt(0)
  try {
    value = BigInt(quote.transactionRequest.value || '0')
  } catch {
    reasons.push('The swap carries an unreadable native value — refusing.')
  }
  if (value !== BigInt(0)) reasons.push('The swap carries native value — ERC-20 input must not send ETH.')
  return reasons
}

/** LiFi toAmount vs our own independent quote: accept unless it pays more
 *  than LIFI_MAX_QUOTE_SHORTFALL_BPS below ours. `ourQuote` null = we could
 *  not obtain an independent quote (transport) — the caller decides openness. */
export function lifiPriceAcceptable(lifiToAmount: bigint, ourQuote: bigint): boolean {
  if (ourQuote <= BigInt(0)) return true
  const floor = (ourQuote * BigInt(10_000 - LIFI_MAX_QUOTE_SHORTFALL_BPS)) / BigInt(10_000)
  return lifiToAmount >= floor
}

// ── The guard (pure, fail-closed) ───────────────────────────────────────────

export interface LifiBuiltStep {
  label: string
  title: string
  tx: { to: string; data: string; value: string; chainId: number; action: string }
  validUntil?: number
}

export interface LifiGuardExpectations {
  chainId: number
  /** Pinned router allowlist for the chain (lifiRoutersFor). */
  routers: string[]
  /** estimate.approvalAddress from the quote — must ALSO be allowlisted. */
  approvalAddress: string
  sellToken: string
  /** Atoms sent INTO the LiFi swap (asked amount minus fee). */
  swapAtoms: bigint
  /** Atoms of the Yeetful fee transfer (0 = no fee step expected). */
  feeAtoms: bigint
  treasury: string
}

export interface LifiGuardResult {
  ok: boolean
  reasons: string[]
}

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Verify a built LiFi step chain before it can be offered for signing.
 * The swap's INNER calldata is aggregator-opaque (we cannot decode LiFi's
 * backend-signed quote blob the way we decode Universal Router calls) — so
 * the guard pins everything AROUND it: the swap may only target an
 * allowlisted router with zero native value; the approval is decoded and
 * must be exact-amount to the quote's approvalAddress (itself allowlisted);
 * the fee transfer is decoded and must pay exactly feeAtoms to the treasury.
 * Price honesty is enforced separately (independent quote + simulation).
 */
export function guardLifiBuild(steps: LifiBuiltStep[], exp: LifiGuardExpectations): LifiGuardResult {
  const reasons: string[] = []
  if (exp.routers.length === 0) return { ok: false, reasons: ['No LiFi router allowlist for this chain — refusing.'] }
  if (!exp.routers.some((r) => eqAddr(r, exp.approvalAddress))) {
    reasons.push('The quoted approvalAddress is not on the pinned LiFi router allowlist — refusing.')
  }

  const wantFee = exp.feeAtoms > BigInt(0)
  const minSteps = wantFee ? 2 : 1
  const maxSteps = wantFee ? 3 : 2
  if (steps.length < minSteps || steps.length > maxSteps) {
    return { ok: false, reasons: [`Expected ${minSteps}–${maxSteps} steps (approve? → swap${wantFee ? ' → fee' : ''}), got ${steps.length}.`] }
  }

  const fee = wantFee ? steps[steps.length - 1] : null
  const swap = steps[wantFee ? steps.length - 2 : steps.length - 1]
  const approvals = steps.slice(0, wantFee ? steps.length - 2 : steps.length - 1)

  for (const step of steps) {
    if (step.tx.chainId !== exp.chainId) reasons.push(`A step targets chain ${step.tx.chainId}, not ${exp.chainId}.`)
    if (BigInt(step.tx.value || '0') !== BigInt(0)) reasons.push('Every step must carry zero native value.')
  }

  // Approval: ERC-20 approve(approvalAddress, EXACTLY swapAtoms) on the sell token.
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
        if (!exp.routers.some((r) => eqAddr(r, spender))) reasons.push('The approval spender is not on the pinned LiFi router allowlist.')
        if (amount !== exp.swapAtoms) reasons.push('The approval is not exactly the swap amount — exact-amount approvals only.')
      }
    } catch {
      reasons.push('Could not decode the approval calldata — refusing.')
    }
  }

  // Swap: pinned router only. Inner calldata is opaque by design — pinning +
  // the independent price check + simulation stand in for byte verification.
  if (!exp.routers.some((r) => eqAddr(r, swap.tx.to))) {
    reasons.push('The swap is not addressed to a pinned LiFi router — refusing.')
  }
  if (typeof swap.tx.data !== 'string' || swap.tx.data.length < 10) reasons.push('The swap calldata is empty — refusing.')

  // Fee: transfer(TREASURY, EXACTLY feeAtoms) on the sell token — calldata we
  // encoded ourselves, still re-decoded here (the guard trusts nothing).
  if (fee) {
    if (!eqAddr(fee.tx.to, exp.sellToken)) reasons.push('The fee step does not target the sell token — refusing.')
    try {
      const dec = decodeFunctionData({ abi: erc20Abi, data: fee.tx.data as `0x${string}` })
      if (dec.functionName !== 'transfer') {
        reasons.push(`The fee step calls "${dec.functionName}", not transfer — refusing.`)
      } else {
        const [to, amount] = dec.args as [string, bigint]
        if (!eqAddr(to, exp.treasury)) reasons.push('The fee transfer does not pay the Yeetful treasury — refusing.')
        if (amount !== exp.feeAtoms) reasons.push('The fee transfer is not exactly the disclosed fee amount — refusing.')
      }
    } catch {
      reasons.push('Could not decode the fee transfer calldata — refusing.')
    }
  }

  return { ok: reasons.length === 0, reasons }
}

// ── The builder ─────────────────────────────────────────────────────────────

export interface LifiSwapParams {
  sellToken: string
  buyToken: string
  /** Human units — the TOTAL debit; the fee comes out of this, not on top. */
  amountHuman: string
  from: string
  chainId: number
  slippageBps?: number
}

export interface LifiBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  /** [approve?, swap, fee?] — the swap step carries validUntil + the refresh recipe target. */
  steps: LifiBuiltStep[]
  /** Index of the swap step (the refresh recipe's stepIndex). */
  swapStepIndex: number
  minimumOut: string
  /** Human-formatted fee in sell-token units ('0' when no fee step). */
  feeHuman: string
  /** LiFi tool that fills the route (e.g. 'fly' = Robinhood's DexAggregator). */
  tool: string
}

export async function fetchLifiQuote(params: {
  chainId: number
  /** Destination chain — omitted = same-chain settlement (the venue path).
   *  The bridge sibling (lib/lifi-bridge.ts) passes Robinhood Chain here. */
  toChainId?: number
  sellAddr: string
  buyAddr: string
  swapAtoms: bigint
  from: string
  slippageBps: number
}): Promise<LifiQuote> {
  const url = new URL(LIFI_API)
  url.searchParams.set('fromChain', String(params.chainId))
  url.searchParams.set('toChain', String(params.toChainId ?? params.chainId))
  url.searchParams.set('fromToken', params.sellAddr)
  url.searchParams.set('toToken', params.buyAddr)
  url.searchParams.set('fromAmount', params.swapAtoms.toString())
  url.searchParams.set('fromAddress', params.from)
  url.searchParams.set('slippage', (params.slippageBps / 10_000).toString())
  const headers: Record<string, string> = { accept: 'application/json' }
  if (process.env.LIFI_API_KEY) headers['x-lifi-api-key'] = process.env.LIFI_API_KEY
  let res: Response
  try {
    res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    throw new Error(`LiFi quote request failed: ${err instanceof Error ? err.message : 'network error'}`)
  }
  if (res.status === 404) {
    throw new NoLifiRouteError('LiFi found no route for the pair.')
  }
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  if (!res.ok) {
    const msg = body?.message ?? `HTTP ${res.status}`
    if (/no (?:possible )?route|no quotes?|not found/i.test(msg)) throw new NoLifiRouteError(`LiFi found no route: ${msg}`)
    throw new Error(`LiFi quote failed: ${msg}`)
  }
  const quote = narrowQuote(body)
  if (!quote) throw new Error('LiFi returned an unreadable quote — refusing to build from it.')
  return quote
}

/**
 * Build a guardrailed LiFi-settled swap chain: approve? → swap → fee.
 * Throws NoLifiRouteError when LiFi can't fill either (the route keeps the
 * honest refusal for that). A guard/price/simulation failure comes back as a
 * BLOCK-level check (`blocked: true`) — the artifact is withheld, same shape
 * as the v3/v4 builders.
 */
export async function buildLifiSwap(params: LifiSwapParams): Promise<LifiBuilt> {
  const slippageBps = params.slippageBps ?? 50
  const chain = chainById(params.chainId)
  if (!chain) throw new Error(`Chain ${params.chainId} isn't one of Yeetful's supported chains.`)
  const chainId = chain.id
  const routers = lifiRoutersFor(chainId)
  if (routers.length === 0) throw new Error(`LiFi settlement isn't allowlisted on ${chain.name}.`)
  const client = publicClientFor(chainId)
  if (!client) throw new Error(`No RPC client configured for ${chain.name}.`)
  const from = params.from as `0x${string}`
  if (!ADDR_RE.test(from)) throw new Error('A valid wallet address is required.')

  const sellAddr = resolveToken(params.sellToken, chainId) as `0x${string}` | null
  const buyAddr = resolveToken(params.buyToken, chainId) as `0x${string}` | null
  if (!sellAddr) throw new Error(`Unknown sell token on ${chain.name}: ${params.sellToken}`)
  if (!buyAddr) throw new Error(`Unknown buy token on ${chain.name}: ${params.buyToken}`)
  if (sellAddr === buyAddr) throw new Error('sellToken and buyToken must differ.')
  const sellDec = tokenDecimals(params.sellToken, chainId) ?? 18
  const buyDec = tokenDecimals(params.buyToken, chainId) ?? 18
  const atoms = humanToAtoms(params.amountHuman, sellDec)
  if (!atoms) throw new Error(`Couldn't read the amount "${params.amountHuman}" (${sellDec} decimals max).`)
  const totalAtoms = BigInt(atoms)

  // The fee comes OUT of the asked amount: "swap 100 USDG" debits exactly
  // 100 — 99.8 into the venue, 0.2 to the treasury, both decodable steps.
  const feeAtoms = swapFeeAtoms(totalAtoms)
  const swapAtoms = totalAtoms - feeAtoms
  if (swapAtoms <= BigInt(0)) throw new Error('Amount too small to swap after the fee.')

  const sellLabel = tokenLabel(params.sellToken, chainId)
  const buyLabel = tokenLabel(params.buyToken, chainId)

  const quote = await fetchLifiQuote({ chainId, sellAddr, buyAddr, swapAtoms, from, slippageBps })

  // ── Gate 0: the quote must echo the parsed intent exactly. ────────────────
  const echoReasons = verifyLifiQuoteEcho(quote, { chainId, sellToken: sellAddr, buyToken: buyAddr, swapAtoms, from })

  const toAmount = BigInt(quote.estimate.toAmount)
  const toAmountMin = BigInt(quote.estimate.toAmountMin)
  const validUntil = Math.floor(Date.now() / 1000) + LIFI_QUOTE_TTL_SEC

  // ── Gate 2: independent price check — our own V4 Quoter quote for the same
  //   pair/amount (the quoter prices venue-gated pools; only execution is
  //   gated). Transport failure = no independent quote → fail OPEN with a
  //   warn (the simulation + refresh gates still stand); a live quote that
  //   LiFi underpays by >2% → BLOCK.
  let ourQuote: bigint | null = null
  try {
    ourQuote = await quoteV4BestOut(chainId, sellAddr, buyAddr, swapAtoms)
  } catch {
    ourQuote = null
  }
  const priceOk = ourQuote === null || lifiPriceAcceptable(toAmount, ourQuote)
  const priceCheck: GuardrailCheck = {
    id: 'price',
    level: ourQuote === null ? 'warn' : 'block',
    ok: priceOk,
    note:
      ourQuote === null
        ? 'No independent on-chain quote available to cross-check LiFi’s price (RPC unavailable) — relying on simulation + the sign-time re-quote.'
        : priceOk
          ? `LiFi's fill (${formatAtoms(toAmount.toString(), buyDec)} ${buyLabel}) verified against Yeetful's own on-chain quote (${formatAtoms(ourQuote.toString(), buyDec)} ${buyLabel}) — within ${LIFI_MAX_QUOTE_SHORTFALL_BPS / 100}%.`
          : `LiFi's fill (${formatAtoms(toAmount.toString(), buyDec)} ${buyLabel}) pays more than ${LIFI_MAX_QUOTE_SHORTFALL_BPS / 100}% below Yeetful's own on-chain quote (${formatAtoms(ourQuote.toString(), buyDec)} ${buyLabel}) — refusing a bad fill.`,
  }

  // Allowance read: LiFi pulls the sell token via approvalAddress.
  const approvalAddress = quote.estimate.approvalAddress as `0x${string}`
  let allowance = BigInt(0)
  try {
    allowance = await client.readContract({ address: sellAddr, abi: erc20Abi, functionName: 'allowance', args: [from, approvalAddress] })
  } catch {
    allowance = BigInt(0) // unreadable → assume approval needed (harmless: exact-amount)
  }
  const needsApprove = allowance < swapAtoms

  const steps: LifiBuiltStep[] = []
  if (needsApprove) {
    steps.push({
      label: 'approve',
      title: `Approve ${formatAtoms(swapAtoms.toString(), sellDec)} ${sellLabel} to LiFi`,
      tx: {
        to: sellAddr,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approvalAddress, swapAtoms] }),
        value: '0',
        chainId,
        action: 'approve',
      },
    })
  }
  const swapStepIndex = steps.length
  steps.push({
    label: 'swap',
    title: `Swap ${formatAtoms(swapAtoms.toString(), sellDec)} ${sellLabel} → ${buyLabel} (via ${chain.name}'s venue)`,
    tx: {
      to: quote.transactionRequest.to,
      data: quote.transactionRequest.data,
      value: '0',
      chainId,
      action: 'swap',
    },
    // LiFi quotes wrap backend-signed fills — stale fast. The deadline watch
    // re-quotes through /api/tx/refresh before this lapses.
    validUntil,
  })
  if (feeAtoms > BigInt(0)) {
    steps.push({
      label: 'fee',
      title: `Yeetful fee — ${formatAtoms(feeAtoms.toString(), sellDec)} ${sellLabel} (${SWAP_FEE_BPS / 100}%)`,
      tx: {
        to: sellAddr,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [TREASURY_ADDRESS, feeAtoms] }),
        value: '0',
        chainId,
        action: 'transfer',
      },
    })
  }

  // ── Gate 1: the pinning guard — decode what we just assembled. ───────────
  const guard = guardLifiBuild(steps, {
    chainId,
    routers,
    approvalAddress,
    sellToken: sellAddr,
    swapAtoms,
    feeAtoms,
    treasury: TREASURY_ADDRESS,
  })
  const allGuardReasons = [...echoReasons, ...guard.reasons]
  const venueCheck: GuardrailCheck = {
    id: 'venue',
    level: 'block',
    ok: allGuardReasons.length === 0,
    note:
      allGuardReasons.length === 0
        ? `Settlement pinned to LiFi's router ${quote.transactionRequest.to.slice(0, 8)}… (tool: ${quote.tool}); approval exact-amount; quote echo verified. Inner calldata is venue-signed — verified by independent price check + simulation instead of byte-decoding.`
        : `Build failed verification: ${allGuardReasons.join(' ')}`,
  }

  // ── Gate 3: simulate the swap before offering it. Only meaningful when the
  //   allowance is already in place (otherwise the swap legitimately reverts
  //   on allowance — the refresh gate estimates it again after the approval
  //   confirms). Real revert → BLOCK; transport trouble → fail open.
  let simCheck: GuardrailCheck = {
    id: 'simulation',
    level: 'warn',
    ok: true,
    note: needsApprove
      ? 'Simulation deferred: the swap re-quotes and dry-runs after the approval confirms (sign-time estimateGas gate).'
      : 'Swap simulated clean.',
  }
  if (!needsApprove && allGuardReasons.length === 0) {
    try {
      await client.estimateGas({
        account: from,
        to: quote.transactionRequest.to as `0x${string}`,
        data: quote.transactionRequest.data as `0x${string}`,
        value: BigInt(0),
      })
      simCheck = { id: 'simulation', level: 'block', ok: true, note: 'Swap simulated clean (estimateGas) against the live chain.' }
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : ''
      if (/timeout|timed out|rate limit|fetch failed|econnre/i.test(msg)) {
        simCheck = {
          id: 'simulation',
          level: 'warn',
          ok: true,
          note: 'Could not simulate (RPC trouble) — the sign-time re-quote gate still dry-runs the swap.',
        }
      } else {
        simCheck = {
          id: 'simulation',
          level: 'block',
          ok: false,
          note: `The built swap reverts in simulation (${(msg || 'execution reverted').slice(0, 160)}) — refusing to offer it.`,
        }
      }
    }
  }

  const feeCheck: GuardrailCheck = {
    id: 'fee',
    level: 'warn',
    ok: true,
    note:
      feeAtoms > BigInt(0)
        ? `Yeetful fee: ${formatAtoms(feeAtoms.toString(), sellDec)} ${sellLabel} (${SWAP_FEE_BPS / 100}% of the input, below Uniswap's 0.25% interface fee) — its own visible transfer step to the Yeetful treasury.`
        : 'No Yeetful fee on this swap (amount below fee resolution).',
  }
  const allowanceCheck: GuardrailCheck = {
    id: 'allowance',
    level: 'warn',
    ok: !needsApprove,
    note: needsApprove
      ? `One exact-amount approval attached (${formatAtoms(swapAtoms.toString(), sellDec)} ${sellLabel} → LiFi's router).`
      : 'Allowance already in place.',
  }

  // ── Cross-app guardrails: same policy gate as every native venue. ─────────
  const checks: GuardrailCheck[] = [recipientCheck(quote.action.toAddress ?? '', from), validityCheck(validUntil), allowanceCheck, feeCheck, priceCheck, venueCheck, simCheck]
  const valueUsd = stableUsd(chainId, sellAddr, totalAtoms) ?? stableUsd(chainId, buyAddr, toAmount)
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, LIFI_POLICY_HOST)
  checks.push(polCheck)
  const guardrails = buildReport(valueUsd, checks)
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: LIFI_POLICY_HOST,
      serviceName: 'LiFi',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (lifi swap)`,
    })
  }

  const outHuman = formatAtoms(toAmount.toString(), buyDec)
  const minHuman = formatAtoms(toAmountMin.toString(), buyDec)
  const feeHuman = feeAtoms > BigInt(0) ? formatAtoms(feeAtoms.toString(), sellDec) : '0'
  const summary = `Swap ${params.amountHuman} ${sellLabel} → ~${outHuman} ${buyLabel} on ${chain.name} via its own settlement venue (LiFi-routed, tool: ${quote.tool}), min received ${minHuman}${feeAtoms > BigInt(0) ? `, incl. ${feeHuman} ${sellLabel} Yeetful fee (${SWAP_FEE_BPS / 100}%)` : ''}`

  return {
    summary,
    guardrails,
    blocked: !guardrails.ok,
    steps,
    swapStepIndex,
    minimumOut: minHuman,
    feeHuman,
    tool: quote.tool,
  }
}
