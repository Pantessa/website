// ─────────────────────────────────────────────────────────────────────────
//  CoW venue adapter for the guardrail core (lib/tx-guardrails — the
//  venue-neutral Yeetful layer). This file owns ONLY what's CoW-specific:
//  fee-share semantics, the VaultRelayer allowance + balance reads, the
//  stable-leg USD valuation of a GPv2 order, and the policy host CoW spend
//  is attributed to. Recipient/validity/policy checks come from the core so
//  every venue enforces identical safety.
// ─────────────────────────────────────────────────────────────────────────

import { erc20Abi } from 'viem'
import { publicClient } from '@/lib/auth'
import { chainById, publicClientFor } from '@/lib/chains'
import {
  buildReport,
  policyCheck,
  recipientCheck,
  validityCheck,
  type GuardrailCheck,
  type GuardrailReport,
} from '@/lib/tx-guardrails'
import { formatAtoms, tokenLabel, cowAppDataBpsOf, type CowQuoteResult, type CowOrderParameters } from '@/lib/cow'
import { SWAP_FEE_BPS, TREASURY_ADDRESS } from '@/lib/fees'

// Re-export the core's types/builders so existing CoW call sites and tests
// keep one import surface; new venues import lib/tx-guardrails directly.
export { buildReport, policyCheck, type GuardrailCheck, type GuardrailReport }

/** GPv2 VaultRelayer — the contract the sell token must be approved to.
 *  Same address on every CoW chain. */
export const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

/** The ledger/policy host for CoW orders — what shows on receipts and what
 *  the grant allowlist gates. */
export const COW_POLICY_HOST = 'api.cow.fi'

/** Stables we can price at $1 face value — per-chain maps in lib/chains.ts. */
function stablesFor(chainId: number): Record<string, number> {
  return chainById(chainId)?.stables ?? {}
}

/** Fee sanity as a share of sellAmount: warn above 1%, block above 5%. */
const FEE_WARN = 0.01
const FEE_BLOCK = 0.05
/** Slippage tolerance cap (basis points). */
export const MAX_SLIPPAGE_BPS = 500

/** USD value via the stable side: sell side preferred (that's what leaves the
 *  wallet), else buy side. Null when neither side is a known stable. */
export function orderValueUsd(order: CowOrderParameters, chainId = 8453): number | null {
  const stables = stablesFor(chainId)
  const side = (token: string, atoms: string): number | null => {
    const dec = stables[token.toLowerCase()]
    if (dec === undefined) return null
    const v = Number(atoms) / 10 ** dec
    return Number.isFinite(v) ? v : null
  }
  // Sell side includes the fee — that's the real outflow.
  const sell = side(order.sellToken, String(BigInt(order.sellAmount) + BigInt(order.feeAmount || '0')))
  if (sell !== null) return sell
  return side(order.buyToken, order.buyAmount)
}

/** CoW fee sanity — quotes carry a signed fee; limit orders sign fee 0. */
function feeCheck(order: CowOrderParameters): GuardrailCheck {
  const sell = Number(order.sellAmount)
  const fee = Number(order.feeAmount || '0')
  const feeShare = sell > 0 ? fee / sell : 0
  return {
    id: 'fee',
    level: feeShare > FEE_BLOCK ? 'block' : 'warn',
    ok: feeShare <= FEE_BLOCK ? feeShare <= FEE_WARN : false,
    note:
      feeShare === 0
        ? 'No signed fee (limit order — fee comes from surplus).'
        : `Fee is ${(feeShare * 100).toFixed(2)}% of the sell amount${feeShare > FEE_BLOCK ? ' — too high, refusing' : feeShare > FEE_WARN ? ' — unusually high' : ''}.`,
  }
}

/** The order must sign OUR appData doc — order.appData is the keccak of the
 *  exact JSON Yeetful attributes orders with (incl. the partner fee when the
 *  protocol fee is on). A quote whose appDataHash differs signed someone
 *  else's document (fee stripped or hooks injected) — refuse, never offer. */
function appDataCheck(order: CowOrderParameters): GuardrailCheck {
  // Two-doc family (C2b): the base tier and the link tier are BOTH ours;
  // anything else signed someone else's document. The note names the exact
  // rate this order carries — the tier is inside the signed hash, so it can
  // never be restated after the fact.
  const bps = cowAppDataBpsOf(order.appData)
  const ok = bps !== null
  return {
    id: 'app-data',
    level: 'block',
    ok,
    note: ok
      ? bps > 0
        ? `Order carries Yeetful's appData: CoW settles a ${bps / 100}% partner fee to the treasury (${TREASURY_ADDRESS.slice(0, 6)}…${TREASURY_ADDRESS.slice(-4)}) inside the protocol — no extra step to sign.`
        : "Order carries Yeetful's appData attribution."
      : 'Order appData is not the document Yeetful builds with — refusing (fee/hook tampering).',
  }
}

/** Pure checks — venue-neutral recipient/validity from the core + CoW fee. */
export function pureChecks(quote: CowQuoteResult, from: string, nowSec = Math.floor(Date.now() / 1000)): GuardrailCheck[] {
  const { order } = quote
  return [recipientCheck(order.receiver, from), validityCheck(order.validTo, nowSec), feeCheck(order), appDataCheck(order)]
}

/** On-chain reads: does `from` hold the sell amount, and has it approved the
 *  CoW VaultRelayer? Warn-level — orders may be signed before funding; they
 *  just won't settle until both are true. Runs on any registry chain (Base
 *  keeps the dedicated lib/auth client; others use the per-chain factory). */
export async function chainChecks(quote: CowQuoteResult, from: string): Promise<GuardrailCheck[]> {
  const client = quote.chainId === 8453 ? publicClient : publicClientFor(quote.chainId)
  if (!client) {
    return [{ id: 'chain-reads', level: 'warn', ok: true, note: `Balance/allowance not checked on chain ${quote.chainId}.` }]
  }
  const token = quote.order.sellToken as `0x${string}`
  const owner = from as `0x${string}`
  const needed = BigInt(quote.order.sellAmount) + BigInt(quote.order.feeAmount || '0')
  const human = (v: bigint) => formatAtoms(v.toString(), 18, 6) // fallback label only
  try {
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, COW_VAULT_RELAYER as `0x${string}`] }),
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
