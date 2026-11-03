// ─────────────────────────────────────────────────────────────────────────
//  Uniswap v4 venue adapter — the FALLBACK half of the native Uniswap path,
//  consulted only when v3 has no pool for a pair (lib/uniswap-venue.ts
//  throws NoV3PoolError). The motivating case: Robinhood Chain's 100
//  tokenized stocks (AAPL/TSLA/…) trade in v4-ONLY pools quoted against
//  USDG — "swap 100 USDG for AAPL on robinhood" has no v3 route at all.
//
//  Build recipe, deterministic end to end (no model text anywhere):
//    1. Quote via the chain's pinned V4 Quoter across the standard no-hook
//       pool keys (fee/tickSpacing pairs) — best amountOut wins.
//    2. Encode ONE Universal Router `execute`. Fee off: exactly the V4_SWAP
//       command, SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL — TAKE_ALL
//       credits the transaction SENDER, so the recipient is the payer by
//       construction. Fee on (the default, lib/fees.ts): the output lands
//       on the router (TAKE → ADDRESS_THIS) and two more router commands
//       split it — PAY_PORTION sends feeBps to the Pantessa treasury, SWEEP
//       sends the rest to MSG_SENDER with the post-fee minimum enforced.
//       Both recipients are SENTINELS or the pinned treasury — still no
//       free-form recipient field to get wrong. This is the v4 mirror of
//       v3's router-native sweepTokenWithFee split.
//    3. v4 pulls funds through Permit2, so an ERC-20 sell may need up to two
//       approvals (token→Permit2, then Permit2→Universal Router), both for
//       EXACTLY the asked amount — assembled as one SendTxChain.
//    4. GUARD: decode the calldata we just built and refuse unless every
//       field verifies (pinned router, exact amounts, quoted pool key, no
//       hooks, zero native value, and — fee on — the treasury-pinned
//       PAY_PORTION at a canonical tier plus the sender-sentinel SWEEP) —
//       same fail-closed shape as the v3 / cross-chain / Aave guards. A
//       guard failure withholds the artifact.
//
//  Only no-hook pools are scanned: a hooked pool's contract can reorder
//  economics mid-swap, so we refuse rather than route through code we
//  haven't verified. Live-probed 2026-07-13 on Robinhood Chain: USDG↔AAPL
//  and USDG↔TSLA fill at fee 3000/tick 60 (and 10000/200) with hooks = 0x0.
// ─────────────────────────────────────────────────────────────────────────

import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi } from 'viem'
import { buysNativeEth, chainById, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals, tokenLabel, humanToAtoms, formatAtoms } from '@/lib/cow'
import { UNISWAP_POLICY_HOST, UNI_DEADLINE_SEC, UNI_DEFAULT_SLIPPAGE_BPS } from '@/lib/uniswap-venue'
import {
  buildReport,
  policyCheck,
  recipientCheck,
  validityCheck,
  type GuardrailCheck,
  type GuardrailReport,
} from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, spentTotalUsd, toPolicy } from '@/lib/grant-store'
import { LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, TREASURY_ADDRESS, swapFeeAtoms } from '@/lib/fees'
import { creatorBpsFor, payableCreator, stableSideOf, type CreatorPaid } from '@/lib/creator-split'
import { checkFillAgainstTape, startSwapTape } from '@/lib/stock-tape'
import { UnknownTokenError } from '@/lib/token-list'
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_USDC } from '@/lib/chains'
import {
  NATIVE_CURRENCY,
  POLICY_POOL_BUILD_PATH,
  policyPoolChainName,
  policyPoolClient,
  policyPoolConfig,
  type PolicyPoolConfig,
} from '@/lib/policy-pool/config'
import { POLICY_POOL_HOOK_ABI, decodeHookData, encodeHookData, intentIdFor, poolIdFor, type Attestation } from '@/lib/policy-pool/spec'
import { attestationFor, signAttestation, verifyAttestation } from '@/lib/policy-pool/attestation'
import { policyDecision } from '@/lib/policy-pool/policy'
import { recordPolicyPoolEvent } from '@/lib/policy-pool/ledger'
import { decodeErrorResult, type Address, type Hex } from 'viem'

// Standard v4 fee → tickSpacing pairs (mirrors v3's tier scan; v4 has no
// enumerable tier list, these are the factory-conventional no-hook keys).
const V4_POOL_KEYS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const

const ZERO_HOOKS = '0x0000000000000000000000000000000000000000' as const

// Universal Router command + v4-periphery action bytes (Uniswap/universal-router
// Commands.sol, v4-periphery Actions.sol — stable protocol constants).
const UR_COMMAND_V4_SWAP = 0x10
const UR_COMMAND_SWEEP = 0x04
const UR_COMMAND_PAY_PORTION = 0x06
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06
const ACTION_SETTLE_ALL = 0x0c
const ACTION_TAKE = 0x0e
const ACTION_TAKE_ALL = 0x0f

// Recipient sentinels — the same two values in BOTH layers we touch
// (universal-router Constants.sol and v4-periphery ActionConstants.sol):
// address(1) = "the transaction sender", address(2) = "the router itself".
// Using sentinels keeps the no-free-form-recipient property: the only
// literal address anywhere in a fee build is the pinned treasury.
const SENTINEL_MSG_SENDER = '0x0000000000000000000000000000000000000001' as const
const SENTINEL_ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as const
/** ActionConstants.OPEN_DELTA — TAKE's "the full credit" amount. */
const OPEN_DELTA = BigInt(0)

const hexByte = (b: number) => b.toString(16).padStart(2, '0')
/** Fee-off action sequence (and the only one the guard accepts fee-off). */
const V4_ACTIONS = `0x${[ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL].map(hexByte).join('')}` as `0x${string}`
/** Fee-on action sequence: the output is TAKEn to the router so the
 *  PAY_PORTION/SWEEP commands have a balance to split. The swap action's own
 *  amountOutMinimum still enforces the slippage bound; SWEEP re-enforces the
 *  post-fee minimum for the user's share. */
const V4_ACTIONS_FEE = `0x${[ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE].map(hexByte).join('')}` as `0x${string}`
/** Fee-off command list: the single V4_SWAP. */
const UR_COMMANDS = `0x${hexByte(UR_COMMAND_V4_SWAP)}` as `0x${string}`
/** Fee-on command list: V4_SWAP, then the router-native output split. */
const UR_COMMANDS_FEE = `0x${[UR_COMMAND_V4_SWAP, UR_COMMAND_PAY_PORTION, UR_COMMAND_SWEEP].map(hexByte).join('')}` as `0x${string}`
/** Fee-on WITH a creator share (lib/creator-split, stable-out swaps only):
 *  the creator's PAY_PORTION leads, the treasury's takes the rest of the tier. */
const UR_COMMANDS_FEE_CREATOR = `0x${[UR_COMMAND_V4_SWAP, UR_COMMAND_PAY_PORTION, UR_COMMAND_PAY_PORTION, UR_COMMAND_SWEEP].map(hexByte).join('')}` as `0x${string}`

const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1)
const UINT160_MAX = (BigInt(1) << BigInt(160)) - BigInt(1)

/** Exported for the venue manifest: selectors are derived from these ABIs, never retyped. */
export const UNIVERSAL_ROUTER_ABI = [
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const V4_QUOTER_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable', // simulated via eth_call; never sent
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const PERMIT2_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
] as const

// ABI fragments for the v4 router action params (decoded by the guard too).
const EXACT_IN_SINGLE_PARAM = {
  type: 'tuple',
  components: [
    {
      name: 'poolKey',
      type: 'tuple',
      components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
    },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' },
    { name: 'amountOutMinimum', type: 'uint128' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const
const CURRENCY_AMOUNT_PARAMS = [{ type: 'address' }, { type: 'uint256' }] as const
/** TAKE(currency, recipient, amount) — also PAY_PORTION(token, recipient,
 *  bips) and SWEEP(token, recipient, amountMin): all three decode as
 *  (address, address, uint256). */
const ADDRESS_ADDRESS_UINT_PARAMS = [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }] as const
const ACTIONS_ENVELOPE_PARAMS = [{ type: 'bytes' }, { type: 'bytes[]' }] as const

export interface V4PoolKey {
  currency0: `0x${string}`
  currency1: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
}

/** No v4 pool either — the pair simply isn't on Uniswap on this chain. */
export class NoV4PoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoV4PoolError'
  }
}

/** The pool QUOTES but can never EXECUTE from a direct Universal Router call.
 *  Robinhood Chain's tokenized-stock pools (AAPL/TSLA/… vs USDG) are venue-
 *  gated: every real stock swap runs through Robinhood's backend-signed
 *  DexAggregator stack, and a direct UR `execute` bare-reverts (empty revert
 *  data) at the SWAP action — while the v4 Quoter, which never triggers the
 *  gate, happily prices the pool. Offering such a build burns the user's
 *  Permit2 signature on a swap that can never land (the 2026-07-14 AAPL
 *  incident, second act). The route turns this into an honest refusal. */
export class GatedV4PoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatedV4PoolError'
  }
}

// ── Calldata construction (pure — exported so the guard tests can build) ────

export interface V4SwapPlan {
  poolKey: V4PoolKey
  zeroForOne: boolean
  amountIn: bigint
  minOut: bigint
  deadline: number
  /** Pantessa fee in bps (lib/fees.ts tiers). 0/omitted = the classic
   *  fee-free encoding, byte-identical to the pre-fee builder. */
  feeBps?: number
  /** The link creator paid inside the swap, in the OUTPUT token (the builder
   *  sets it only when the output is a registry stable). `feeBps` stays the
   *  whole tier; the treasury's portion carries feeBps − creator.bps. */
  creator?: { address: string; bps: number }
  /** hookData handed to the pool's hook with the swap. Absent/empty = the
   *  classic no-hook encoding, byte-identical to before. THE POLICY POOL
   *  (buildPolicyPoolSwap) carries the desk's signed attestation here. */
  hookData?: `0x${string}`
}

/** What the output split pays, in order. The second PAY_PORTION reads the
 *  router's balance AFTER the creator's, so the treasury's bips apply to the
 *  remainder and SWEEP's minimum is taken after both. Pure, shared by the
 *  encoder and the guard. */
function v4OutputSplit(minOut: bigint, feeBps: number, creator?: { bps: number }): { treasuryBps: number; sweepMin: bigint } {
  const afterCreator = minOut - (creator ? swapFeeAtoms(minOut, creator.bps) : BigInt(0))
  const treasuryBps = feeBps - (creator?.bps ?? 0)
  return { treasuryBps, sweepMin: afterCreator - swapFeeAtoms(afterCreator, treasuryBps) }
}

/** Encode the ONE Universal Router call. Fee off: V4_SWAP → swap, settle,
 *  take-all. Fee on: the take lands on the router and PAY_PORTION/SWEEP
 *  split the output treasury/sender inside the same execute. */
export function encodeV4SwapCalldata(plan: V4SwapPlan): `0x${string}` {
  const feeOn = (plan.feeBps ?? 0) > 0
  const currencyIn = plan.zeroForOne ? plan.poolKey.currency0 : plan.poolKey.currency1
  const currencyOut = plan.zeroForOne ? plan.poolKey.currency1 : plan.poolKey.currency0
  const swapParams = encodeAbiParameters(
    [EXACT_IN_SINGLE_PARAM],
    [
      {
        poolKey: plan.poolKey,
        zeroForOne: plan.zeroForOne,
        amountIn: plan.amountIn,
        amountOutMinimum: plan.minOut,
        hookData: plan.hookData ?? '0x',
      },
    ],
  )
  const settleParams = encodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], [currencyIn, plan.amountIn])
  const takeParams = feeOn
    ? // Full output credit to the ROUTER — the split commands below pay it out.
      encodeAbiParameters([...ADDRESS_ADDRESS_UINT_PARAMS], [currencyOut, SENTINEL_ADDRESS_THIS, OPEN_DELTA])
    : encodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], [currencyOut, plan.minOut])
  const v4Input = encodeAbiParameters(
    [...ACTIONS_ENVELOPE_PARAMS],
    [feeOn ? V4_ACTIONS_FEE : V4_ACTIONS, [swapParams, settleParams, takeParams]],
  )
  if (!feeOn) {
    return encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute',
      args: [UR_COMMANDS, [v4Input], BigInt(plan.deadline)],
    })
  }
  const feeBps = plan.feeBps as number
  const split = v4OutputSplit(plan.minOut, feeBps, plan.creator)
  const payPortionInput = encodeAbiParameters(
    [...ADDRESS_ADDRESS_UINT_PARAMS],
    [currencyOut, TREASURY_ADDRESS, BigInt(split.treasuryBps)],
  )
  // The user's minimum, post-fee — SWEEP reverts below it (InsufficientToken).
  const sweepInput = encodeAbiParameters(
    [...ADDRESS_ADDRESS_UINT_PARAMS],
    [currencyOut, SENTINEL_MSG_SENDER, split.sweepMin],
  )
  if (plan.creator) {
    const creatorInput = encodeAbiParameters(
      [...ADDRESS_ADDRESS_UINT_PARAMS],
      [currencyOut, plan.creator.address as `0x${string}`, BigInt(plan.creator.bps)],
    )
    return encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute',
      args: [UR_COMMANDS_FEE_CREATOR, [v4Input, creatorInput, payPortionInput, sweepInput], BigInt(plan.deadline)],
    })
  }
  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [UR_COMMANDS_FEE, [v4Input, payPortionInput, sweepInput], BigInt(plan.deadline)],
  })
}

// ── The guard (pure, fail-closed) ───────────────────────────────────────────

export interface V4BuiltStep {
  label: string
  title: string
  tx: { to: string; data: string; value: string; chainId: number; action: string }
  /** Unix seconds the step's calldata dies (the swap deadline) — rides into
   *  TxChainStep.validUntil so the card re-quotes before it lapses. */
  validUntil?: number
}

export interface V4GuardExpectations {
  chainId: number
  universalRouter: `0x${string}`
  permit2: `0x${string}`
  sellToken: `0x${string}`
  buyToken: `0x${string}`
  amountIn: bigint
  minOut: bigint
  poolKey: V4PoolKey
  /** The exact Permit2 expiration the builder stamped (unix sec). */
  permit2Expiration: number
  /** Pantessa fee the build was priced at, in bps. 0/omitted = the classic
   *  fee-free shape is the ONLY one accepted; positive = the PAY_PORTION/
   *  SWEEP shape is REQUIRED, the recipient must be the pinned treasury,
   *  and the rate must sit in the canonical two-tier family. */
  feeBps?: number
  /** The link creator paid inside this swap (output side only), or absent.
   *  `payer` is the wallet the SWEEP pays: the creator must not be it. */
  creator?: { address: string; bps: number; payer: string }
  /** THE POLICY POOL: present ⇒ the swap MUST target the pinned hook and
   *  carry hookData that decodes to the attestation described here, signed
   *  by the pinned policy signer. Absent ⇒ hooks and hookData are refused,
   *  exactly as before. */
  policyPool?: V4PolicyPoolExpectation
}

/** What the guard requires of a policy-pool swap's hookData. Every field is
 *  the builder's own record of what it asked the signer for; the guard
 *  re-decodes the calldata and compares — never trusts the builder's memory
 *  of the bytes. `signatureVerified` is the verdict of `verifyAttestation`
 *  over the DECODED attestation, computed by `guardPolicyPoolBuild` (async;
 *  viem's recovery is async) and handed in — the sync guard refuses unless it
 *  is literally `true`. */
export interface V4PolicyPoolExpectation {
  hook: `0x${string}`
  poolId: `0x${string}`
  signer: `0x${string}`
  intentId: `0x${string}`
  swapper: `0x${string}`
  zeroForOne: boolean
  maxAmountIn: bigint
  origin: string
  signatureVerified: boolean
}

export interface V4GuardResult {
  ok: boolean
  reasons: string[]
}

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** 65 bytes = 0x + 130 hex. */
const SIG_65_RE = /^0x[0-9a-fA-F]{130}$/

/** The reasons a policy-pool swap's hookData fails the guard (empty = passes).
 *  Pure, sync, fail-closed: anything that does not decode refuses. */
function policyPoolHookDataReasons(hookData: `0x${string}`, zeroForOne: boolean, amountIn: bigint, pp: V4PolicyPoolExpectation): string[] {
  const reasons: string[] = []
  if (!hookData || hookData === '0x') return ['The policy pool swap carries no attestation (empty hookData) — the hook would revert NotAttested.']
  let att: Attestation
  let sig: `0x${string}`
  try {
    ;({ att, sig } = decodeHookData(hookData))
  } catch {
    return ['The policy pool hookData does not decode as (Attestation, signature) — refusing.']
  }
  if (att.intentId.toLowerCase() !== pp.intentId.toLowerCase()) reasons.push('The attestation names a different intent than this build — refusing.')
  if (att.poolId.toLowerCase() !== pp.poolId.toLowerCase()) reasons.push('The attestation names a different pool than the pinned policy pool — refusing.')
  if (!eqAddr(att.swapper, pp.swapper)) reasons.push('The attestation names a different swapper than this build is for — refusing.')
  if (att.zeroForOne !== pp.zeroForOne) reasons.push('The attestation direction does not match what the desk asked for — refusing.')
  if (att.zeroForOne !== zeroForOne) reasons.push('The attestation direction does not match the swap direction — refusing.')
  if (att.maxAmountIn !== pp.maxAmountIn) reasons.push('The attestation maxAmountIn is not the size the desk asked for — refusing.')
  if (amountIn > att.maxAmountIn) reasons.push('The swap amountIn exceeds the attested maximum — the hook would revert OverSize.')
  if (att.origin !== pp.origin) reasons.push('The attestation origin is not the provenance the desk recorded — refusing.')
  if (att.expiry <= BigInt(Math.floor(Date.now() / 1000))) reasons.push('The attestation has already expired — refusing.')
  if (!SIG_65_RE.test(sig)) reasons.push('The attestation signature is not 65 bytes — refusing.')
  if (pp.signatureVerified !== true) reasons.push(`The attestation signature does not verify to the pinned policy signer ${pp.signer.slice(0, 8)}… — refusing.`)
  return reasons
}

/**
 * Verify a built v4 step chain before it can be offered for signing. Every
 * step is decoded independently of the code that built it: pinned addresses
 * only, exactly the asked atoms, the quoted no-hook pool key, the fixed
 * swap→settle→take action sequence, zero native value. Any mismatch — or
 * anything that fails to decode — REFUSES the whole chain.
 */
export function guardUniswapV4Build(steps: V4BuiltStep[], exp: V4GuardExpectations): V4GuardResult {
  const reasons: string[] = []
  if (steps.length < 1 || steps.length > 3) {
    return { ok: false, reasons: [`Expected 1–3 steps (approvals + swap), got ${steps.length}.`] }
  }
  const swap = steps[steps.length - 1]
  const approvals = steps.slice(0, -1)

  // Approval steps: token→Permit2 (ERC-20 approve), then Permit2→router.
  for (const step of approvals) {
    const tx = step.tx
    if (tx.chainId !== exp.chainId) reasons.push(`Approval step targets chain ${tx.chainId}, not ${exp.chainId}.`)
    if (BigInt(tx.value || '0') !== BigInt(0)) reasons.push('An approval must carry zero native value.')
    if (eqAddr(tx.to, exp.sellToken)) {
      // ERC-20 approve(spender=Permit2, amount=EXACT atoms)
      try {
        const dec = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` })
        if (dec.functionName !== 'approve') {
          reasons.push(`Token step calls "${dec.functionName}", not approve — refusing.`)
        } else {
          const [spender, amount] = dec.args as [string, bigint]
          if (!eqAddr(spender, exp.permit2)) reasons.push('The token approval spender is not the pinned Permit2.')
          if (amount !== exp.amountIn) reasons.push('The token approval amount is not exactly the swap amount.')
        }
      } catch {
        reasons.push('Could not decode the token approval calldata — refusing.')
      }
    } else if (eqAddr(tx.to, exp.permit2)) {
      // Permit2.approve(token, spender=Universal Router, amount=EXACT, expiration)
      try {
        const dec = decodeFunctionData({ abi: PERMIT2_ABI, data: tx.data as `0x${string}` })
        if (dec.functionName !== 'approve') {
          reasons.push(`Permit2 step calls "${dec.functionName}", not approve — refusing.`)
        } else {
          const [token, spender, amount, expiration] = dec.args as [string, string, bigint, number]
          if (!eqAddr(token, exp.sellToken)) reasons.push('The Permit2 approval is for a different token.')
          if (!eqAddr(spender, exp.universalRouter)) reasons.push('The Permit2 approval spender is not the pinned Universal Router.')
          if (amount !== exp.amountIn) reasons.push('The Permit2 approval amount is not exactly the swap amount.')
          if (Number(expiration) !== exp.permit2Expiration) reasons.push('The Permit2 approval expiration is not the one we stamped.')
        }
      } catch {
        reasons.push('Could not decode the Permit2 approval calldata — refusing.')
      }
    } else {
      reasons.push('An approval step targets neither the sell token nor the pinned Permit2 — refusing.')
    }
  }

  // The swap step: ONE Universal Router execute. Fee off: command V4_SWAP
  // only. Fee on: exactly V4_SWAP → PAY_PORTION → SWEEP — either shape
  // appearing when the OTHER was priced refuses (a fee leg nobody priced is
  // as wrong as a missing one).
  const feeBps = exp.feeBps ?? 0
  const feeOn = feeBps > 0
  if (feeOn && ![SWAP_FEE_BPS, LINK_SWAP_FEE_BPS].includes(feeBps)) {
    reasons.push(`Fee rate ${feeBps}bps is outside the canonical tiers — refusing.`)
  }
  const tx = swap.tx
  if (!eqAddr(tx.to, exp.universalRouter)) reasons.push('The swap is not addressed to the pinned Universal Router.')
  if (tx.chainId !== exp.chainId) reasons.push(`The swap targets chain ${tx.chainId}, not ${exp.chainId}.`)
  if (BigInt(tx.value || '0') !== BigInt(0)) reasons.push('The swap must carry zero native value (ERC-20 in via Permit2).')
  try {
    const dec = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: tx.data as `0x${string}` })
    const [commands, inputs, deadline] = dec.args as [`0x${string}`, readonly `0x${string}`[], bigint]
    const cr = exp.creator
    if (cr) {
      if (!feeOn) reasons.push('A creator share rides only on a fee-bearing swap — refusing.')
      if (cr.bps <= 0 || cr.bps !== creatorBpsFor(feeBps)) reasons.push(`The creator share (${cr.bps}bps) is not half of the ${feeBps}bps tier — refusing.`)
      if (payableCreator(cr.address, cr.payer, [exp.universalRouter, exp.permit2]) !== cr.address.toLowerCase()) reasons.push('The creator address is not a distinct, payable party — refusing.')
      if (stableSideOf(exp.chainId, exp.sellToken, exp.buyToken) !== 'out') reasons.push('The creator share is not in a stable output — refusing.')
    }
    const wantCommands = feeOn ? (cr ? UR_COMMANDS_FEE_CREATOR : UR_COMMANDS_FEE) : UR_COMMANDS
    const wantInputs = feeOn ? (cr ? 4 : 3) : 1
    if (commands.toLowerCase() !== wantCommands) {
      reasons.push(
        feeOn
          ? `Router commands are ${commands}, not V4_SWAP→${cr ? 'PAY_PORTION→' : ''}PAY_PORTION→SWEEP — refusing.`
          : `Router commands are ${commands}, not the single V4_SWAP — refusing.`,
      )
    }
    if (inputs.length !== wantInputs) reasons.push(`Expected ${wantInputs} router input(s), got ${inputs.length}.`)
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) reasons.push('The swap deadline is already in the past.')
    const split = v4OutputSplit(exp.minOut, feeBps, cr)
    if (feeOn && cr && inputs.length === 4) {
      // The creator's PAY_PORTION: the output token, the resolved creator,
      // exactly half the tier.
      try {
        const [cToken, cRecipient, cBips] = decodeAbiParameters([...ADDRESS_ADDRESS_UINT_PARAMS], inputs[1]) as [string, string, bigint]
        if (!eqAddr(cToken, exp.buyToken)) reasons.push('The creator PAY_PORTION is for a different token than the buy token.')
        if (!eqAddr(cRecipient, cr.address)) reasons.push('The creator PAY_PORTION does not pay the resolved creator — refusing.')
        if (cBips !== BigInt(cr.bps)) reasons.push(`The creator PAY_PORTION bips (${cBips}) is not the creator's share (${cr.bps}).`)
      } catch {
        reasons.push('Could not decode the creator PAY_PORTION input — refusing.')
      }
    }
    if (feeOn && inputs.length === wantInputs) {
      const feeAt = cr ? 2 : 1
      // PAY_PORTION(token, recipient, bips): the output token, the PINNED
      // treasury (compared against lib/fees' own constant, never a caller
      // field), exactly the priced tier.
      try {
        const [pToken, pRecipient, pBips] = decodeAbiParameters([...ADDRESS_ADDRESS_UINT_PARAMS], inputs[feeAt]) as [string, string, bigint]
        if (!eqAddr(pToken, exp.buyToken)) reasons.push('PAY_PORTION is for a different token than the buy token.')
        if (!eqAddr(pRecipient, TREASURY_ADDRESS)) reasons.push('The fee recipient is not the Pantessa treasury — refusing.')
        if (pBips !== BigInt(split.treasuryBps)) reasons.push(`PAY_PORTION bips (${pBips}) is not the treasury's share (${split.treasuryBps}).`)
      } catch {
        reasons.push('Could not decode the PAY_PORTION input — refusing.')
      }
      // SWEEP(token, recipient, amountMin): the rest of the output to the
      // SENDER sentinel — the payer by construction — with the post-fee
      // minimum enforced on-chain.
      try {
        const [sToken, sRecipient, sMin] = decodeAbiParameters([...ADDRESS_ADDRESS_UINT_PARAMS], inputs[feeAt + 1]) as [string, string, bigint]
        if (!eqAddr(sToken, exp.buyToken)) reasons.push('SWEEP is for a different token than the buy token.')
        if (!eqAddr(sRecipient, SENTINEL_MSG_SENDER)) reasons.push('SWEEP does not pay the transaction sender — refusing.')
        if (sMin !== split.sweepMin) reasons.push('The SWEEP minimum is not the post-fee quoted bound.')
      } catch {
        reasons.push('Could not decode the SWEEP input — refusing.')
      }
    }
    const input = inputs[0]
    if (input) {
      const [actions, params] = decodeAbiParameters([...ACTIONS_ENVELOPE_PARAMS], input) as [
        `0x${string}`,
        readonly `0x${string}`[],
      ]
      if (actions.toLowerCase() !== (feeOn ? V4_ACTIONS_FEE : V4_ACTIONS)) {
        reasons.push(
          feeOn
            ? `v4 actions are ${actions}, not swap→settle-all→take(router) — refusing.`
            : `v4 actions are ${actions}, not swap→settle-all→take-all — refusing.`,
        )
      } else if (params.length !== 3) {
        reasons.push(`Expected 3 action params, got ${params.length}.`)
      } else {
        const [sp] = decodeAbiParameters([EXACT_IN_SINGLE_PARAM], params[0]) as [
          {
            poolKey: V4PoolKey
            zeroForOne: boolean
            amountIn: bigint
            amountOutMinimum: bigint
            hookData: `0x${string}`
          },
        ]
        const k = sp.poolKey
        const expectIn = exp.poolKey
        if (!eqAddr(k.currency0, expectIn.currency0) || !eqAddr(k.currency1, expectIn.currency1)) {
          reasons.push('The pool currencies do not match the quoted pair.')
        }
        if (k.fee !== expectIn.fee || k.tickSpacing !== expectIn.tickSpacing) {
          reasons.push('The pool fee/tickSpacing does not match the quoted pool.')
        }
        const pp = exp.policyPool
        if (!pp) {
          if (!eqAddr(k.hooks, ZERO_HOOKS)) reasons.push('The pool has a hook contract — only no-hook pools are allowed.')
        } else {
          // THE POLICY POOL: the ONE hooked pool the desk is allowed to route
          // through. The hook must be the pinned one (and the one the key was
          // quoted with), and the hookData must be the desk's own attestation.
          if (!eqAddr(k.hooks, pp.hook)) reasons.push('The pool hook is not the pinned policy pool hook — refusing.')
          if (!eqAddr(expectIn.hooks, pp.hook)) reasons.push('The quoted pool key does not carry the pinned policy pool hook — refusing.')
          if (poolIdFor(k).toLowerCase() !== pp.poolId.toLowerCase()) reasons.push('The swap pool key does not hash to the pinned policy pool id — refusing.')
          reasons.push(...policyPoolHookDataReasons(sp.hookData, sp.zeroForOne, sp.amountIn, pp))
        }
        const currencyIn = sp.zeroForOne ? k.currency0 : k.currency1
        const currencyOut = sp.zeroForOne ? k.currency1 : k.currency0
        if (!eqAddr(currencyIn, exp.sellToken)) reasons.push('The swap direction does not sell the asked token.')
        if (!eqAddr(currencyOut, exp.buyToken)) reasons.push('The swap direction does not buy the asked token.')
        if (sp.amountIn !== exp.amountIn) reasons.push('The swap amountIn is not exactly the asked amount.')
        if (sp.amountOutMinimum !== exp.minOut) reasons.push('The swap minimum-out does not match the quoted bound.')
        if (!exp.policyPool && sp.hookData !== '0x') reasons.push('Unexpected hookData on the swap — refusing.')
        const [settleCur, settleAmt] = decodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], params[1]) as [string, bigint]
        if (!eqAddr(settleCur, exp.sellToken)) reasons.push('SETTLE_ALL is for a different currency than the sell token.')
        if (settleAmt !== exp.amountIn) reasons.push('SETTLE_ALL max does not match the swap amount.')
        if (feeOn) {
          // TAKE(currency, recipient, amount): full credit to the ROUTER
          // sentinel only — an explicit address here would divert the whole
          // output before the split. The slippage bound lives in the swap
          // action's amountOutMinimum (verified above) and in SWEEP's min.
          try {
            const [takeCur, takeRecipient, takeAmt] = decodeAbiParameters([...ADDRESS_ADDRESS_UINT_PARAMS], params[2]) as [string, string, bigint]
            if (!eqAddr(takeCur, exp.buyToken)) reasons.push('TAKE is for a different currency than the buy token.')
            if (!eqAddr(takeRecipient, SENTINEL_ADDRESS_THIS)) reasons.push('TAKE does not credit the router for the fee split — refusing.')
            if (takeAmt !== OPEN_DELTA) reasons.push('TAKE must take the full credit (OPEN_DELTA) — refusing.')
          } catch {
            reasons.push('Could not decode the TAKE params — refusing.')
          }
        } else {
          const [takeCur, takeAmt] = decodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], params[2]) as [string, bigint]
          if (!eqAddr(takeCur, exp.buyToken)) reasons.push('TAKE_ALL is for a different currency than the buy token.')
          if (takeAmt !== exp.minOut) reasons.push('TAKE_ALL minimum does not match the quoted bound.')
        }
      }
    }
  } catch {
    reasons.push('Could not decode the Universal Router calldata — refusing to offer an opaque transaction.')
  }

  return { ok: reasons.length === 0, reasons }
}

// ── Standalone quote (no build) ─────────────────────────────────────────────

/**
 * Best exact-in output across the standard no-hook v4 pool keys, or null when
 * no pool quotes the pair. Used by the dollar-amount price probe for tokens
 * that only trade on v4 (Robinhood's tokenized stocks); the swap build keeps
 * its own inline scan because it also needs the winning pool key.
 */
export async function quoteV4BestOut(
  chainId: number,
  sellAddr: `0x${string}`,
  buyAddr: `0x${string}`,
  amountIn: bigint,
): Promise<bigint | null> {
  const chain = chainById(chainId)
  const v4 = chain?.uniswapV4
  const client = publicClientFor(chainId)
  if (!chain || !v4 || !client || amountIn <= BigInt(0) || amountIn > UINT128_MAX) return null
  const [currency0, currency1] =
    sellAddr.toLowerCase() < buyAddr.toLowerCase() ? [sellAddr, buyAddr] : [buyAddr, sellAddr]
  const zeroForOne = currency0.toLowerCase() === sellAddr.toLowerCase()
  const quotes = await Promise.all(
    V4_POOL_KEYS.map(async ({ fee, tickSpacing }): Promise<bigint | null> => {
      try {
        const { result } = await client.simulateContract({
          address: v4.quoter,
          abi: V4_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: { currency0, currency1, fee, tickSpacing, hooks: ZERO_HOOKS },
              zeroForOne,
              exactAmount: amountIn,
              hookData: '0x',
            },
          ],
        })
        return result[0]
      } catch {
        return null
      }
    }),
  )
  const live = quotes.filter((q): q is bigint => q !== null && q > BigInt(0))
  return live.length ? live.reduce((a, b) => (b > a ? b : a)) : null
}

// ── Executability probe ─────────────────────────────────────────────────────

/**
 * Can this pool actually EXECUTE a swap from a direct Universal Router call?
 * Simulates the SWAP action alone (no settle/take — needs no balances or
 * allowances from `from`). A healthy pool always reverts WITH data
 * (`CurrencyNotSettled`/`V4TooLittleReceived` — deltas are left unsettled by
 * design); a venue-gated pool (Robinhood tokenized stocks) bare-reverts with
 * EMPTY data before the pool math runs. Returns:
 *   'ok'      — revert carried data (or the call somehow passed): executable
 *   'gated'   — positive execution revert with empty data: NOT executable
 *   'unknown' — transport trouble (timeout/rate-limit): fail OPEN; the
 *               /api/tx/refresh estimateGas gate still backstops at sign time.
 */
async function probeV4Executability(
  client: NonNullable<ReturnType<typeof publicClientFor>>,
  universalRouter: `0x${string}`,
  plan: V4SwapPlan,
  from: `0x${string}`,
): Promise<'ok' | 'gated' | 'unknown'> {
  const swapParams = encodeAbiParameters(
    [EXACT_IN_SINGLE_PARAM],
    [
      {
        poolKey: plan.poolKey,
        zeroForOne: plan.zeroForOne,
        amountIn: plan.amountIn,
        amountOutMinimum: plan.minOut,
        hookData: plan.hookData ?? '0x',
      },
    ],
  )
  const v4Input = encodeAbiParameters(
    [...ACTIONS_ENVELOPE_PARAMS],
    [`0x${ACTION_SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, '0')}`, [swapParams]],
  )
  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [`0x${UR_COMMAND_V4_SWAP.toString(16).padStart(2, '0')}`, [v4Input], BigInt(plan.deadline)],
  })
  try {
    await client.call({ account: from, to: universalRouter, data })
    return 'ok'
  } catch (err) {
    const cause = err instanceof Error && 'walk' in err && typeof (err as { walk?: unknown }).walk === 'function'
      ? (err as { walk: (fn: (e: unknown) => boolean) => unknown }).walk((e) => !!e && typeof e === 'object' && 'data' in (e as object))
      : null
    const revertData = cause && typeof cause === 'object' && 'data' in cause ? (cause as { data?: unknown }).data : undefined
    if (typeof revertData === 'string' && revertData.length > 2) return 'ok'
    const msg = err instanceof Error ? err.message : ''
    // Only a positive "execution reverted" with no data means gated — RPC
    // flakiness must not block good builds.
    if (/execution reverted|revert/i.test(msg)) return 'gated'
    return 'unknown'
  }
}

// ── The builder ─────────────────────────────────────────────────────────────

export interface UniswapV4SwapParams {
  sellToken: string
  buyToken: string
  /** Human units — converted with real decimals. */
  amountHuman: string
  from: string
  chainId: number
  slippageBps?: number
  deadlineSec?: number
  /** Fee tier in bps (default SWAP_FEE_BPS; link-originated turns pass
   *  LINK_SWAP_FEE_BPS) — same contract as the v3 builder. Rides the
   *  Universal Router's PAY_PORTION/SWEEP split and must ride the refresh
   *  recipe too so a re-quote keeps the tier. 0 = fee off. */
  feeBps?: number
  /** The link creator this wallet's swap pays, ALREADY RESOLVED SERVER-SIDE
   *  (lib/creator-split). Paid inside the swap only when the OUTPUT is a
   *  registry stable (a sell); a stable-in v4 swap keeps the ledger. */
  creator?: string | null
}

export interface UniswapV4Built {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  /** 1–3 steps: [token→Permit2 approve?, Permit2→router approve?, swap]. */
  steps: V4BuiltStep[]
  minimumOut: string
  poolFee: number
  /** Set when this swap pays its link creator on-chain. */
  creatorPaid?: CreatorPaid
}

/**
 * Build a guardrailed Uniswap v4 swap chain. Throws NoV4PoolError when no
 * no-hook pool quotes the pair (the route turns that into an honest reply).
 * A guard failure comes back as a BLOCK-level check (`blocked: true`) — the
 * route refuses the turn and the artifact is withheld, same as v3.
 */
export async function buildUniswapV4Swap(params: UniswapV4SwapParams): Promise<UniswapV4Built> {
  const slippageBps = params.slippageBps ?? UNI_DEFAULT_SLIPPAGE_BPS
  const deadlineSec = params.deadlineSec ?? UNI_DEADLINE_SEC
  const chain = chainById(params.chainId)
  if (!chain) throw new Error(`Chain ${params.chainId} isn't one of Pantessa's supported chains.`)
  const v4 = chain.uniswapV4
  if (!v4) throw new Error(`Uniswap v4 isn't wired on ${chain.name}.`)
  const chainId = chain.id
  const client = publicClientFor(chainId)
  if (!client) throw new Error(`No RPC client configured for ${chain.name}.`)
  const from = params.from as `0x${string}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('A valid wallet address is required.')

  // Native ETH stays out of the v4 fallback: the wrapped-native v3 pools are
  // the ETH venue on every chain we quote, and v4's native-currency settle
  // path is a different (unguarded-here) shape. Symbols like "ETH" resolve
  // to the wrapped token address and sell as ERC-20.
  //
  // A BUY of "ETH" is refused here instead: this build would pay WETH under
  // an ETH label, and there is no guarded unwrap in it. Only v3 unwraps to
  // native ETH (lib/uniswap-venue.ts). Probed on Robinhood Chain 2026-09-16:
  // v3 quotes USDG, AAPL, TSLA, NVDA, AMD and SPY into WETH and v4 quoted none
  // of the stock pairs. An ETH buy reaches this line when v3 has no pool, or
  // when a stock → WETH v3 pool is off the tape (lib/stock-tape); LiFi
  // refuses the same buy after it, so the cascade builds nothing.
  if (buysNativeEth(params.buyToken, chainId)) {
    throw new NoV4PoolError(
      `Uniswap v4 on ${chain.name} can't deliver native ETH, and Uniswap v3 has no pool for ${tokenLabel(params.sellToken, chainId)} → ETH there.`,
    )
  }
  const sellAddr = resolveToken(params.sellToken, chainId) as `0x${string}` | null
  const buyAddr = resolveToken(params.buyToken, chainId) as `0x${string}` | null
  if (!sellAddr) throw new UnknownTokenError('sell', params.sellToken, chain.name)
  if (!buyAddr) throw new UnknownTokenError('buy', params.buyToken, chain.name)
  if (sellAddr === buyAddr) throw new Error('sellToken and buyToken must differ.')
  const sellDec = tokenDecimals(params.sellToken, chainId) ?? 18
  const buyDec = tokenDecimals(params.buyToken, chainId) ?? 18
  const atoms = humanToAtoms(params.amountHuman, sellDec)
  if (!atoms) throw new Error(`Couldn't read the amount "${params.amountHuman}" (${sellDec} decimals max).`)
  const amountIn = BigInt(atoms)
  // v4 swap amounts ride uint128 (and Permit2's uint160) — refuse overflow
  // instead of truncating money.
  if (amountIn > UINT128_MAX) throw new Error('Amount too large for a v4 swap.')

  // v4 pool keys sort the pair: currency0 < currency1 numerically.
  const [currency0, currency1] =
    sellAddr.toLowerCase() < buyAddr.toLowerCase() ? [sellAddr, buyAddr] : [buyAddr, sellAddr]
  const zeroForOne = currency0.toLowerCase() === sellAddr.toLowerCase()
  // Robinhood Chain stock swaps are checked against the tape (lib/stock-tape);
  // the read rides alongside the quote.
  const tapeRead = startSwapTape({ chainId, sellToken: params.sellToken, buyToken: params.buyToken })

  // Quote across the standard no-hook pool keys — best amountOut wins.
  const quotes = await Promise.all(
    V4_POOL_KEYS.map(async ({ fee, tickSpacing }): Promise<{ fee: number; tickSpacing: number; amountOut: bigint } | null> => {
      try {
        const { result } = await client.simulateContract({
          address: v4.quoter,
          abi: V4_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              poolKey: { currency0, currency1, fee, tickSpacing, hooks: ZERO_HOOKS },
              zeroForOne,
              exactAmount: amountIn,
              hookData: '0x',
            },
          ],
        })
        return { fee, tickSpacing, amountOut: result[0] }
      } catch {
        return null
      }
    }),
  )
  const live = quotes
    .filter((q): q is { fee: number; tickSpacing: number; amountOut: bigint } => q !== null && q.amountOut > BigInt(0))
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))
  if (live.length === 0) {
    throw new NoV4PoolError(
      `No Uniswap v4 pool on ${chain.name} can fill ${tokenLabel(params.sellToken, chainId)} → ${tokenLabel(params.buyToken, chainId)} for this amount.`,
    )
  }
  const best = live[0]
  // The slippage bound is measured from this pool's own quote — a pool far
  // from the stock's tape is refused here, before the executability probe
  // (OffTapeError: the cascade tries the chain's own venue next).
  const tapeCheck = checkFillAgainstTape(await tapeRead, "Robinhood Chain's Uniswap v4 pool", amountIn, best.amountOut)
  const minOut = (best.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec
  // Permit2 grant outlives the swap deadline by an hour — enough for slow
  // approval mining, small enough to be a real bound (not an open grant).
  const permit2Expiration = deadline + 3600
  const poolKey: V4PoolKey = { currency0, currency1, fee: best.fee, tickSpacing: best.tickSpacing, hooks: ZERO_HOOKS }

  // Pantessa fee (lib/fees.ts) via the router's own PAY_PORTION/SWEEP split —
  // the v4 mirror of v3's sweepTokenWithFee. Fee off (bps 0) → the classic
  // take-all build.
  const feeBps = params.feeBps ?? SWAP_FEE_BPS
  const feeOn = feeBps > 0
  // The creator's half, in the stable the swap pays out (lib/creator-split).
  let creatorPaid: CreatorPaid | undefined
  {
    const address = feeOn ? payableCreator(params.creator, from, [v4.universalRouter, v4.permit2]) : null
    const bps = creatorBpsFor(feeBps)
    if (address && bps > 0 && stableSideOf(chainId, sellAddr, buyAddr) === 'out') creatorPaid = { address, bps, side: 'out' }
  }
  const minOutAfterFee = feeOn ? v4OutputSplit(minOut, feeBps, creatorPaid).sweepMin : minOut

  // Quoting is NOT executing: Robinhood's tokenized-stock pools price fine on
  // the Quoter but a direct Universal Router swap bare-reverts (their stock
  // venue is the backend-signed DexAggregator, not public UR calls). Refuse
  // BEFORE any signature is requested — never burn a Permit2 grant on a swap
  // that can never land.
  const executability = await probeV4Executability(client, v4.universalRouter, { poolKey, zeroForOne, amountIn, minOut, deadline }, from)
  if (executability === 'gated') {
    throw new GatedV4PoolError(
      `${tokenLabel(params.sellToken, chainId)} → ${tokenLabel(params.buyToken, chainId)} quotes on Uniswap v4 on ${chain.name}, but the pool only executes through ${chain.name}'s own swap venue — a direct Uniswap swap can't fill it.`,
    )
  }

  const sellLabel = tokenLabel(params.sellToken, chainId)
  const buyLabel = tokenLabel(params.buyToken, chainId)

  // Allowance reads — both hops, concurrently.
  const [erc20Allowance, permit2Allowance] = await Promise.all([
    client.readContract({ address: sellAddr, abi: erc20Abi, functionName: 'allowance', args: [from, v4.permit2] }),
    client.readContract({ address: v4.permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [from, sellAddr, v4.universalRouter] }),
  ])
  const nowSec = Math.floor(Date.now() / 1000)
  const needsErc20Approve = erc20Allowance < amountIn
  const p2Amount = permit2Allowance[0]
  const p2Expiration = Number(permit2Allowance[1])
  const needsPermit2Approve = p2Amount < amountIn || p2Expiration <= nowSec
  if (amountIn > UINT160_MAX) throw new Error('Amount too large for a Permit2 grant.') // unreachable after the uint128 gate; belt and suspenders

  const steps: V4BuiltStep[] = []
  if (needsErc20Approve) {
    steps.push({
      label: 'approve',
      title: `Approve ${sellLabel} to Permit2`,
      tx: {
        to: sellAddr,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [v4.permit2, amountIn] }),
        value: '0',
        chainId,
        action: 'approve',
      },
    })
  }
  if (needsPermit2Approve) {
    steps.push({
      label: 'permit',
      title: `Allow Uniswap's router to pull ${params.amountHuman} ${sellLabel} (Permit2)`,
      tx: {
        to: v4.permit2,
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [sellAddr, v4.universalRouter, amountIn, permit2Expiration],
        }),
        value: '0',
        chainId,
        action: 'approve',
      },
    })
  }
  steps.push({
    label: 'swap',
    title: `Swap ${params.amountHuman} ${sellLabel} → ${buyLabel}`,
    tx: {
      to: v4.universalRouter,
      data: encodeV4SwapCalldata({ poolKey, zeroForOne, amountIn, minOut, deadline, feeBps: feeOn ? feeBps : 0, ...(creatorPaid ? { creator: creatorPaid } : {}) }),
      value: '0',
      chainId,
      action: 'swap',
    },
    // The execute reverts past this — the card must re-quote before then.
    validUntil: deadline,
  })

  // ── The guard: decode what we just built; refuse the turn on any mismatch.
  const guard = guardUniswapV4Build(steps, {
    chainId,
    universalRouter: v4.universalRouter,
    permit2: v4.permit2,
    sellToken: sellAddr,
    buyToken: buyAddr,
    amountIn,
    minOut,
    poolKey,
    permit2Expiration,
    feeBps: feeOn ? feeBps : 0,
    ...(creatorPaid ? { creator: { address: creatorPaid.address, bps: creatorPaid.bps, payer: from } } : {}),
  })
  const calldataCheck: GuardrailCheck = {
    id: 'calldata',
    level: 'block',
    ok: guard.ok,
    note: guard.ok
      ? `Calldata verified: Universal Router ${v4.universalRouter.slice(0, 8)}…, exactly ${params.amountHuman} ${sellLabel} in, output to the payer${feeOn ? ' minus the treasury split' : ''} (no-hook ${best.fee / 100}bps pool).`
      : `Build failed verification: ${guard.reasons.join(' ')}`,
  }
  const feeCheck: GuardrailCheck = {
    id: 'fee',
    level: 'warn',
    ok: true,
    note: feeOn
      ? `Pantessa fee: ${feeBps / 100}% of the output, split by the router's own PAY_PORTION command to the Pantessa treasury — visible in the router calldata, minimum received shown post-fee.`
      : 'No Pantessa fee on this swap.',
  }

  const approvalNote =
    steps.length === 3
      ? `Two approvals attached (${sellLabel} → Permit2, then Permit2 → router) — v4 pulls funds through Permit2.`
      : steps.length === 2
        ? steps[0].label === 'approve'
          ? `One approval attached (${sellLabel} → Permit2); the router grant is already in place.`
          : `One Permit2 grant attached — the ${sellLabel} → Permit2 allowance is already in place.`
        : 'All approvals already in place.'
  const allowanceCheck: GuardrailCheck = { id: 'allowance', level: 'warn', ok: steps.length === 1, note: approvalNote }

  // ── Cross-app guardrails: identical gate to v3, same policy host. ─────────
  const checks: GuardrailCheck[] = [recipientCheck(from, from), validityCheck(deadline), allowanceCheck, calldataCheck, feeCheck, ...(tapeCheck ? [tapeCheck] : [])]
  // Same valuation as v3 (lib/usd-probe swapValueUsd), loaded lazily for the
  // same reason: usd-probe imports this module for its v4 quote.
  const { swapValueUsd } = await import('@/lib/usd-probe')
  const valueUsd = await swapValueUsd(
    chainId,
    { token: params.sellToken, address: sellAddr, atoms: amountIn, decimals: sellDec },
    { token: params.buyToken, address: buyAddr, atoms: best.amountOut, decimals: buyDec },
  )
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, UNISWAP_POLICY_HOST, spentTotal, { selfSigned: true })
  checks.push(polCheck)
  const guardrails = buildReport(valueUsd, checks, violation ? { violation, valueUsd, host: UNISWAP_POLICY_HOST } : null)
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: UNISWAP_POLICY_HOST,
      serviceName: 'Uniswap',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (uniswap v4 swap)`,
    })
  }

  const outHuman = formatAtoms(best.amountOut.toString(), buyDec)
  // Honest minimum: what the USER receives after the treasury split, not the
  // pool-level bound (v3's convention).
  const minHuman = formatAtoms(minOutAfterFee.toString(), buyDec)
  const feeNote = feeOn ? (creatorPaid ? `, incl. ${feeBps / 100}% Pantessa fee, half paid to the link's creator` : `, incl. ${feeBps / 100}% Pantessa fee on the output`) : ''
  const summary = `Swap ${formatAtoms(amountIn.toString(), sellDec)} ${sellLabel} → ~${outHuman} ${buyLabel} via Uniswap v4 on ${chain.name} (${best.fee / 100}bps pool), min received ${minHuman} (${slippageBps}bps slippage${feeNote})`

  return { summary, guardrails, blocked: !guardrails.ok, steps, minimumOut: minHuman, poolFee: best.fee, ...(creatorPaid ? { creatorPaid } : {}) }
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE POLICY POOL — the gated-pool mode of this builder (BUILDER lane,
//  squad policy-pool 2026-11-02; contract in
//  /Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md).
//
//  ONE hooked v4 pool (lib/policy-pool/config) whose hook refuses every swap
//  that does not carry an attestation signed by the desk's policy signer.
//  The build is the no-hook build above with three differences:
//    1. the desk POLICY runs first (lib/policy-pool/policy policyDecision —
//       the per-order cap, the pinned pool) and a refusal returns a typed
//       refusal with no artifact;
//    2. the policy signer attests THIS intent, THIS pool, THIS swapper, THIS
//       side, THIS size, for ten minutes (lib/policy-pool/attestation), and
//       the attestation rides in hookData — the quote and the swap both carry
//       it, because the hook runs inside the Quoter's simulation too;
//    3. the guard (guardPolicyPoolBuild) re-decodes the hookData and refuses
//       unless every attested field equals what the desk asked for and the
//       signature recovers to the pinned signer.
//  The no-hook path above is untouched: a hook or hookData anywhere else
//  still refuses. Exact-in, ERC-20 in only (the pool's native side is the
//  OUTPUT — "Buy $25 of ETH"): selling native ETH needs the value-carrying
//  settle shape this guard does not accept, so it refuses by name.
//  Every step writes its ledger row (lib/policy-pool/ledger) and the ledger
//  never blocks a build.
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyPoolSwapParams extends UniswapV4SwapParams {
  /** The desk intent id (BrokerIntent.id / job id / a minted chat id). Hashed on-chain; single use. */
  intentId: string
  /** Provenance, emitted verbatim in DeskFill: `dune:<queryId>` or `desk:<intentId>` (lib/policy-pool/venue). */
  origin: string
  /** The wallet the attestation binds as tx.origin; null = bearer (smart-account custody). */
  swapper: Address | null
}

/** The desk said no (or could not say yes): nothing was built, nothing to sign. */
export interface PolicyPoolRefusal {
  refused: true
  /** `policy` = the desk policy refused (cap / wrong pool); `config` = the pool
   *  is not deployed or half-configured; `venue` = the ask does not fit the
   *  pool (pair, side, chain). */
  kind: 'policy' | 'config' | 'venue'
  reason: string
  capUsd?: number
  buildPath: typeof POLICY_POOL_BUILD_PATH
}

export interface PolicyPoolBuilt extends UniswapV4Built {
  refused?: undefined
  chainId: number
  poolId: Hex
  hook: Address
  hookData: Hex
  attestation: { intentId: Hex; deskIntentId: string; swapper: Address; zeroForOne: boolean; maxAmountIn: string; expiry: number; origin: string }
  usd: number
  buildPath: typeof POLICY_POOL_BUILD_PATH
}

const refusal = (kind: PolicyPoolRefusal['kind'], reason: string, capUsd?: number): PolicyPoolRefusal => ({
  refused: true,
  kind,
  reason,
  ...(capUsd !== undefined ? { capUsd } : {}),
  buildPath: POLICY_POOL_BUILD_PATH,
})

export function isPolicyPoolRefusal(v: PolicyPoolBuilt | PolicyPoolRefusal): v is PolicyPoolRefusal {
  return (v as PolicyPoolRefusal).refused === true
}

/** The envelopes a hook revert travels in on its way out: the PoolManager
 *  wraps a failed hook call (v4-core CustomRevert.bubbleUpAndRevertWith →
 *  WrappedError), the V4 Quoter wraps anything that is not its own QuoteSwap
 *  (UnexpectedRevertBytes), and the Universal Router wraps a failed command
 *  (ExecutionFailed). Each carries the inner bytes verbatim. */
const REVERT_ENVELOPE_ABI = [
  { type: 'error', name: 'WrappedError', inputs: [{ name: 'target', type: 'address' }, { name: 'selector', type: 'bytes4' }, { name: 'reason', type: 'bytes' }, { name: 'details', type: 'bytes' }] },
  { type: 'error', name: 'UnexpectedRevertBytes', inputs: [{ name: 'revertData', type: 'bytes' }] },
  { type: 'error', name: 'ExecutionFailed', inputs: [{ name: 'commandIndex', type: 'uint256' }, { name: 'message', type: 'bytes' }] },
] as const

/** Peel every known envelope off revert data; the innermost bytes come back. */
export function unwrapRevertData(data: Hex, depth = 0): Hex {
  if (depth > 6 || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return data
  try {
    const dec = decodeErrorResult({ abi: REVERT_ENVELOPE_ABI, data })
    const inner = dec.errorName === 'WrappedError' ? (dec.args[2] as Hex) : dec.errorName === 'UnexpectedRevertBytes' ? (dec.args[0] as Hex) : (dec.args[1] as Hex)
    return typeof inner === 'string' && inner.length >= 10 ? unwrapRevertData(inner, depth + 1) : data
  } catch {
    return data
  }
}

/** The hook's own revert, by name (NotAttested, BadSigner, OverSize, …), read
 *  off raw revert data or any viem error chain — through the PoolManager /
 *  Quoter / Universal Router envelopes — or null when the revert is not the hook's. */
export function policyPoolRevertName(err: unknown): string | null {
  let data: unknown = typeof err === 'string' ? err : undefined
  if (data === undefined) {
    const walk = err instanceof Error && 'walk' in err && typeof (err as { walk?: unknown }).walk === 'function'
      ? (err as { walk: (fn: (e: unknown) => boolean) => unknown }).walk((e) => !!e && typeof e === 'object' && 'data' in (e as object))
      : null
    data = walk && typeof walk === 'object' && 'data' in walk ? (walk as { data?: unknown }).data : undefined
  }
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return null
  try {
    return decodeErrorResult({ abi: POLICY_POOL_HOOK_ABI, data: unwrapRevertData(data as Hex) }).errorName
  } catch {
    return null
  }
}

/** The pool currency an ask's token names, or null when it is neither side.
 *  The pool is two currencies by address; a symbol is read against the
 *  chain's registry (first-class chains) or the pinned testnet USDC — and
 *  "ETH" means the native side when the pool has one. */
function policyPoolCurrencyFor(token: string, cfg: PolicyPoolConfig): Address | null {
  const t = token.trim()
  const sides = [cfg.poolKey.currency0, cfg.poolKey.currency1]
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return sides.find((s) => s.toLowerCase() === t.toLowerCase()) ?? null
  const sym = t.toUpperCase()
  const hasNative = sides.some((s) => s.toLowerCase() === NATIVE_CURRENCY)
  if (sym === 'ETH' && hasNative) return NATIVE_CURRENCY
  if (cfg.chainId === BASE_SEPOLIA_CHAIN_ID) {
    if (sym === 'USDC') return sides.find((s) => s.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase()) ?? null
    return null
  }
  const resolved = resolveToken(sym, cfg.chainId)
  return resolved ? (sides.find((s) => s.toLowerCase() === resolved.toLowerCase()) ?? null) : null
}

const ERC20_DECIMALS_CACHE = new Map<string, number>()
async function currencyDecimals(client: NonNullable<ReturnType<typeof policyPoolClient>>, chainId: number, currency: Address): Promise<number> {
  if (currency.toLowerCase() === NATIVE_CURRENCY) return 18
  const key = `${chainId}:${currency.toLowerCase()}`
  const hit = ERC20_DECIMALS_CACHE.get(key)
  if (hit !== undefined) return hit
  const d = Number(await client.readContract({ address: currency, abi: erc20Abi, functionName: 'decimals' }))
  ERC20_DECIMALS_CACHE.set(key, d)
  return d
}

/** Is this currency a $1 stable on the pool's chain? Prices the order for the cap. */
function policyPoolStable(currency: Address, cfg: PolicyPoolConfig): boolean {
  if (cfg.chainId === BASE_SEPOLIA_CHAIN_ID) return currency.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase()
  return chainById(cfg.chainId)?.stables[currency.toLowerCase()] !== undefined
}

function policyPoolLabel(currency: Address, cfg: PolicyPoolConfig): string {
  if (currency.toLowerCase() === NATIVE_CURRENCY) return 'ETH'
  if (cfg.chainId === BASE_SEPOLIA_CHAIN_ID) return currency.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase() ? 'USDC' : `${currency.slice(0, 6)}…`
  return tokenLabel(currency, cfg.chainId)
}

/**
 * Verify a policy-pool step chain: the no-hook guard with the policy-pool
 * expectation, plus the one check that cannot be synchronous — the
 * attestation signature recovered from the DECODED hookData against the
 * pinned signer (viem's recovery is async). Fail-closed: a swap step whose
 * calldata does not expose its hookData verifies as `false`.
 */
export async function guardPolicyPoolBuild(
  steps: V4BuiltStep[],
  exp: Omit<V4GuardExpectations, 'policyPool'> & { policyPool: Omit<V4PolicyPoolExpectation, 'signatureVerified'> },
): Promise<V4GuardResult> {
  let signatureVerified = false
  const swap = steps[steps.length - 1]
  const hookData = swap ? swapHookDataOf(swap.tx.data as Hex) : null
  if (hookData && hookData !== '0x') {
    try {
      const { att, sig } = decodeHookData(hookData)
      signatureVerified = await verifyAttestation(att, sig, { chainId: exp.chainId, hook: exp.policyPool.hook, signer: exp.policyPool.signer })
    } catch {
      signatureVerified = false
    }
  }
  return guardUniswapV4Build(steps, { ...exp, policyPool: { ...exp.policyPool, signatureVerified } })
}

/** The swap action's hookData inside a Universal Router execute, or null when the calldata is not that shape. */
export function swapHookDataOf(data: Hex): Hex | null {
  try {
    const dec = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data })
    const [, inputs] = dec.args as [Hex, readonly Hex[], bigint]
    const [, params] = decodeAbiParameters([...ACTIONS_ENVELOPE_PARAMS], inputs[0]) as [Hex, readonly Hex[]]
    const [sp] = decodeAbiParameters([EXACT_IN_SINGLE_PARAM], params[0]) as unknown as [{ hookData: Hex }]
    return sp.hookData
  } catch {
    return null
  }
}

/**
 * Build a guarded swap THROUGH THE POLICY POOL. Returns a typed refusal (no
 * artifact) when the pool is off, the ask does not fit it, or the desk
 * policy says no; otherwise the same 1–3 step chain as the no-hook build,
 * with the signed attestation in the swap's hookData and the guard's verdict
 * as the block-level `calldata` check (`blocked: true` withholds it).
 */
export async function buildPolicyPoolSwap(params: PolicyPoolSwapParams): Promise<PolicyPoolBuilt | PolicyPoolRefusal> {
  let cfg: PolicyPoolConfig | null
  try {
    cfg = policyPoolConfig()
  } catch (err) {
    return refusal('config', `The policy pool is half-configured: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!cfg) return refusal('config', 'The policy pool is not deployed yet (POLICY_POOL_HOOK is unset) — nothing was built.')
  if (params.chainId !== cfg.chainId) {
    return refusal('venue', `The policy pool runs on ${cfg.chainName}, not ${policyPoolChainName(params.chainId)} — nothing was built.`)
  }
  const chainId = cfg.chainId
  const client = policyPoolClient(chainId)
  if (!client) return refusal('config', `No RPC client for ${cfg.chainName}.`)
  const from = params.from as Address
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('A valid wallet address is required.')
  const deskIntentId = params.intentId.trim()
  if (!deskIntentId) throw new Error('A desk intent id is required for a policy pool build.')
  const origin = params.origin.trim()
  if (!origin || origin.length > 120 || /[^\x20-\x7e]/.test(origin)) throw new Error('The policy pool origin must be short printable ASCII.')

  // The ask's pair onto the pool's two currencies.
  const sellCur = policyPoolCurrencyFor(params.sellToken, cfg)
  const buyCur = policyPoolCurrencyFor(params.buyToken, cfg)
  const pairWords = `${policyPoolLabel(cfg.poolKey.currency0, cfg)} ↔ ${policyPoolLabel(cfg.poolKey.currency1, cfg)}`
  if (!sellCur || !buyCur || sellCur === buyCur) {
    return refusal('venue', `The policy pool trades ${pairWords} only on ${cfg.chainName} — ${params.sellToken.toUpperCase()} → ${params.buyToken.toUpperCase()} isn't that pair. Nothing was built.`)
  }
  if (sellCur.toLowerCase() === NATIVE_CURRENCY) {
    return refusal('venue', `The policy pool build sells the ${policyPoolLabel(cfg.poolKey.currency1, cfg)} side for ETH (exact-in, ERC-20 in). Selling ETH into it needs the native settle path, which this build doesn't carry yet — nothing was built.`)
  }
  const sellDec = await currencyDecimals(client, chainId, sellCur)
  const buyDec = await currencyDecimals(client, chainId, buyCur)
  const atoms = humanToAtoms(params.amountHuman, sellDec)
  if (!atoms) throw new Error(`Couldn't read the amount "${params.amountHuman}" (${sellDec} decimals max).`)
  const amountIn = BigInt(atoms)
  if (amountIn <= BigInt(0)) throw new Error('The amount must be positive.')
  if (amountIn > UINT128_MAX) throw new Error('Amount too large for a v4 swap.')
  const zeroForOne = sellCur.toLowerCase() === cfg.poolKey.currency0.toLowerCase()
  const sellLabel = policyPoolLabel(sellCur, cfg)
  const buyLabel = policyPoolLabel(buyCur, cfg)
  // Dollar size for the cap: a $1 stable in prices itself; anything else has
  // no size the desk can check (policyDecision refuses by name).
  const usd = policyPoolStable(sellCur, cfg) ? Number(params.amountHuman) : NaN
  const swapper = params.swapper
  // Ledger rows name the currencies (LEDGER's page renders "25 USDC / 0.0104 ETH" from meta.currencyIn/Out).
  const ledgerBase = { intentId: deskIntentId, origin, swapper: (swapper ?? from).toLowerCase(), chainId, amountIn: amountIn.toString(), ...(Number.isFinite(usd) ? { usd } : {}) }
  const currencyMeta = { currencyIn: sellCur, currencyOut: buyCur }

  // ── 1. The desk policy ────────────────────────────────────────────────────
  const decision = policyDecision({ usd, chainId, hook: cfg.hook, poolId: cfg.poolId })
  if (!decision.allowed) {
    await recordPolicyPoolEvent({ kind: 'guard_refused', ...ledgerBase, reason: decision.reason, meta: { ...currencyMeta, capUsd: decision.capUsd, sell: sellLabel, buy: buyLabel } })
    return refusal('policy', `The desk policy refused: ${decision.reason} Nothing was built, no signature needed.`, decision.capUsd)
  }
  await recordPolicyPoolEvent({ kind: 'guard_allowed', ...ledgerBase, meta: { ...currencyMeta, capUsd: decision.capUsd, sell: sellLabel, buy: buyLabel } })

  // ── 2. The attestation ────────────────────────────────────────────────────
  const att = attestationFor({ intentId: deskIntentId, poolId: cfg.poolId, swapper, zeroForOne, maxAmountIn: amountIn, origin })
  const sig = await signAttestation(att, { chainId, hook: cfg.hook })
  const hookData = encodeHookData(att, sig)
  await recordPolicyPoolEvent({ kind: 'attested', ...ledgerBase, meta: { ...currencyMeta, expiry: Number(att.expiry), intentIdHash: att.intentId } })

  // ── 3. Quote against the hooked pool, attestation in hand ─────────────────
  // The hook runs inside the Quoter's simulation and checks tx.origin, so the
  // call is made AS the swapper (bearer attestations quote as the payer).
  const poolKey: V4PoolKey = { ...cfg.poolKey }
  let amountOut: bigint
  try {
    const { result } = await client.simulateContract({
      account: swapper ?? from,
      address: cfg.pins.quoter,
      abi: V4_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData }],
    })
    amountOut = result[0]
  } catch (err) {
    const name = policyPoolRevertName(err)
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'quote failed'
    throw new NoV4PoolError(
      name
        ? `The policy pool's hook refused the quote (${name}) for ${sellLabel} → ${buyLabel} on ${cfg.chainName}.`
        : `The policy pool couldn't quote ${sellLabel} → ${buyLabel} on ${cfg.chainName} for this amount (${msg}).`,
    )
  }
  if (amountOut <= BigInt(0)) throw new NoV4PoolError(`The policy pool quoted nothing for ${sellLabel} → ${buyLabel} on ${cfg.chainName}.`)

  const slippageBps = params.slippageBps ?? UNI_DEFAULT_SLIPPAGE_BPS
  const nowSec = Math.floor(Date.now() / 1000)
  // The swap dies at the earlier of the router deadline and the attestation's expiry.
  const deadline = Math.min(nowSec + (params.deadlineSec ?? UNI_DEADLINE_SEC), Number(att.expiry))
  const permit2Expiration = deadline + 3600
  const minOut = (amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)
  const feeBps = params.feeBps ?? SWAP_FEE_BPS
  const feeOn = feeBps > 0
  let creatorPaid: CreatorPaid | undefined
  {
    const address = feeOn ? payableCreator(params.creator, from, [cfg.pins.universalRouter, cfg.pins.permit2]) : null
    const bps = creatorBpsFor(feeBps)
    if (address && bps > 0 && stableSideOf(chainId, sellCur, buyCur) === 'out') creatorPaid = { address, bps, side: 'out' }
  }
  const minOutAfterFee = feeOn ? v4OutputSplit(minOut, feeBps, creatorPaid).sweepMin : minOut

  // Executability: the swap action alone, attestation attached. A healthy
  // pool reverts WITH data (CurrencyNotSettled); the hook's own refusals
  // carry data too and are read by name below.
  const plan: V4SwapPlan = { poolKey, zeroForOne, amountIn, minOut, deadline, hookData, feeBps: feeOn ? feeBps : 0, ...(creatorPaid ? { creator: creatorPaid } : {}) }
  const executability = await probeV4Executability(client, cfg.pins.universalRouter, plan, swapper ?? from)
  if (executability === 'gated') {
    throw new GatedV4PoolError(`The policy pool on ${cfg.chainName} refused a direct swap for ${sellLabel} → ${buyLabel} — nothing was built.`)
  }

  // ── 4. Approvals (as the no-hook build) + the swap step ───────────────────
  const [erc20Allowance, permit2Allowance] = await Promise.all([
    client.readContract({ address: sellCur, abi: erc20Abi, functionName: 'allowance', args: [from, cfg.pins.permit2] }),
    client.readContract({ address: cfg.pins.permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [from, sellCur, cfg.pins.universalRouter] }),
  ])
  const needsErc20Approve = erc20Allowance < amountIn
  const needsPermit2Approve = permit2Allowance[0] < amountIn || Number(permit2Allowance[1]) <= nowSec
  const steps: V4BuiltStep[] = []
  if (needsErc20Approve) {
    steps.push({
      label: 'approve',
      title: `Approve ${sellLabel} to Permit2`,
      tx: { to: sellCur, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [cfg.pins.permit2, amountIn] }), value: '0', chainId, action: 'approve' },
    })
  }
  if (needsPermit2Approve) {
    steps.push({
      label: 'permit',
      title: `Allow Uniswap's router to pull ${params.amountHuman} ${sellLabel} (Permit2)`,
      tx: {
        to: cfg.pins.permit2,
        data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: 'approve', args: [sellCur, cfg.pins.universalRouter, amountIn, permit2Expiration] }),
        value: '0',
        chainId,
        action: 'approve',
      },
    })
  }
  steps.push({
    label: 'swap',
    title: `Swap ${params.amountHuman} ${sellLabel} → ${buyLabel} through the policy pool`,
    tx: { to: cfg.pins.universalRouter, data: encodeV4SwapCalldata(plan), value: '0', chainId, action: 'swap' },
    validUntil: deadline,
  })

  // ── 5. The guard: decode what we just built, recover the signer ───────────
  const guard = await guardPolicyPoolBuild(steps, {
    chainId,
    universalRouter: cfg.pins.universalRouter,
    permit2: cfg.pins.permit2,
    sellToken: sellCur,
    buyToken: buyCur,
    amountIn,
    minOut,
    poolKey,
    permit2Expiration,
    feeBps: feeOn ? feeBps : 0,
    ...(creatorPaid ? { creator: { address: creatorPaid.address, bps: creatorPaid.bps, payer: from } } : {}),
    policyPool: { hook: cfg.hook, poolId: cfg.poolId, signer: cfg.signer, intentId: att.intentId, swapper: att.swapper, zeroForOne, maxAmountIn: amountIn, origin },
  })
  const calldataCheck: GuardrailCheck = {
    id: 'calldata',
    level: 'block',
    ok: guard.ok,
    note: guard.ok
      ? `Calldata verified: Universal Router ${cfg.pins.universalRouter.slice(0, 8)}…, exactly ${params.amountHuman} ${sellLabel} in, output to the payer${feeOn ? ' minus the treasury split' : ''}, the policy pool's hook ${cfg.hook.slice(0, 8)}… with the desk's attestation (signer ${cfg.signer.slice(0, 8)}…) in hookData.`
      : `Build failed verification: ${guard.reasons.join(' ')}`,
  }
  const attestationCheck: GuardrailCheck = {
    id: 'policy-pool',
    level: 'warn',
    ok: true,
    note: `Desk policy: $${usd} is under the $${decision.capUsd} per-order cap. Attested for intent ${deskIntentId} (origin ${origin}), ${swapper ? `bound to ${swapper.slice(0, 8)}…` : 'bearer'}, expires in ${Math.max(0, Math.round((Number(att.expiry) - nowSec) / 60))} min; the hook refuses any other swap into this pool.`,
  }
  const feeCheck: GuardrailCheck = {
    id: 'fee',
    level: 'warn',
    ok: true,
    note: feeOn
      ? `Pantessa fee: ${feeBps / 100}% of the output, split by the router's own PAY_PORTION command to the Pantessa treasury — visible in the router calldata, minimum received shown post-fee.`
      : 'No Pantessa fee on this swap.',
  }
  const approvalNote =
    steps.length === 3
      ? `Two approvals attached (${sellLabel} → Permit2, then Permit2 → router) — v4 pulls funds through Permit2.`
      : steps.length === 2
        ? steps[0].label === 'approve'
          ? `One approval attached (${sellLabel} → Permit2); the router grant is already in place.`
          : `One Permit2 grant attached — the ${sellLabel} → Permit2 allowance is already in place.`
        : 'All approvals already in place.'
  const allowanceCheck: GuardrailCheck = { id: 'allowance', level: 'warn', ok: steps.length === 1, note: approvalNote }

  const checks: GuardrailCheck[] = [recipientCheck(from, from), validityCheck(deadline), allowanceCheck, calldataCheck, attestationCheck, feeCheck]
  // The same spend-policy gate as every native build (UNISWAP_POLICY_HOST —
  // the venue is still Uniswap). The grant store is DB-backed; a chain the
  // registry doesn't know (the testnet) still prices from the stable side.
  const grant = await getActiveGrant(from.toLowerCase()).catch(() => null)
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const spentTotal = grant ? await spentTotalUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(usd, policy, spentToday, UNISWAP_POLICY_HOST, spentTotal, { selfSigned: true })
  checks.push(polCheck)
  const guardrails = buildReport(usd, checks, violation ? { violation, valueUsd: usd, host: UNISWAP_POLICY_HOST } : null)
  if (violation && grant) {
    await recordLedger({ grantId: grant.id, orgId: grant.orgId ?? undefined, host: UNISWAP_POLICY_HOST, serviceName: 'Uniswap', amountUsd: 0, ok: false, note: `blocked: ${violation} (policy pool swap)` })
  }

  const outHuman = formatAtoms(amountOut.toString(), buyDec)
  const minHuman = formatAtoms(minOutAfterFee.toString(), buyDec)
  const feeNote = feeOn ? (creatorPaid ? `, incl. ${feeBps / 100}% Pantessa fee, half paid to the link's creator` : `, incl. ${feeBps / 100}% Pantessa fee on the output`) : ''
  const summary = `Swap ${formatAtoms(amountIn.toString(), sellDec)} ${sellLabel} → ~${outHuman} ${buyLabel} through the policy pool on ${cfg.chainName} (${cfg.poolKey.fee / 100}bps pool, hook ${cfg.hook.slice(0, 8)}…), min received ${minHuman} (${slippageBps}bps slippage${feeNote}), attested for intent ${deskIntentId}`

  return {
    summary,
    guardrails,
    blocked: !guardrails.ok,
    steps,
    minimumOut: minHuman,
    poolFee: cfg.poolKey.fee,
    ...(creatorPaid ? { creatorPaid } : {}),
    chainId,
    poolId: cfg.poolId,
    hook: cfg.hook,
    hookData,
    attestation: { intentId: att.intentId, deskIntentId, swapper: att.swapper, zeroForOne, maxAmountIn: amountIn.toString(), expiry: Number(att.expiry), origin },
    usd,
    buildPath: POLICY_POOL_BUILD_PATH,
  }
}

/** The on-chain intent id for a desk intent — re-exported for dispatch sites and the demo. */
export { intentIdFor as policyPoolIntentIdFor }
