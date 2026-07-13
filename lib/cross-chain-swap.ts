// ─────────────────────────────────────────────────────────────────────────
//  Native cross-chain swap building — the deterministic, guardrailed path
//  from "swap 1 USDC from Base to Arbitrum" to a SIGNABLE deposit transfer.
//
//  The native Uniswap/CoW swap layer is Base-only; this is its cross-chain
//  sibling. It NEVER goes through the planner or the house model — a terse
//  "confirm" once made the house model FABRICATE a deposit address in prose
//  (live 2026-07-10, near-lost funds). Instead we parse the ask ourselves,
//  call the NEAR Intents agent's `build_swap` tool directly, and GUARDRAIL
//  the returned transfer (it must move exactly the quoted amount to the
//  API's one-time deposit address, on the origin chain) before surfacing it
//  as a Sign button. The deposit address only ever comes from the tool, and
//  the tx the user signs is the one we verified — no model text in between.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'
import type { EvmTxRequest } from '@/lib/transaction-layer'

// Chain words we accept in a swap phrase (kept separate from token matching so
// a token is never mistaken for a chain). The MCP does the real normalization;
// we just need to locate the two chains and pass their names through.
const CHAIN_ALT =
  'base|arbitrum|arb(?:itum|itrium)?|ethereum|eth\\s?mainnet|mainnet|optimism|polygon|matic|gnosis|xdai|avalanche|avax|bnb(?:\\s?chain)?|bsc|binance|scroll|robinhood(?:\\s?chain)?|solana|sol|bitcoin|btc|near|ton|tron|sui|op'

const AMOUNT = '\\d+(?:\\.\\d+)?'
const TOKEN = '\\$?[A-Za-z]{2,12}|0x[0-9a-fA-F]{40}'

// "(swap|bridge|move|convert|send) <amt> <tokenA> (from|on) <chainA>"
const ORIGIN_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade)\\s+(${AMOUNT})\\s+(${TOKEN})\\s+(?:from|on)\\s+(${CHAIN_ALT})\\b`,
  'i',
)
// "… to [[<amt>] <tokenB> (on|to)] <chainB>" — the amount AND the token are
// both optional ("to arbitrum" / "to ETH on optimism" / "to 1 USDC on arb").
const DEST_RE = new RegExp(
  `\\bto\\s+(?:(?:${AMOUNT}\\s+)?(${TOKEN})\\s+(?:on|to)\\s+)?(${CHAIN_ALT})\\b`,
  'i',
)

export interface CrossChainSwapParams {
  amount: string
  originToken: string
  originChain: string
  destinationToken: string
  destinationChain: string
}

const cleanTok = (t: string) => t.replace(/^\$/, '')

/**
 * Parse an imperative cross-chain swap. Returns the params, a `problem` when
 * it's clearly a cross-chain swap but under-specified, or null when it isn't
 * one at all (→ falls through to normal routing / quote questions).
 */
export function parseCrossChainSwap(message: string): CrossChainSwapParams | { problem: string } | null {
  const o = message.match(ORIGIN_RE)
  if (!o) return null
  const rest = message.slice((o.index ?? 0) + o[0].length)
  const d = rest.match(DEST_RE)
  if (!d) {
    return { problem: "Tell me the destination chain too — e.g. “swap 1 USDC from Base to Arbitrum”." }
  }
  const originToken = cleanTok(o[2])
  return {
    amount: o[1],
    originToken,
    originChain: o[3],
    // Same token on the other chain unless a second token is named.
    destinationToken: d[1] ? cleanTok(d[1]) : originToken,
    destinationChain: d[2],
  }
}

// EVM chain ids for the origin chains the MCP can BUILD on — used only to
// sanity-check the built tx's chainId (the MCP already refuses non-EVM origins).
const ORIGIN_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  arb: 42161,
  ethereum: 1,
  mainnet: 1,
  optimism: 10,
  op: 10,
  polygon: 137,
  matic: 137,
  bnb: 56,
  bsc: 56,
  binance: 56,
  avalanche: 43114,
  avax: 43114,
  gnosis: 100,
  xdai: 100,
  scroll: 534352,
  robinhood: 4663,
  'robinhood chain': 4663,
}

export function expectedOriginChainId(chain: string): number | null {
  return ORIGIN_CHAIN_IDS[chain.trim().toLowerCase()] ?? null
}

// ── The shape `build_swap` returns (the slices we verify) ────────────────────
interface BuiltStep {
  action?: string
  label?: string
  summary?: string
  tx?: { to?: string; data?: string; value?: string; chainId?: number }
}
export interface BuiltSwap {
  kind?: string
  quote?: { sell?: { amountAtoms?: string; token?: string; chain?: string }; receive?: { token?: string; chain?: string }; summary?: string }
  deposit?: { address?: string; addressExpires?: string | null; deliveredTo?: string }
  balanceCheck?: { ok?: boolean | null; note?: string }
  steps?: BuiltStep[]
  warnings?: string[]
}

export interface GuardResult {
  ok: boolean
  /** Block reasons — when non-empty the tx must NOT be offered for signing. */
  reasons: string[]
  /** Advisory notes (e.g. low balance) — shown but not blocking. */
  warnings: string[]
  tx?: EvmTxRequest
  depositAddress?: string
  summary?: string
  addressExpires?: string | null
}

const eqAddr = (a?: string, b?: string): boolean => {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Verify a `build_swap` result before it can be signed. The one job that
 * matters for safety: the transaction the user signs must transfer EXACTLY
 * the quoted amount to the API's one-time deposit address, on the origin
 * chain — nothing the model wrote, only what the tool built and we decoded.
 */
export function guardCrossChainBuild(built: BuiltSwap, expected: { chainId: number | null }): GuardResult {
  const reasons: string[] = []
  const warnings: string[] = []

  const step = built.steps?.[0]
  const tx = step?.tx
  const depositAddress = built.deposit?.address
  const amountAtoms = built.quote?.sell?.amountAtoms

  if (built.kind !== 'swap_ready' || !step || step.action !== 'send_transaction' || !tx?.to) {
    reasons.push('The swap did not build into a signable transaction.')
    return { ok: false, reasons, warnings }
  }
  if (!depositAddress || !isAddress(depositAddress)) {
    reasons.push('No valid one-time deposit address was returned — refusing to build a transfer to an unknown address.')
    return { ok: false, reasons, warnings }
  }
  if (!amountAtoms) {
    reasons.push('The quoted amount is missing — cannot verify the transfer amount.')
    return { ok: false, reasons, warnings }
  }
  if (expected.chainId !== null && tx.chainId !== expected.chainId) {
    reasons.push(`The built transaction targets chain ${tx.chainId ?? '?'}, not the origin chain (${expected.chainId}).`)
  }

  const data = tx.data ?? '0x'
  const value = tx.value ?? '0'
  if (data === '0x') {
    // Native transfer: the value goes straight to the deposit address.
    if (!eqAddr(tx.to, depositAddress)) {
      reasons.push('The native transfer is not addressed to the quoted deposit address.')
    }
    if (BigInt(value) !== BigInt(amountAtoms)) {
      reasons.push('The native transfer amount does not match the quote.')
    }
  } else {
    // ERC-20 transfer(depositAddress, amountIn) to the token contract.
    if (value !== '0') reasons.push('An ERC-20 transfer must carry zero native value.')
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` })
      if (decoded.functionName !== 'transfer') {
        reasons.push(`The transaction calls "${decoded.functionName}", not transfer — refusing.`)
      } else {
        const [to, amt] = decoded.args as [string, bigint]
        if (!eqAddr(to, depositAddress)) reasons.push('The transfer recipient is not the quoted deposit address.')
        if (amt !== BigInt(amountAtoms)) reasons.push('The transfer amount does not match the quote.')
      }
    } catch {
      reasons.push('Could not decode the transfer calldata — refusing to sign an opaque transaction.')
    }
  }

  if (built.balanceCheck?.ok === false && built.balanceCheck.note) {
    warnings.push(built.balanceCheck.note)
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    tx: reasons.length === 0 ? { to: tx.to, data, value, chainId: tx.chainId, action: 'deposit' } : undefined,
    depositAddress,
    summary: step.summary ?? built.quote?.summary,
    addressExpires: built.deposit?.addressExpires ?? null,
  }
}

// ── Pending-action follow-ups (cancel / amend), same idea as swap-intent ─────

const CC_CANCEL_RE =
  /^(?:no[,.!]?\s*)?(?:cancel|scratch|drop|abandon|abort|forget|nevermind|never\s+mind|don'?t)(?:\s+(?:it|that|this|the))?(?:\s+(?:swap|bridge|transfer|deposit|one))?[.!\s]*$/i
const CC_AMEND_RE = new RegExp(
  `^(?:ok(?:ay)?[,.]?\\s*)?(?:actually[,.]?\\s*)?(?:make\\s+(?:it|that)|change\\s+(?:it|that)(?:\\s+to)?|do)\\s+(${AMOUNT})(?:\\s+[A-Za-z]{2,12})?(?:\\s+instead)?[.!?\\s]*$`,
  'i',
)

export type CrossChainFollowUp =
  | { kind: 'cancel' }
  | { kind: 'amend'; params: CrossChainSwapParams }
  | { kind: 'noop' }

/**
 * Resolve a follow-up against a pending cross-chain swap (already built +
 * awaiting signature). Conservative: cancel, an amount amendment, or noop
 * (an affirmation like "confirm"/"yes" — the button is already there, so we
 * just re-point at it, never re-fabricate). Anything else returns null → the
 * message routes normally.
 */
export function parseCrossChainFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): CrossChainFollowUp | null {
  if (!pending || pending.kind !== 'xchain') return null
  const text = message.trim()
  if (CC_CANCEL_RE.test(text)) return { kind: 'cancel' }
  const amend = text.match(CC_AMEND_RE)
  if (amend) {
    return {
      kind: 'amend',
      params: {
        amount: amend[1],
        originToken: pending.data.originToken ?? '',
        originChain: pending.data.originChain ?? '',
        destinationToken: pending.data.destinationToken ?? '',
        destinationChain: pending.data.destinationChain ?? '',
      },
    }
  }
  // "confirm" / "yes" / "go ahead" against an already-built swap → the button
  // is right there; don't build a second deposit address, just say so.
  if (/^(?:ok(?:ay)?|yes|yep|yeah|confirm|go(?:\s+ahead)?|do\s+it|proceed|send\s+it|sign)[.!\s]*$/i.test(text)) {
    return { kind: 'noop' }
  }
  return null
}

export function crossChainPending(params: CrossChainSwapParams, depositAddress: string, summary: string) {
  return {
    kind: 'xchain',
    summary,
    data: {
      amount: params.amount,
      originToken: params.originToken,
      originChain: params.originChain,
      destinationToken: params.destinationToken,
      destinationChain: params.destinationChain,
      depositAddress,
    },
  }
}
