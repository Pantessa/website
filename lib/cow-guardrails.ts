// ─────────────────────────────────────────────────────────────────────────
//  Safe-build guardrails (A3) — the checks between "order built" and "order
//  offered for signature". This is the moat: a raw model can fetch a quote;
//  Yeetful refuses to hand you a signable order that pays someone else, has
//  an absurd fee, drifted from the market, or violates your spend policy.
//
//  CoW orders are OFF-CHAIN intents, so "simulate" here means: recipient/
//  validity/fee sanity (pure), balance + vault-relayer allowance reads
//  (on-chain), and the spend-policy gate (lib/spend-grant — reused, not
//  forked). Levels: 'block' withholds the artifact; 'warn' ships it with a
//  visible flag (e.g. unfunded wallet — the user may fund before settlement).
// ─────────────────────────────────────────────────────────────────────────

import { erc20Abi } from 'viem'
import { publicClient } from '@/lib/auth'
import { grantViolation, type GrantPolicy, type GrantViolation } from '@/lib/spend-grant'
import { formatAtoms, tokenLabel, type CowQuoteResult, type CowOrderParameters } from '@/lib/cow'

/** GPv2 VaultRelayer — the contract the sell token must be approved to.
 *  Same address on every CoW chain. */
export const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

/** The ledger/policy host for CoW orders — what shows on receipts and what
 *  the grant allowlist gates. */
export const COW_POLICY_HOST = 'api.cow.fi'

export interface GuardrailCheck {
  id: string
  level: 'block' | 'warn'
  ok: boolean
  note: string
}

export interface GuardrailReport {
  /** True when no block-level check failed — the artifact may be offered. */
  ok: boolean
  /** USD value of the order (stable-side heuristic); null when unpriceable. */
  valueUsd: number | null
  checks: GuardrailCheck[]
}

/** Base stables we can price at $1 face value, with decimals. */
const STABLES: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6, // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6, // USDbC
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI
}

/** Longest validity we'll offer for signature (limit orders wait, but an
 *  unbounded signed order is a standing liability). */
const MAX_VALID_SEC = 31 * 24 * 3600
/** Fee sanity as a share of sellAmount: warn above 1%, block above 5%. */
const FEE_WARN = 0.01
const FEE_BLOCK = 0.05
/** Slippage tolerance cap (basis points). */
export const MAX_SLIPPAGE_BPS = 500

/** USD value via the stable side: sell side preferred (that's what leaves the
 *  wallet), else buy side. Null when neither side is a known stable. */
export function orderValueUsd(order: CowOrderParameters, chainId = 8453): number | null {
  if (chainId !== 8453) return null
  const side = (token: string, atoms: string): number | null => {
    const dec = STABLES[token.toLowerCase()]
    if (dec === undefined) return null
    const v = Number(atoms) / 10 ** dec
    return Number.isFinite(v) ? v : null
  }
  // Sell side includes the fee — that's the real outflow.
  const sell = side(order.sellToken, String(BigInt(order.sellAmount) + BigInt(order.feeAmount || '0')))
  if (sell !== null) return sell
  return side(order.buyToken, order.buyAmount)
}

/** Pure checks — recipient, validity window, fee share. Deterministic and
 *  unit-tested; no network, no clock beyond `nowSec`. */
export function pureChecks(quote: CowQuoteResult, from: string, nowSec = Math.floor(Date.now() / 1000)): GuardrailCheck[] {
  const { order } = quote
  const checks: GuardrailCheck[] = []

  const recipientOk = order.receiver.toLowerCase() === from.toLowerCase()
  checks.push({
    id: 'recipient',
    level: 'block',
    ok: recipientOk,
    note: recipientOk
      ? 'Proceeds return to your wallet.'
      : `Order pays ${order.receiver} — NOT the requesting wallet ${from}.`,
  })

  const notExpired = order.validTo > nowSec
  const notForever = order.validTo <= nowSec + MAX_VALID_SEC
  checks.push({
    id: 'validity',
    level: 'block',
    ok: notExpired && notForever,
    note: !notExpired
      ? 'Order is already expired.'
      : !notForever
        ? `Order stays signable for more than ${MAX_VALID_SEC / 86400} days — refuse a standing liability.`
        : `Valid for ${Math.round((order.validTo - nowSec) / 60)} min.`,
  })

  const sell = Number(order.sellAmount)
  const fee = Number(order.feeAmount || '0')
  const feeShare = sell > 0 ? fee / sell : 0
  checks.push({
    id: 'fee',
    level: feeShare > FEE_BLOCK ? 'block' : 'warn',
    ok: feeShare <= FEE_BLOCK ? feeShare <= FEE_WARN : false,
    note:
      feeShare === 0
        ? 'No signed fee (limit order — fee comes from surplus).'
        : `Fee is ${(feeShare * 100).toFixed(2)}% of the sell amount${feeShare > FEE_BLOCK ? ' — too high, refusing' : feeShare > FEE_WARN ? ' — unusually high' : ''}.`,
  })

  return checks
}

/** On-chain reads: does `from` hold the sell amount, and has it approved the
 *  CoW VaultRelayer? Warn-level — orders may be signed before funding; they
 *  just won't settle until both are true. Base only (our publicClient). */
export async function chainChecks(quote: CowQuoteResult, from: string): Promise<GuardrailCheck[]> {
  if (quote.chainId !== 8453) {
    return [{ id: 'chain-reads', level: 'warn', ok: true, note: `Balance/allowance not checked on chain ${quote.chainId}.` }]
  }
  const token = quote.order.sellToken as `0x${string}`
  const owner = from as `0x${string}`
  const needed = BigInt(quote.order.sellAmount) + BigInt(quote.order.feeAmount || '0')
  const human = (v: bigint) => formatAtoms(v.toString(), 18, 6) // fallback label only
  try {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, COW_VAULT_RELAYER as `0x${string}`] }),
    ])
    const label = tokenLabel(quote.order.sellToken, quote.chainId)
    return [
      {
        id: 'balance',
        level: 'warn',
        ok: balance >= needed,
        note: balance >= needed
          ? `Wallet holds enough ${label}.`
          : `Wallet holds less ${label} than the order sells — it won't settle until funded.`,
      },
      {
        id: 'allowance',
        level: 'warn',
        ok: allowance >= needed,
        note: allowance >= needed
          ? 'CoW VaultRelayer allowance is in place.'
          : `Approve ${label} to the CoW VaultRelayer (${COW_VAULT_RELAYER}) or the order can't settle.`,
      },
    ]
  } catch {
    return [{ id: 'chain-reads', level: 'warn', ok: true, note: `Couldn't read balance/allowance (RPC) — unchecked (${human(needed)} needed).` }]
  }
}

/** The spend-policy gate at the point of signing — the SAME gate chat
 *  payments go through (lib/spend-grant), pointed at the order's USD value.
 *  Block-level: an unpriceable order under an enabled policy is refused
 *  (we never bypass a policy because we couldn't price the trade). */
export function policyCheck(
  valueUsd: number | null,
  policy: GrantPolicy | null,
  spentTodayUsd: number,
  spentTotalUsd = 0,
): { check: GuardrailCheck; violation: GrantViolation | 'VALUE_UNKNOWN' | null } {
  if (!policy) {
    return { check: { id: 'policy', level: 'warn', ok: true, note: 'No spend policy on this wallet — order not gated.' }, violation: null }
  }
  if (valueUsd === null) {
    if (!policy.spendPolicyEnabled) {
      return { check: { id: 'policy', level: 'warn', ok: true, note: 'Spend policy is off; order value unpriced.' }, violation: null }
    }
    return {
      check: {
        id: 'policy',
        level: 'block',
        ok: false,
        note: 'Spend policy is ON but the order has no stable leg to price — refusing rather than bypassing your caps.',
      },
      violation: 'VALUE_UNKNOWN',
    }
  }
  const violation = grantViolation(policy, COW_POLICY_HOST, valueUsd, spentTodayUsd, spentTotalUsd)
  return {
    check: {
      id: 'policy',
      level: 'block',
      ok: !violation,
      note: violation
        ? `Blocked by your spend policy: ${violation} ($${valueUsd.toFixed(2)} order).`
        : `Within your spend policy ($${valueUsd.toFixed(2)} order).`,
    },
    violation,
  }
}

/** Assemble the report. `ok` = no failed block-level check. */
export function buildReport(valueUsd: number | null, checks: GuardrailCheck[]): GuardrailReport {
  return { ok: checks.every((c) => c.ok || c.level !== 'block'), valueUsd, checks }
}
