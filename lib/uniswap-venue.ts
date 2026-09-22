// ─────────────────────────────────────────────────────────────────────────
//  Uniswap venue adapter — the Uniswap-ONLY half of the native swap tool
//  (taxonomy: venue code stays venue-specific; lib/tx-guardrails is the
//  cross-app Pantessa layer this plugs into). In-process for the website's
//  native path, exactly like the CoW adapter; the external productization is
//  the Uniswap MCP (Yeetful/x402-services services/uniswap), which this
//  mirrors: fresh QuoterV2 quote across every v3 fee tier → amountOutMinimum
//  minus the slippage bound → SwapRouter02 multicall(deadline,
//  [exactInputSingle]) calldata — an ON-CHAIN transaction the user
//  broadcasts (evm-tx artifact → SendTxButton), not an off-chain order.
//  With the protocol fee on (lib/fees.ts), the output lands on the router
//  and sweepTokenWithFee — Uniswap's NATIVE interface-fee path — splits it
//  user/treasury in the same multicall; fee off, recipient is ALWAYS the
//  payer directly. ERC-20 sells need an approval to SwapRouter02 (NOT CoW's
//  VaultRelayer); native-ETH sells ride msg.value.
//
//  Native-ETH BUYS: "ETH" resolves to the chain's wrapped native (every v3
//  pool quotes WETH), so the pool pays WETH. The router holds it and
//  unwrapWETH9WithFee (fee on) or unwrapWETH9 (fee off) sends native ETH to
//  the recipient in the same multicall. Before 2026-09-16 the sweep handed
//  the WETH ERC-20 over under an "ETH" label, which can't pay gas (proven
//  on a Base fork). An explicit "WETH" buy still gets the ERC-20.
//  guardUniswapV3Build decodes every build before it is offered.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, erc20Abi } from 'viem'
import { publicClient } from '@/lib/auth'
import { buysNativeEth, chainById, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals, tokenLabel, humanToAtoms, formatAtoms } from '@/lib/cow' // cross-app token utils (per-chain maps + atoms math)
import {
  buildReport,
  policyCheck,
  recipientCheck,
  validityCheck,
  type GuardrailCheck,
  type GuardrailReport,
} from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'
import { LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, TREASURY_ADDRESS, swapFeeAtoms } from '@/lib/fees'
import { checkFillAgainstTape, startSwapTape } from '@/lib/stock-tape'
import { UnknownTokenError } from '@/lib/token-list'

/** Uniswap v3 on Base (developers.uniswap.org, verified live by the MCP's
 *  smoke suite 2026-07-02). Kept as the Base constants for existing
 *  consumers/tests; the multi-chain addresses live in lib/chains.ts. */
export const UNI_QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as const
export const UNI_SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481' as const
// Exported for the dollar-amount price probe (lib/usd-probe.ts), which runs
// the same tier scan for exactly one token.
export const FEE_TIERS = [100, 500, 3000, 10000] as const

/** The ledger/policy host Uniswap swaps are attributed to. */
export const UNISWAP_POLICY_HOST = 'uniswap.yeetful.com'

export const QUOTER_V2_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable', // simulated via eth_call; never sent
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

/** SwapRouter02: exactInputSingle has NO deadline field — it rides multicall. */
export const SWAP_ROUTER_02_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
  // Uniswap's NATIVE interface-fee mechanism (Payments.sol): the swap pays
  // the router (ADDRESS_THIS sentinel), then this sweeps the output to the
  // user minus feeBips (≤100 enforced on-chain) to the fee recipient — the
  // exact recipe Uniswap's own interface uses for its 25 bps.
  {
    name: 'sweepTokenWithFee',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'feeBips', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
    ],
    outputs: [],
  },
  // The native-ETH twin (PeripheryPaymentsWithFee): withdraws the router's
  // WHOLE WETH9 balance (amountMinimum is checked against that pre-fee
  // balance), pays feeBips (≤100 on-chain) of it to the fee recipient as ETH
  // and the rest to the recipient. The router's WETH9() is the registry's
  // wrappedNative on every chain we route; the harness pins that live.
  {
    name: 'unwrapWETH9WithFee',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'feeBips', type: 'uint256' },
      { name: 'feeRecipient', type: 'address' },
    ],
    outputs: [],
  },
  // Fee off: the same unwrap, no split.
  {
    name: 'unwrapWETH9',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const

/** SwapRouter02's "pay the router itself" recipient sentinel. */
export const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as const

// ── The guard (pure, fail-closed) ───────────────────────────────────────────

type V3Tx = { to: string; data: string; value: string; chainId: number }

export interface V3GuardExpectations {
  chainId: number
  /** The registry-pinned SwapRouter02 for the chain. */
  swapRouter02: string
  /** Resolved addresses: the wrapped native for an ETH leg. */
  sellToken: string
  buyToken: string
  /** Native ETH in: the swap carries value = amountIn, no approval step. */
  sellIsEth: boolean
  /** Native ETH out: the router unwraps its WETH to the recipient. */
  nativeOut: boolean
  amountIn: bigint
  /** The pool-level slippage bound (pre-fee). */
  minOut: bigint
  /** The quoted v3 fee tier. */
  poolFee: number
  /** Where the output must land (the payer, or a caller-verified override). */
  recipient: string
  /** The multicall deadline the builder stamped (unix sec). */
  deadline: number
  /** Pantessa fee in bps. 0 = no split, and the fee-free shape is the only
   *  one accepted. Positive = the split is REQUIRED, paid to the pinned
   *  treasury, at a canonical tier. */
  feeBps: number
}

export interface V3GuardResult {
  ok: boolean
  reasons: string[]
}

const eqAddr = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Verify a built v3 swap before it can be offered for signing. Decodes the
 * approval and the SwapRouter02 multicall independently of the code that
 * built them: pinned router, exact atoms, the quoted pool, and the output
 * shape. That shape has exactly one right form per ask:
 *   native out            → [swap → router, unwrapWETH9WithFee | unwrapWETH9 → recipient]
 *   ERC-20 out, fee on    → [swap → router, sweepTokenWithFee → recipient]
 *   ERC-20 out, fee off   → [swap → recipient]
 * A sweep on an ETH buy delivers WETH; an unwrap on a WETH buy delivers the
 * wrong asset (or strands a non-WETH output on the router). Both refuse, as
 * does anything that fails to decode.
 */
export function guardUniswapV3Build(
  build: { swapTx: V3Tx; approveTx: V3Tx | null },
  exp: V3GuardExpectations,
  nowSec: number = Math.floor(Date.now() / 1000),
): V3GuardResult {
  const reasons: string[] = []
  const zero = BigInt(0)
  const feeOn = exp.feeBps > 0
  if (feeOn && ![SWAP_FEE_BPS, LINK_SWAP_FEE_BPS].includes(exp.feeBps)) {
    reasons.push(`Fee rate ${exp.feeBps}bps is outside the canonical tiers — refusing.`)
  }
  const chain = chainById(exp.chainId)
  if (exp.nativeOut && !eqAddr(exp.buyToken, chain?.wrappedNative)) {
    reasons.push("A native-ETH delivery must swap into the chain's wrapped native — refusing.")
  }

  // Approval: ERC-20 sells only, exactly amountIn to the pinned router.
  const approve = build.approveTx
  if (approve) {
    if (exp.sellIsEth) reasons.push('A native-ETH sell needs no approval — refusing the extra step.')
    if (approve.chainId !== exp.chainId) reasons.push(`The approval targets chain ${approve.chainId}, not ${exp.chainId}.`)
    if (!eqAddr(approve.to, exp.sellToken)) reasons.push('The approval does not target the sell token.')
    if (BigInt(approve.value || '0') !== zero) reasons.push('The approval must carry zero native value.')
    try {
      const dec = decodeFunctionData({ abi: erc20Abi, data: approve.data as `0x${string}` })
      if (dec.functionName !== 'approve') {
        reasons.push(`The approval step calls "${dec.functionName}", not approve — refusing.`)
      } else {
        const [spender, amount] = dec.args as [string, bigint]
        if (!eqAddr(spender, exp.swapRouter02)) reasons.push('The approval spender is not the pinned SwapRouter02.')
        if (amount !== exp.amountIn) reasons.push('The approval is not exactly the swap amount.')
      }
    } catch {
      reasons.push('Could not decode the approval calldata — refusing.')
    }
  }

  const tx = build.swapTx
  if (!eqAddr(tx.to, exp.swapRouter02)) reasons.push('The swap is not addressed to the pinned SwapRouter02.')
  if (tx.chainId !== exp.chainId) reasons.push(`The swap targets chain ${tx.chainId}, not ${exp.chainId}.`)
  let value = zero
  try {
    value = BigInt(tx.value || '0')
  } catch {
    reasons.push('The swap carries an unreadable native value — refusing.')
  }
  if (value !== (exp.sellIsEth ? exp.amountIn : zero)) {
    reasons.push(exp.sellIsEth ? 'The swap value is not exactly the ETH being sold.' : 'An ERC-20 sell must carry zero native value.')
  }

  try {
    const outer = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: tx.data as `0x${string}` })
    if (outer.functionName !== 'multicall') {
      reasons.push(`The swap calls "${outer.functionName}", not multicall(deadline, …) — refusing.`)
      return { ok: false, reasons }
    }
    const [deadline, calls] = outer.args as [bigint, readonly `0x${string}`[]]
    if (deadline !== BigInt(exp.deadline)) reasons.push('The multicall deadline is not the one we stamped.')
    if (deadline <= BigInt(nowSec)) reasons.push('The swap deadline is already in the past.')
    const routerHolds = exp.nativeOut || feeOn
    const wantCalls = routerHolds ? 2 : 1
    if (calls.length !== wantCalls) {
      reasons.push(`Expected ${wantCalls} router call(s) (${routerHolds ? 'swap → router, then the payout' : 'the swap alone'}), got ${calls.length}.`)
    }

    const swap = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[0] })
    if (swap.functionName !== 'exactInputSingle') {
      reasons.push(`The first router call is "${swap.functionName}", not exactInputSingle — refusing.`)
    } else {
      const p = (swap.args as readonly unknown[])[0] as {
        tokenIn: string
        tokenOut: string
        fee: number
        recipient: string
        amountIn: bigint
        amountOutMinimum: bigint
        sqrtPriceLimitX96: bigint
      }
      if (!eqAddr(p.tokenIn, exp.sellToken)) reasons.push('The swap does not sell the asked token.')
      if (!eqAddr(p.tokenOut, exp.buyToken)) reasons.push('The swap does not buy the asked token.')
      if (Number(p.fee) !== exp.poolFee || !(FEE_TIERS as readonly number[]).includes(Number(p.fee))) reasons.push('The pool fee tier is not the quoted one.')
      if (p.amountIn !== exp.amountIn) reasons.push('The swap amountIn is not exactly the asked amount.')
      if (p.amountOutMinimum !== exp.minOut) reasons.push('The swap minimum-out is not the quoted bound.')
      if (p.sqrtPriceLimitX96 !== zero) reasons.push('Unexpected price limit on the swap — refusing.')
      if (routerHolds) {
        if (!eqAddr(p.recipient, ADDRESS_THIS)) reasons.push('The swap output does not land on the router for the payout call — refusing.')
      } else if (!eqAddr(p.recipient, exp.recipient)) {
        reasons.push('The swap output does not go to the intended recipient — refusing.')
      }
    }

    const payout = calls[1] ? decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[1] }) : null
    if (payout && routerHolds) {
      const name = payout.functionName
      if (exp.nativeOut) {
        if (name === 'sweepTokenWithFee') {
          reasons.push('The payout sweeps WETH, but the ask was native ETH — refusing a WETH delivery.')
        } else if (name !== (feeOn ? 'unwrapWETH9WithFee' : 'unwrapWETH9')) {
          reasons.push(`The payout calls "${name}", not ${feeOn ? 'unwrapWETH9WithFee' : 'unwrapWETH9'} — refusing.`)
        } else {
          const [min, to, bips, feeTo] = payout.args as readonly [bigint, string, bigint?, string?]
          if (min !== exp.minOut) reasons.push('The unwrap minimum is not the quoted bound.')
          if (!eqAddr(to, exp.recipient)) reasons.push('The unwrap does not pay the intended recipient — refusing.')
          if (feeOn) {
            if (bips !== BigInt(exp.feeBps)) reasons.push(`The unwrap fee (${bips}bps) is not the priced fee (${exp.feeBps}).`)
            if (!eqAddr(feeTo, TREASURY_ADDRESS)) reasons.push('The fee recipient is not the Pantessa treasury — refusing.')
          }
        }
      } else if (name === 'unwrapWETH9WithFee' || name === 'unwrapWETH9') {
        reasons.push('The payout unwraps to native ETH, but the ask was the ERC-20 — refusing.')
      } else if (name !== 'sweepTokenWithFee') {
        reasons.push(`The payout calls "${name}", not sweepTokenWithFee — refusing.`)
      } else {
        const [token, min, to, bips, feeTo] = payout.args as readonly [string, bigint, string, bigint, string]
        if (!eqAddr(token, exp.buyToken)) reasons.push('The sweep is for a different token than the buy token.')
        if (min !== exp.minOut) reasons.push('The sweep minimum is not the quoted bound.')
        if (!eqAddr(to, exp.recipient)) reasons.push('The sweep does not pay the intended recipient — refusing.')
        if (bips !== BigInt(exp.feeBps)) reasons.push(`The sweep fee (${bips}bps) is not the priced fee (${exp.feeBps}).`)
        if (!eqAddr(feeTo, TREASURY_ADDRESS)) reasons.push('The fee recipient is not the Pantessa treasury — refusing.')
      }
    }
  } catch {
    reasons.push('Could not decode the SwapRouter02 calldata — refusing to offer an opaque transaction.')
  }

  return { ok: reasons.length === 0, reasons }
}

/** No v3 pool can fill the pair — a TYPED miss so the route can fall through
 *  to the v4 layer (Robinhood's tokenized stocks are v4-only) instead of
 *  string-matching an error message. */
export class NoV3PoolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoV3PoolError'
  }
}

/** Stables priced at $1 face value (same heuristic as the CoW adapter) —
 *  the per-chain address→decimals maps live in lib/chains.ts. Shared with
 *  the v4 sibling (lib/uniswap-v4.ts). */
export function stableUsd(chainId: number, token: string, atoms: bigint): number | null {
  const dec = chainById(chainId)?.stables[token.toLowerCase()]
  if (dec === undefined) return null
  const v = Number(atoms) / 10 ** dec
  return Number.isFinite(v) ? v : null
}

export interface UniswapSwapParams {
  sellToken: string
  buyToken: string
  /** Human units — converted with real decimals. */
  amountHuman: string
  from: string
  /** Target chain (default Base). Must have `uniswap` support in lib/chains.ts. */
  chainId?: number
  slippageBps?: number
  deadlineSec?: number
  /** Where the swap OUTPUT lands (default `from`). Only internal executors
   *  set this (autonomous DCA sells from the spender, output pinned to the
   *  schedule owner) — every override MUST be re-verified by the caller's own
   *  independent calldata guard against the intended owner. */
  recipient?: string
  /** Fee tier in bps (default SWAP_FEE_BPS; link-originated turns pass
   *  LINK_SWAP_FEE_BPS). Rides the sweepTokenWithFee split — and must ride
   *  the refresh recipe too, or a re-quote silently reprices to the base. */
  feeBps?: number
}

export interface UniswapBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  /** The evm-tx the user broadcasts — approve first when `approveTx` is set. */
  swapTx: { to: string; data: string; value: string; chainId: number; action: string }
  approveTx: { to: string; data: string; value: string; chainId: number; action: string } | null
  minimumOut: string
  /** Unix seconds the swap calldata dies (the multicall deadline) — rides
   *  into TxChainStep.validUntil so the card re-quotes before it lapses. */
  validUntil: number
}

/**
 * Build a guardrailed Uniswap v3 swap transaction. Uniswap-only: quote, fee
 * tier scan, router calldata, SwapRouter02 allowance. The cross-app parts
 * (recipient/validity/policy checks, refusal ledger) come from tx-guardrails
 * — identical to what gates CoW orders.
 */
export async function buildUniswapSwap(params: UniswapSwapParams): Promise<UniswapBuilt> {
  const slippageBps = params.slippageBps ?? 50
  const deadlineSec = params.deadlineSec ?? 600
  const chainId = params.chainId ?? 8453
  const chain = chainById(chainId)
  if (!chain) throw new Error(`Chain ${chainId} isn't one of Pantessa's supported chains.`)
  if (!chain.uniswap) throw new Error(`Uniswap isn't wired on ${chain.name} yet — pick another chain.`)
  const { swapRouter02, quoterV2 } = chain.uniswap
  // Registry client first — it carries the per-chain rpcUrl overrides
  // (Base's viem default mainnet.base.org 429s under load and made this
  // builder claim "no v3 pool" for USDC→WETH; publicnode holds up). The
  // lib/auth client stays as the Base fallback only.
  const client = publicClientFor(chainId) ?? (chainId === 8453 ? publicClient : null)
  if (!client) throw new Error(`No RPC client configured for ${chain.name}.`)
  const from = params.from as `0x${string}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('A valid wallet address is required.')
  const recipient = (params.recipient ?? params.from) as `0x${string}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error('A valid recipient address is required.')

  const sellIsEth = params.sellToken.trim().toUpperCase() === 'ETH'
  // "ETH" out means native ETH: the pool pays WETH to the router and the
  // router unwraps it in the same multicall. "WETH" stays the ERC-20.
  const buyIsEth = buysNativeEth(params.buyToken, chainId)
  const sellAddr = resolveToken(params.sellToken, chainId)
  const buyAddr = resolveToken(params.buyToken, chainId)
  if (!sellAddr) throw new UnknownTokenError('sell', params.sellToken, chain.name)
  if (!buyAddr) throw new UnknownTokenError('buy', params.buyToken, chain.name)
  if (sellAddr === buyAddr) throw new Error('sellToken and buyToken must differ.')
  const sellDec = tokenDecimals(params.sellToken, chainId) ?? 18
  const buyDec = tokenDecimals(params.buyToken, chainId) ?? 18
  const atoms = humanToAtoms(params.amountHuman, sellDec)
  if (!atoms) throw new Error(`Couldn't read the amount "${params.amountHuman}" (${sellDec} decimals max).`)
  const amountIn = BigInt(atoms)
  // A Robinhood Chain stock swap is checked against the tape once the quote
  // lands (lib/stock-tape); the read starts now so it rides alongside.
  const tapeRead = startSwapTape({ chainId, sellToken: params.sellToken, buyToken: params.buyToken })

  // Fresh quote across every fee tier — best amountOut wins.
  const tiers = await Promise.all(
    FEE_TIERS.map(async (fee): Promise<{ fee: number; amountOut: bigint } | null> => {
      try {
        const { result } = await client.simulateContract({
          address: quoterV2,
          abi: QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn: sellAddr as `0x${string}`, tokenOut: buyAddr as `0x${string}`, amountIn, fee, sqrtPriceLimitX96: BigInt(0) }],
        })
        return { fee, amountOut: result[0] }
      } catch {
        return null
      }
    }),
  )
  const live = tiers
    .filter((t): t is { fee: number; amountOut: bigint } => t !== null && t.amountOut > BigInt(0))
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))
  if (live.length === 0) {
    throw new NoV3PoolError(`No Uniswap v3 pool on ${chain.name} can fill ${tokenLabel(params.sellToken, chainId)} → ${tokenLabel(params.buyToken, chainId)} for this amount.`)
  }
  const best = live[0]
  // The slippage bound below is measured from this pool's own quote, so a
  // pool far from the stock's tape would still build a "guarded" swap that
  // loses the money. Off tape → OffTapeError, and the cascade tries the
  // chain's own venue; no tape → TapeUnavailableError (fail closed).
  const tapeCheck = checkFillAgainstTape(await tapeRead, "Robinhood Chain's Uniswap v3 pool", amountIn, best.amountOut)
  const minOut = (best.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec

  // Pantessa fee (lib/fees.ts) via the router's NATIVE fee path: output lands
  // on the router, sweepTokenWithFee (ERC-20) or unwrapWETH9WithFee (native
  // ETH) splits it user/treasury in the SAME multicall. Fee off (bps 0) → the
  // classic direct-to-payer build, except native ETH, which the router must
  // still hold to unwrap.
  const feeBps = params.feeBps ?? SWAP_FEE_BPS
  const feeOn = feeBps > 0
  const feeAtomsOnMin = feeOn ? swapFeeAtoms(minOut, feeBps) : BigInt(0)
  const minOutAfterFee = minOut - feeAtomsOnMin
  const routerHolds = feeOn || buyIsEth

  const swapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: sellAddr as `0x${string}`,
        tokenOut: buyAddr as `0x${string}`,
        fee: best.fee,
        // Router holds the output for the payout call (fee split and/or the
        // unwrap). Otherwise straight to the intended receiver (the payer
        // unless overridden).
        recipient: routerHolds ? ADDRESS_THIS : recipient,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  })
  const calls: `0x${string}`[] = [swapCall]
  if (buyIsEth) {
    // amountMinimum is checked against the router's pre-fee WETH balance —
    // the same bound the sweep takes.
    calls.push(
      feeOn
        ? encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'unwrapWETH9WithFee', args: [minOut, recipient, BigInt(feeBps), TREASURY_ADDRESS] })
        : encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'unwrapWETH9', args: [minOut, recipient] }),
    )
  } else if (feeOn) {
    calls.push(
      encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: 'sweepTokenWithFee',
        args: [buyAddr as `0x${string}`, minOut, recipient, BigInt(feeBps), TREASURY_ADDRESS],
      }),
    )
  }
  const data = encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'multicall', args: [BigInt(deadline), calls] })
  const swapTx = {
    to: swapRouter02 as string,
    data,
    value: sellIsEth ? amountIn.toString() : '0',
    chainId,
    action: 'swap',
  }

  // Approval: ERC-20 sells need allowance to SwapRouter02; ETH sells don't
  // (the router wraps msg.value).
  let approveTx: UniswapBuilt['approveTx'] = null
  let allowanceCheck: GuardrailCheck = { id: 'allowance', level: 'warn', ok: true, note: 'No approval needed (native ETH in).' }
  if (!sellIsEth) {
    const allowance = await client.readContract({
      address: sellAddr as `0x${string}`,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [from, swapRouter02],
    })
    const ok = allowance >= amountIn
    allowanceCheck = {
      id: 'allowance',
      level: 'warn',
      ok,
      note: ok
        ? 'Uniswap SwapRouter02 allowance is in place.'
        : `Approve ${tokenLabel(params.sellToken, chainId)} to Uniswap's SwapRouter02 first — the approve transaction is attached.`,
    }
    if (!ok) {
      approveTx = {
        to: sellAddr,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [swapRouter02, amountIn] }),
        value: '0',
        chainId,
        action: 'approve',
      }
    }
  }

  // ── The guard: decode what we just built; refuse the turn on any mismatch.
  const buyLabel = tokenLabel(params.buyToken, chainId)
  const guard = guardUniswapV3Build(
    { swapTx, approveTx },
    {
      chainId,
      swapRouter02,
      sellToken: sellAddr,
      buyToken: buyAddr,
      sellIsEth,
      nativeOut: buyIsEth,
      amountIn,
      minOut,
      poolFee: best.fee,
      recipient,
      deadline,
      feeBps: feeOn ? feeBps : 0,
    },
  )
  const calldataCheck: GuardrailCheck = {
    id: 'calldata',
    level: 'block',
    ok: guard.ok,
    note: guard.ok
      ? `Calldata verified: SwapRouter02 ${swapRouter02.slice(0, 8)}…, exactly ${formatAtoms(amountIn.toString(), sellDec)} ${tokenLabel(params.sellToken, chainId)} in, ${buyIsEth ? 'native ETH (unwrapped by the router)' : buyLabel} out to ${recipient.toLowerCase() === from.toLowerCase() ? 'the payer' : 'the pinned recipient'}${feeOn ? ' minus the treasury split' : ''}.`
      : `Build failed verification: ${guard.reasons.join(' ')}`,
  }

  // ── Cross-app guardrails: identical gate to CoW, host = Uniswap's. ────────
  const feeCheck: GuardrailCheck = {
    id: 'fee',
    level: 'warn',
    ok: true,
    note: feeOn
      ? `Pantessa fee: ${feeBps / 100}% of the output, split by the router's own ${buyIsEth ? 'unwrapWETH9WithFee' : 'sweepTokenWithFee'} to the Pantessa treasury — visible in the multicall, minimum received shown post-fee.`
      : 'No Pantessa fee on this swap.',
  }
  // Recipient pin: the classic build pays the payer (self-check). An override
  // reports where proceeds land — the overriding executor's own independent
  // guard is the block-level gate that the receiver is the intended owner.
  const recipCheck: GuardrailCheck =
    recipient.toLowerCase() === from.toLowerCase()
      ? recipientCheck(from, from)
      : { id: 'recipient', level: 'block', ok: true, note: `Proceeds pinned to ${recipient} (recipient override — re-verified by the caller's independent guard).` }
  const checks: GuardrailCheck[] = [recipCheck, validityCheck(deadline), allowanceCheck, calldataCheck, feeCheck, ...(tapeCheck ? [tapeCheck] : [])]
  const valueUsd = stableUsd(chainId, sellAddr, amountIn) ?? stableUsd(chainId, buyAddr, best.amountOut)
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, UNISWAP_POLICY_HOST, 0, { selfSigned: true })
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
      note: `blocked: ${violation} (uniswap swap)`,
    })
  }

  const inHuman = formatAtoms(amountIn.toString(), sellDec)
  const outHuman = formatAtoms(best.amountOut.toString(), buyDec)
  // Honest minimum: what the USER receives after the treasury sweep, not the
  // pool-level bound.
  const minHuman = formatAtoms(minOutAfterFee.toString(), buyDec)
  const feeNote = feeOn ? `, incl. ${feeBps / 100}% Pantessa fee on the output` : ''
  const summary = `Swap ${inHuman} ${tokenLabel(params.sellToken, chainId)} → ~${outHuman} ${buyLabel} via Uniswap v3 on ${chain.name} (${best.fee / 100}bps pool), min received ${minHuman} (${slippageBps}bps slippage${feeNote})`

  return { summary, guardrails, blocked: !guardrails.ok, swapTx, approveTx, minimumOut: minHuman, validUntil: deadline }
}
