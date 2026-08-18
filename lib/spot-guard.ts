// ─────────────────────────────────────────────────────────────────────────
//  SPOT GUARDIAN — the pure half. "If ETH drops 10%, convert my ETH to
//  USDC" — the HL Guardian's promise, generalized to SPOT holdings on Base
//  via the #577 Spend Permission rails, non-custodial end to end.
//
//  Trust model (one breath, mirrors DCA autopilot): the user's SMART wallet
//  signs ONE SpendPermission whose allowance is EXACTLY the protected
//  amount over a SINGLE window (period = the permission's whole life —
//  total pullable ever = the amount, once). The on-chain
//  SpendPermissionManager caps the pull regardless of this codebase. When
//  the trigger fires, the sweep builds a fresh guarded swap
//  (protected asset → USDC, output pinned to the OWNER), re-decodes every
//  byte independently (guardSpotSell), and only then pulls. Disarm = we
//  stop watching; on-chain revoke is the user's nuclear option.
//
//  This module is PURE (no prisma, no CDP, no RPC): permission
//  construction, the arm/manage grammar (deliberately DISJOINT from the HL
//  guardian's — a side word or venue word always means perps), trigger
//  math, and the fail-closed guard. Unknown shape = refusal.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi } from 'viem'
import {
  PERMISSION_LIFE_SECONDS,
  PERMISSION_START_GRACE_SECONDS,
  type DcaSpendPermission,
} from './dca-auto'
import { SWAP_ROUTER_02_ABI } from './uniswap-venue'
import type { GuardrailCheck } from './tx-guardrails'

/** The permission struct is protocol-shaped, not DCA-shaped — reuse it. */
export type SpotSpendPermission = DcaSpendPermission

/** SpendPermissionManager's native-token sentinel (ERC-7528): a permission
 *  over the chain's native ETH, pulled as ETH — the sweep wraps before it
 *  swaps. */
export const NATIVE_TOKEN_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/

// ── Permission construction ─────────────────────────────────────────────────

export interface BuildSpotPermissionInput {
  /** The policy owner's wallet — must BE a smart wallet (the grantor). */
  account: string
  /** Pantessa's CDP-managed spender. */
  spender: string
  /** The protected asset: an ERC-20 address, or the native sentinel. */
  token: string
  /** Exactly how much may ever be pulled (atomic units of `token`). */
  amountAtoms: bigint
  /** Unix seconds "now" — passed in so this stays deterministic/testable. */
  nowSec: number
  /** Random uint256 salt — crypto lives with the caller. */
  salt: bigint
}

/**
 * One-shot permission: allowance = the protected amount, period = the whole
 * permission life, so the TOTAL the spender can ever pull is the amount —
 * a fired guard can never be replayed into a second pull.
 */
export function buildSpotGuardPermission(input: BuildSpotPermissionInput): SpotSpendPermission {
  for (const [label, v] of [['account', input.account], ['spender', input.spender], ['token', input.token]] as const) {
    if (!HEX_ADDR.test(v)) throw new Error(`spot-guard: ${label} is not an address`)
  }
  if (input.account.toLowerCase() === input.spender.toLowerCase()) {
    throw new Error('spot-guard: account and spender must differ')
  }
  if (input.amountAtoms <= BigInt(0)) throw new Error('spot-guard: protected amount must be positive')
  const start = input.nowSec - PERMISSION_START_GRACE_SECONDS
  const end = input.nowSec + PERMISSION_LIFE_SECONDS
  return {
    account: input.account as `0x${string}`,
    spender: input.spender as `0x${string}`,
    token: input.token as `0x${string}`,
    allowance: input.amountAtoms,
    period: end - start, // single rolling window = the whole life
    start,
    end,
    salt: input.salt,
    extraData: '0x',
  }
}

// ── Trigger math ────────────────────────────────────────────────────────────

export interface SpotTrigger {
  mode: 'price' | 'price_move_pct'
  value: number
  /** Arm-time reference price (USD) — the pct mode's anchor. */
  refPrice: number
}

/** Stop-loss semantics only (v1): fired when the mark is AT or BELOW the
 *  line. Malformed triggers never fire (fail closed) — the arm turn
 *  validates, this re-checks. */
export function spotTriggerFired(t: SpotTrigger, markPrice: number): { fired: boolean; note: string } {
  if (!Number.isFinite(markPrice) || markPrice <= 0) return { fired: false, note: 'no readable mark price' }
  if (t.mode === 'price') {
    if (!Number.isFinite(t.value) || t.value <= 0) return { fired: false, note: 'malformed price trigger' }
    return {
      fired: markPrice <= t.value,
      note: `mark $${markPrice} vs stop $${t.value}`,
    }
  }
  if (!Number.isFinite(t.value) || t.value <= 0 || t.value >= 90) return { fired: false, note: 'malformed pct trigger' }
  if (!Number.isFinite(t.refPrice) || t.refPrice <= 0) return { fired: false, note: 'no arm-time reference price' }
  const line = t.refPrice * (1 - t.value / 100)
  return {
    fired: markPrice <= line,
    note: `mark $${markPrice} vs ${t.value}% below $${t.refPrice} ($${line.toFixed(2)})`,
  }
}

// ── Arm / manage grammar ────────────────────────────────────────────────────
// DISJOINT from the HL guardian's by construction: a side word (long/short)
// or venue word (hyperliquid/hl/perp/position) always means perps and this
// parser refuses. Spot needs its own marker: "spot" or "in my wallet".
// The briefing/holdings chips carry these exact strings — the chip is the
// contract.

export interface SpotGuardAsk {
  token: string
  /** Optional protected amount in token units ("Protect 0.5 spot ETH…");
   *  absent = the arm turn sizes it from the live balance. */
  amountHuman?: string
  triggerMode: 'price' | 'price_move_pct'
  triggerValue: number
}

const PERP_WORDS = /\b(?:long|short|perp(?:s|etual)?|position|hyperliquid|hl)\b/i
// "on Base" is spot evidence too: perps live on no chain, and the spot
// guardian runs on Base only (WALLET-MATRIX §4 row 6 — "Protect my ETH on
// Base with a 10% stop" — fell to the HL guardian door before, squad 2026-08-18).
const SPOT_MARKER = /\bspot\b|\bin\s+my\s+wallet\b|\bon\s+base\b/i
const PROTECT_SHAPE = /\bprotect\b|\bstop[\s-]?loss\b/i

const SPOT_ARM_RE =
  /\bprotect\s+(?:the\s+|my\s+)?(?:(\d+(?:\.\d+)?)\s+)?(?:spot\s+)?([a-zA-Z]{2,10})(?:\s+in\s+my\s+wallet|\s+on\s+base)?\s+(?:with|at|using)?\s*(?:a\s+)?(?:(\d+(?:\.\d+)?)\s*%\s*(?:stop(?:[\s-]?loss)?|drop)|stop[\s-]?loss\s+(?:at|@)\s+\$?(\d+(?:\.\d+)?)|if\s+it\s+drops\s+to\s+\$?(\d+(?:\.\d+)?))/i

export function parseSpotGuardArm(message: string): SpotGuardAsk | null {
  if (!SPOT_MARKER.test(message)) return null
  if (PERP_WORDS.test(message)) return null
  if (!PROTECT_SHAPE.test(message)) return null
  const m = message.match(SPOT_ARM_RE)
  if (!m) return null
  const [, amount, token, pct, priceAt, priceDrop] = m
  const tok = token.toUpperCase()
  if (tok === 'SPOT' || tok === 'THE' || tok === 'MY') return null
  if (pct) {
    const value = Number(pct)
    if (!(value > 0 && value < 90)) return null
    return { token: tok, triggerMode: 'price_move_pct', triggerValue: value, ...(amount ? { amountHuman: amount } : {}) }
  }
  const price = Number(priceAt ?? priceDrop)
  if (!(price > 0)) return null
  return { token: tok, triggerMode: 'price', triggerValue: price, ...(amount ? { amountHuman: amount } : {}) }
}

export type SpotGuardManage = { op: 'pause' | 'resume' | 'cancel'; token: string | null }

const SPOT_MANAGE_RE =
  /\b(pause|resume|cancel|remove|stop\s+watching)\s+(?:the\s+|my\s+)?(?:([a-zA-Z]{2,10})\s+)?spot\s+(?:protection|guard(?:ian)?|stop[\s-]?loss)\b/i

export function parseSpotGuardManage(message: string): SpotGuardManage | null {
  const m = message.match(SPOT_MANAGE_RE)
  if (!m) return null
  const op = /pause/i.test(m[1]) ? 'pause' : /resume/i.test(m[1]) ? 'resume' : 'cancel'
  const tok = m[2] && !/^(my|the)$/i.test(m[2]) ? m[2].toUpperCase() : null
  return { op, token: tok }
}

// ── Permission ⇄ policy agreement (arm route AND sweep — one rulebook) ─────

export interface PolicyTerms {
  ownerWallet: string
  spender: string
  /** ERC-20 address of the protected asset, or the native sentinel. */
  tokenAddress: string
  amountAtoms: bigint
  nowSec: number
}

export function permissionMatchesPolicy(p: SpotSpendPermission, t: PolicyTerms): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (p.account.toLowerCase() !== t.ownerWallet.toLowerCase()) problems.push('permission account is not the policy owner')
  if (p.spender.toLowerCase() !== t.spender.toLowerCase()) problems.push('permission spender is not the bound Pantessa spender')
  if (p.token.toLowerCase() !== t.tokenAddress.toLowerCase()) problems.push('permission token is not the protected asset')
  if (p.allowance !== t.amountAtoms) problems.push('allowance must be exactly the protected amount')
  if (p.period !== p.end - p.start) problems.push('period must span the whole permission life (one-shot pull)')
  if (p.start > t.nowSec) problems.push('permission is not valid yet')
  if (p.end <= t.nowSec) problems.push('permission has expired — re-arm to keep the guard')
  if (p.end - p.start > PERMISSION_LIFE_SECONDS + PERMISSION_START_GRACE_SECONDS) problems.push('permission life exceeds the one-year bound')
  if (p.extraData !== '0x') problems.push('extraData must be empty')
  return { ok: problems.length === 0, problems }
}

// ── The fail-closed guard (independent calldata re-decode) ─────────────────

const WETH_DEPOSIT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
] as const

export interface SpotSellStep {
  to: string
  data: string
  /** Decimal string wei. */
  value: string
}

export interface SpotSellGuardInput {
  policy: {
    /** The sweep claims active→triggered BEFORE building; the guard sees 'triggered'. */
    status: string
    tokenAddress: string
    native: boolean
    amountAtoms: bigint
    trigger: SpotTrigger
  }
  permission: SpotSpendPermission
  ownerWallet: string
  spender: string
  chain: { chainId: number; usdcAddress: string; swapRouter02: string; wethAddress: string }
  /** The venue mark the sweep quoted at — the guard re-runs the trigger. */
  markPrice: number
  /** The sweep's own quote floor; the swap's minOut must be ≥ this. */
  minOutAtomic: bigint
  steps: SpotSellStep[]
  pulledAtomic: bigint
  nowSec: number
}

const check = (id: string, ok: boolean, note: string): GuardrailCheck => ({ id, level: 'block', ok, note })

/**
 * Every byte re-decoded, every number re-derived — the sweep may only send
 * what this passes. Expected shapes:
 *   native:  [wrap(WETH.deposit, value=pull)] + approve(WETH) + swap
 *   erc20:   approve(token) + swap
 * with swap = SwapRouter02.multicall(deadline, [exactInputSingle(...)]),
 * tokenIn = the (wrapped) protected asset, tokenOut = USDC, recipient =
 * the OWNER, amountIn = the pull, minOut ≥ the quote floor.
 */
export function guardSpotSell(input: SpotSellGuardInput): { ok: boolean; checks: GuardrailCheck[] } {
  const { policy, permission, ownerWallet, spender, chain, markPrice, minOutAtomic, steps, pulledAtomic, nowSec } = input
  const checks: GuardrailCheck[] = []

  checks.push(check('claimed', policy.status === 'triggered', policy.status === 'triggered' ? 'Policy holds the idempotent trigger claim.' : `Policy is ${policy.status} — the sweep must claim before building.`))

  const expectedToken = policy.native ? NATIVE_TOKEN_SENTINEL : policy.tokenAddress
  const match = permissionMatchesPolicy(permission, {
    ownerWallet,
    spender,
    tokenAddress: expectedToken,
    amountAtoms: policy.amountAtoms,
    nowSec,
  })
  checks.push(check('permission', match.ok, match.ok ? 'Permission binds exactly the protected amount to the bound spender, one-shot.' : match.problems.join('; ')))

  checks.push(check('pull-amount', pulledAtomic === permission.allowance, pulledAtomic === permission.allowance ? 'Pull is exactly the signed allowance — never more.' : `Pull ${pulledAtomic} ≠ signed allowance ${permission.allowance}.`))

  const fired = spotTriggerFired(policy.trigger, markPrice)
  checks.push(check('trigger', fired.fired, fired.fired ? `Trigger re-verified: ${fired.note}.` : `Trigger did NOT fire at the quoted mark (${fired.note}) — refusing to sell.`))

  const hasFloor = minOutAtomic > BigInt(0)
  checks.push(check('min-out', hasFloor, hasFloor ? 'A live quote floor is set.' : 'No quote floor — refusing a floorless market sell.'))

  // Step shape: [wrap?] approve swap.
  const expectWrap = policy.native
  const expectedSteps = expectWrap ? 3 : 2
  if (steps.length !== expectedSteps) {
    checks.push(check('steps', false, `Expected ${expectWrap ? 'wrap+approve+swap' : 'approve+swap'} (${expectedSteps} steps), got ${steps.length}.`))
    return { ok: false, checks }
  }
  const [wrapStep, approveStep, swapStep] = expectWrap
    ? [steps[0], steps[1], steps[2]]
    : [null, steps[0], steps[1]]
  // The asset the router spends: the wrapped native, or the ERC-20 itself.
  const sellAddr = (expectWrap ? chain.wethAddress : policy.tokenAddress).toLowerCase()

  if (wrapStep) {
    let wrapOk = false
    let note = 'Wrap step does not decode as WETH.deposit for exactly the pull.'
    if (wrapStep.to.toLowerCase() === chain.wethAddress.toLowerCase() && wrapStep.value === pulledAtomic.toString()) {
      try {
        const dec = decodeFunctionData({ abi: WETH_DEPOSIT_ABI, data: wrapStep.data as `0x${string}` })
        wrapOk = dec.functionName === 'deposit'
        note = wrapOk ? 'Pulled ETH wraps to WETH, value = exactly the pull.' : note
      } catch {
        /* refusal stands */
      }
    }
    checks.push(check('wrap', wrapOk, note))
  }

  let approveOk = false
  let approveNote = 'Approve step does not decode as an exact-amount approval to SwapRouter02.'
  if (approveStep.to.toLowerCase() === sellAddr && approveStep.value === '0') {
    try {
      const dec = decodeFunctionData({ abi: erc20Abi, data: approveStep.data as `0x${string}` })
      if (dec.functionName === 'approve') {
        const [spenderArg, amountArg] = dec.args as [string, bigint]
        approveOk = spenderArg.toLowerCase() === chain.swapRouter02.toLowerCase() && amountArg === pulledAtomic
        approveNote = approveOk
          ? 'Exact-amount approval of the protected asset to the pinned SwapRouter02.'
          : `Approve pays ${spenderArg} for ${amountArg} — not the pinned router for the exact pull.`
      }
    } catch {
      /* refusal stands */
    }
  }
  checks.push(check('approve', approveOk, approveNote))

  let swapOk = false
  let swapNote = 'Swap step does not decode as a pinned SwapRouter02 multicall.'
  if (swapStep.to.toLowerCase() === chain.swapRouter02.toLowerCase() && swapStep.value === '0') {
    try {
      const outer = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: swapStep.data as `0x${string}` })
      if (outer.functionName === 'multicall') {
        const [deadline, calls] = outer.args as [bigint, readonly `0x${string}`[]]
        if (Number(deadline) <= nowSec) {
          swapNote = 'Swap deadline already passed — stale build.'
        } else if (calls.length !== 1) {
          swapNote = `Expected exactly the swap in the multicall, got ${calls.length} calls.`
        } else {
          const inner = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[0] })
          if (inner.functionName === 'exactInputSingle') {
            const p = (inner.args as readonly unknown[])[0] as {
              tokenIn: string
              tokenOut: string
              recipient: string
              amountIn: bigint
              amountOutMinimum: bigint
            }
            const problems: string[] = []
            if (p.tokenIn.toLowerCase() !== sellAddr) problems.push('tokenIn is not the protected asset')
            if (p.tokenOut.toLowerCase() !== chain.usdcAddress.toLowerCase()) problems.push('tokenOut is not USDC')
            if (p.recipient.toLowerCase() !== ownerWallet.toLowerCase()) problems.push(`recipient ${p.recipient} is not the OWNER`)
            if (p.amountIn !== pulledAtomic) problems.push(`amountIn ${p.amountIn} ≠ the pull`)
            if (p.amountOutMinimum < minOutAtomic) problems.push(`minOut ${p.amountOutMinimum} below the quote floor ${minOutAtomic}`)
            swapOk = problems.length === 0
            swapNote = swapOk
              ? 'Sell decodes exactly: protected asset → USDC, owner receives, minOut at the quote floor.'
              : problems.join('; ')
          }
        }
      }
    } catch {
      /* refusal stands */
    }
  }
  checks.push(check('swap', swapOk, swapNote))

  return { ok: checks.every((c) => c.ok), checks }
}
