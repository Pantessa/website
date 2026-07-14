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
//    2. Encode ONE Universal Router `execute` with exactly the V4_SWAP
//       command: SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL. TAKE_ALL
//       credits the transaction SENDER, so the recipient is the payer by
//       construction — there is no recipient field to get wrong.
//    3. v4 pulls funds through Permit2, so an ERC-20 sell may need up to two
//       approvals (token→Permit2, then Permit2→Universal Router), both for
//       EXACTLY the asked amount — assembled as one SendTxChain.
//    4. GUARD: decode the calldata we just built and refuse unless every
//       field verifies (pinned router, exact amounts, quoted pool key, no
//       hooks, zero native value) — same fail-closed shape as the v3 /
//       cross-chain / Aave guards. A guard failure withholds the artifact.
//
//  Only no-hook pools are scanned: a hooked pool's contract can reorder
//  economics mid-swap, so we refuse rather than route through code we
//  haven't verified. Live-probed 2026-07-13 on Robinhood Chain: USDG↔AAPL
//  and USDG↔TSLA fill at fee 3000/tick 60 (and 10000/200) with hooks = 0x0.
// ─────────────────────────────────────────────────────────────────────────

import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi } from 'viem'
import { chainById, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals, tokenLabel, humanToAtoms, formatAtoms } from '@/lib/cow'
import { stableUsd, UNISWAP_POLICY_HOST } from '@/lib/uniswap-venue'
import {
  buildReport,
  policyCheck,
  recipientCheck,
  validityCheck,
  type GuardrailCheck,
  type GuardrailReport,
} from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

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
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06
const ACTION_SETTLE_ALL = 0x0c
const ACTION_TAKE_ALL = 0x0f
/** The exact action sequence we build AND the only one the guard accepts. */
const V4_ACTIONS = `0x${[ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('')}` as `0x${string}`

const UINT128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1)
const UINT160_MAX = (BigInt(1) << BigInt(160)) - BigInt(1)

const UNIVERSAL_ROUTER_ABI = [
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

const V4_QUOTER_ABI = [
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

const PERMIT2_ABI = [
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

// ── Calldata construction (pure — exported so the guard tests can build) ────

export interface V4SwapPlan {
  poolKey: V4PoolKey
  zeroForOne: boolean
  amountIn: bigint
  minOut: bigint
  deadline: number
}

/** Encode the ONE Universal Router call: V4_SWAP → swap, settle, take. */
export function encodeV4SwapCalldata(plan: V4SwapPlan): `0x${string}` {
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
        hookData: '0x',
      },
    ],
  )
  const settleParams = encodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], [currencyIn, plan.amountIn])
  const takeParams = encodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], [currencyOut, plan.minOut])
  const v4Input = encodeAbiParameters([...ACTIONS_ENVELOPE_PARAMS], [V4_ACTIONS, [swapParams, settleParams, takeParams]])
  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [`0x${UR_COMMAND_V4_SWAP.toString(16).padStart(2, '0')}`, [v4Input], BigInt(plan.deadline)],
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
}

export interface V4GuardResult {
  ok: boolean
  reasons: string[]
}

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

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

  // The swap step: ONE Universal Router execute, command V4_SWAP only.
  const tx = swap.tx
  if (!eqAddr(tx.to, exp.universalRouter)) reasons.push('The swap is not addressed to the pinned Universal Router.')
  if (tx.chainId !== exp.chainId) reasons.push(`The swap targets chain ${tx.chainId}, not ${exp.chainId}.`)
  if (BigInt(tx.value || '0') !== BigInt(0)) reasons.push('The swap must carry zero native value (ERC-20 in via Permit2).')
  try {
    const dec = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: tx.data as `0x${string}` })
    const [commands, inputs, deadline] = dec.args as [`0x${string}`, readonly `0x${string}`[], bigint]
    if (commands.toLowerCase() !== `0x${UR_COMMAND_V4_SWAP.toString(16).padStart(2, '0')}`) {
      reasons.push(`Router commands are ${commands}, not the single V4_SWAP — refusing.`)
    }
    if (inputs.length !== 1) reasons.push(`Expected exactly one router input, got ${inputs.length}.`)
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) reasons.push('The swap deadline is already in the past.')
    const input = inputs[0]
    if (input) {
      const [actions, params] = decodeAbiParameters([...ACTIONS_ENVELOPE_PARAMS], input) as [
        `0x${string}`,
        readonly `0x${string}`[],
      ]
      if (actions.toLowerCase() !== V4_ACTIONS) {
        reasons.push(`v4 actions are ${actions}, not swap→settle-all→take-all — refusing.`)
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
        if (!eqAddr(k.hooks, ZERO_HOOKS)) reasons.push('The pool has a hook contract — only no-hook pools are allowed.')
        const currencyIn = sp.zeroForOne ? k.currency0 : k.currency1
        const currencyOut = sp.zeroForOne ? k.currency1 : k.currency0
        if (!eqAddr(currencyIn, exp.sellToken)) reasons.push('The swap direction does not sell the asked token.')
        if (!eqAddr(currencyOut, exp.buyToken)) reasons.push('The swap direction does not buy the asked token.')
        if (sp.amountIn !== exp.amountIn) reasons.push('The swap amountIn is not exactly the asked amount.')
        if (sp.amountOutMinimum !== exp.minOut) reasons.push('The swap minimum-out does not match the quoted bound.')
        if (sp.hookData !== '0x') reasons.push('Unexpected hookData on the swap — refusing.')
        const [settleCur, settleAmt] = decodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], params[1]) as [string, bigint]
        if (!eqAddr(settleCur, exp.sellToken)) reasons.push('SETTLE_ALL is for a different currency than the sell token.')
        if (settleAmt !== exp.amountIn) reasons.push('SETTLE_ALL max does not match the swap amount.')
        const [takeCur, takeAmt] = decodeAbiParameters([...CURRENCY_AMOUNT_PARAMS], params[2]) as [string, bigint]
        if (!eqAddr(takeCur, exp.buyToken)) reasons.push('TAKE_ALL is for a different currency than the buy token.')
        if (takeAmt !== exp.minOut) reasons.push('TAKE_ALL minimum does not match the quoted bound.')
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
}

export interface UniswapV4Built {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  /** 1–3 steps: [token→Permit2 approve?, Permit2→router approve?, swap]. */
  steps: V4BuiltStep[]
  minimumOut: string
  poolFee: number
}

/**
 * Build a guardrailed Uniswap v4 swap chain. Throws NoV4PoolError when no
 * no-hook pool quotes the pair (the route turns that into an honest reply).
 * A guard failure comes back as a BLOCK-level check (`blocked: true`) — the
 * route refuses the turn and the artifact is withheld, same as v3.
 */
export async function buildUniswapV4Swap(params: UniswapV4SwapParams): Promise<UniswapV4Built> {
  const slippageBps = params.slippageBps ?? 50
  const deadlineSec = params.deadlineSec ?? 600
  const chain = chainById(params.chainId)
  if (!chain) throw new Error(`Chain ${params.chainId} isn't one of Yeetful's supported chains.`)
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
  const sellAddr = resolveToken(params.sellToken, chainId) as `0x${string}` | null
  const buyAddr = resolveToken(params.buyToken, chainId) as `0x${string}` | null
  if (!sellAddr) throw new Error(`Unknown sell token on ${chain.name}: ${params.sellToken}`)
  if (!buyAddr) throw new Error(`Unknown buy token on ${chain.name}: ${params.buyToken}`)
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
  const minOut = (best.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec
  // Permit2 grant outlives the swap deadline by an hour — enough for slow
  // approval mining, small enough to be a real bound (not an open grant).
  const permit2Expiration = deadline + 3600
  const poolKey: V4PoolKey = { currency0, currency1, fee: best.fee, tickSpacing: best.tickSpacing, hooks: ZERO_HOOKS }

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
      data: encodeV4SwapCalldata({ poolKey, zeroForOne, amountIn, minOut, deadline }),
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
  })
  const calldataCheck: GuardrailCheck = {
    id: 'calldata',
    level: 'block',
    ok: guard.ok,
    note: guard.ok
      ? `Calldata verified: Universal Router ${v4.universalRouter.slice(0, 8)}…, exactly ${params.amountHuman} ${sellLabel} in, output to the payer (no-hook ${best.fee / 100}bps pool).`
      : `Build failed verification: ${guard.reasons.join(' ')}`,
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
  const checks: GuardrailCheck[] = [recipientCheck(from, from), validityCheck(deadline), allowanceCheck, calldataCheck]
  const valueUsd = stableUsd(chainId, sellAddr, amountIn) ?? stableUsd(chainId, buyAddr, best.amountOut)
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, UNISWAP_POLICY_HOST)
  checks.push(polCheck)
  const guardrails = buildReport(valueUsd, checks)
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
  const minHuman = formatAtoms(minOut.toString(), buyDec)
  const summary = `Swap ${formatAtoms(amountIn.toString(), sellDec)} ${sellLabel} → ~${outHuman} ${buyLabel} via Uniswap v4 on ${chain.name} (${best.fee / 100}bps pool), min received ${minHuman} (${slippageBps}bps slippage)`

  return { summary, guardrails, blocked: !guardrails.ok, steps, minimumOut: minHuman, poolFee: best.fee }
}
