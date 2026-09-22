// ─────────────────────────────────────────────────────────────────────────────
//  ERC-20 approval steps — the one rule every native builder shares.
//
//  A builder reads the live allowance and asks this module what to send:
//
//    allowance ≥ amount                         → nothing
//    allowance = 0, or an ordinary token        → approve(spender, amount)
//    0 < allowance < amount on a RESET token    → approve(spender, 0),
//                                                 then approve(spender, amount)
//
//  A reset token is one whose approve() reverts when the old allowance and
//  the new amount are both non-zero. Ethereum's USDT is the one in the
//  registry (lib/chains `approveReset`); before this rule a wallet with a
//  partial USDT allowance got an approve → swap chain whose first step
//  reverted AFTER the signature.
//
//  The guard half is independent of the builders: it decodes the steps it is
//  handed and accepts exactly the two shapes above. A zero approval on an
//  ordinary token, a reset with no approval behind it, a reset to another
//  spender, or a third step all refuse.
//
//  Pure: no RPC, no React — the harness imports it directly.
// ─────────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, erc20Abi } from 'viem'
import { chainById } from '@/lib/chains'

export interface ApprovalTx {
  to: string
  data: string
  value: string
  chainId: number
  action: string
}

export type ApprovalPlan = 'none' | 'approve' | 'reset-then-approve'

const eqAddr = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const ZERO = BigInt(0)

/** Does this token's approve() refuse a non-zero → non-zero change? Read from
 *  the registry by ADDRESS, so a symbol alias can't dodge it. */
export function approvalResetRequired(chainId: number, token: string): boolean {
  const chain = chainById(chainId)
  if (!chain) return false
  return Object.values(chain.tokens).some((t) => t.approveReset === true && eqAddr(t.address, token))
}

export function planApproval(input: { chainId: number; token: string; allowance: bigint; amount: bigint }): ApprovalPlan {
  if (input.allowance >= input.amount) return 'none'
  if (input.allowance > ZERO && approvalResetRequired(input.chainId, input.token)) return 'reset-then-approve'
  return 'approve'
}

const approveTx = (chainId: number, token: string, spender: string, amount: bigint, action: string): ApprovalTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender as `0x${string}`, amount] }),
  value: '0',
  chainId,
  action,
})

/** The steps for a plan: `resetTx` only on 'reset-then-approve', `approveTx`
 *  on anything but 'none'. Always exact-amount. */
export function approvalTxs(input: { chainId: number; token: string; spender: string; amount: bigint; plan: ApprovalPlan }): {
  resetTx: ApprovalTx | null
  approveTx: ApprovalTx | null
} {
  if (input.plan === 'none') return { resetTx: null, approveTx: null }
  return {
    resetTx: input.plan === 'reset-then-approve' ? approveTx(input.chainId, input.token, input.spender, ZERO, 'approve-reset') : null,
    approveTx: approveTx(input.chainId, input.token, input.spender, input.amount, 'approve'),
  }
}

export interface ApprovalGuardExpectations {
  chainId: number
  token: string
  spender: string
  /** The approval must sit in [floor, ceiling]. Exact-amount builders pass the
   *  same number twice. */
  floor: bigint
  ceiling: bigint
  /** How refusals name the spender ("the pinned SwapRouter02"). */
  spenderLabel: string
}

function decodeApprove(tx: { to?: string | null; data?: string | null; value?: string | null; chainId?: number }, exp: ApprovalGuardExpectations, name: string, reasons: string[]): bigint | null {
  if (tx.chainId !== undefined && tx.chainId !== exp.chainId) reasons.push(`The ${name} targets chain ${tx.chainId}, not ${exp.chainId}.`)
  if (!eqAddr(tx.to, exp.token)) reasons.push(`The ${name} does not target the token being spent.`)
  try {
    if (BigInt(tx.value || '0') !== ZERO) reasons.push(`The ${name} must carry zero native value.`)
  } catch {
    reasons.push(`The ${name} carries an unreadable native value — refusing.`)
  }
  try {
    const dec = decodeFunctionData({ abi: erc20Abi, data: (tx.data ?? '0x') as `0x${string}` })
    if (dec.functionName !== 'approve') {
      reasons.push(`The ${name} calls "${dec.functionName}", not approve — refusing.`)
      return null
    }
    const [spender, amount] = dec.args as [string, bigint]
    if (!eqAddr(spender, exp.spender)) reasons.push(`The ${name} spender is not ${exp.spenderLabel}.`)
    return amount
  } catch {
    reasons.push(`Could not decode the ${name} calldata — refusing.`)
    return null
  }
}

/**
 * Verify the approval steps in front of an action, in order. Accepts:
 *   []                                   (allowance already in place)
 *   [approve amount]
 *   [approve 0, approve amount]          — reset tokens only
 * and nothing else. Returns the refusal reasons (empty = ok).
 */
export function guardApprovalSteps(
  steps: Array<{ to?: string | null; data?: string | null; value?: string | null; chainId?: number }>,
  exp: ApprovalGuardExpectations,
): string[] {
  const reasons: string[] = []
  if (steps.length === 0) return reasons
  if (steps.length > 2) return [`Expected at most two approval steps (an allowance reset, then the approval), got ${steps.length} — refusing.`]

  if (steps.length === 2) {
    if (!approvalResetRequired(exp.chainId, exp.token)) {
      reasons.push('An allowance reset rides only on a token whose approve() requires one — refusing the extra step.')
    }
    const resetAmt = decodeApprove(steps[0], exp, 'allowance reset', reasons)
    if (resetAmt !== null && resetAmt !== ZERO) reasons.push('The first approval step is not a reset to zero — refusing two live approvals.')
  }

  const amount = decodeApprove(steps[steps.length - 1], exp, 'approval', reasons)
  if (amount !== null) {
    if (amount < exp.floor) reasons.push(amount === ZERO ? 'The approval is a bare reset to zero with no approval behind it — refusing.' : 'The approval is for less than the amount being spent.')
    else if (amount > exp.ceiling) reasons.push('The approval is for more than the amount being spent — exact-amount approvals only.')
  }
  return reasons
}
