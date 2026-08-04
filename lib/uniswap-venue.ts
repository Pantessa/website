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
// ─────────────────────────────────────────────────────────────────────────

import { encodeFunctionData, erc20Abi } from 'viem'
import { publicClient } from '@/lib/auth'
import { chainById, publicClientFor } from '@/lib/chains'
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
import { SWAP_FEE_BPS, TREASURY_ADDRESS, swapFeeAtoms } from '@/lib/fees'

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
] as const

/** SwapRouter02's "pay the router itself" recipient sentinel. */
export const ADDRESS_THIS = '0x0000000000000000000000000000000000000002' as const

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
  const sellAddr = resolveToken(params.sellToken, chainId)
  const buyAddr = resolveToken(params.buyToken, chainId)
  if (!sellAddr) throw new Error(`Unknown sell token on ${chain.name}: ${params.sellToken}`)
  if (!buyAddr) throw new Error(`Unknown buy token on ${chain.name}: ${params.buyToken}`)
  if (sellAddr === buyAddr) throw new Error('sellToken and buyToken must differ.')
  const sellDec = tokenDecimals(params.sellToken, chainId) ?? 18
  const buyDec = tokenDecimals(params.buyToken, chainId) ?? 18
  const atoms = humanToAtoms(params.amountHuman, sellDec)
  if (!atoms) throw new Error(`Couldn't read the amount "${params.amountHuman}" (${sellDec} decimals max).`)
  const amountIn = BigInt(atoms)

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
  const minOut = (best.amountOut * BigInt(10_000 - slippageBps)) / BigInt(10_000)
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec

  // Pantessa fee (lib/fees.ts) via the router's NATIVE fee path: output lands
  // on the router, sweepTokenWithFee splits it user/treasury in the SAME
  // multicall. Fee off (bps 0) → the classic direct-to-payer build.
  const feeBps = params.feeBps ?? SWAP_FEE_BPS
  const feeOn = feeBps > 0
  const feeAtomsOnMin = feeOn ? swapFeeAtoms(minOut, feeBps) : BigInt(0)
  const minOutAfterFee = minOut - feeAtomsOnMin

  const swapCall = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: sellAddr as `0x${string}`,
        tokenOut: buyAddr as `0x${string}`,
        fee: best.fee,
        // Fee on: the router holds the output for the sweep split. Fee off:
        // straight to the intended receiver (the payer unless overridden).
        recipient: feeOn ? ADDRESS_THIS : recipient,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  })
  const calls: `0x${string}`[] = [swapCall]
  if (feeOn) {
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

  // ── Cross-app guardrails: identical gate to CoW, host = Uniswap's. ────────
  const feeCheck: GuardrailCheck = {
    id: 'fee',
    level: 'warn',
    ok: true,
    note: feeOn
      ? `Pantessa fee: ${feeBps / 100}% of the output, split by the router's own sweepTokenWithFee to the Pantessa treasury — visible in the multicall, minimum received shown post-fee.`
      : 'No Pantessa fee on this swap.',
  }
  // Recipient pin: the classic build pays the payer (self-check). An override
  // reports where proceeds land — the overriding executor's own independent
  // guard is the block-level gate that the receiver is the intended owner.
  const recipCheck: GuardrailCheck =
    recipient.toLowerCase() === from.toLowerCase()
      ? recipientCheck(from, from)
      : { id: 'recipient', level: 'block', ok: true, note: `Proceeds pinned to ${recipient} (recipient override — re-verified by the caller's independent guard).` }
  const checks: GuardrailCheck[] = [recipCheck, validityCheck(deadline), allowanceCheck, feeCheck]
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
  const summary = `Swap ${inHuman} ${tokenLabel(params.sellToken, chainId)} → ~${outHuman} ${tokenLabel(params.buyToken, chainId)} via Uniswap v3 on ${chain.name} (${best.fee / 100}bps pool), min received ${minHuman} (${slippageBps}bps slippage${feeNote})`

  return { summary, guardrails, blocked: !guardrails.ok, swapTx, approveTx, minimumOut: minHuman, validUntil: deadline }
}
