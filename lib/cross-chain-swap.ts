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
import { chainAlt, canonicalChainWord, normalizeChainWords, prettyChainWord, unknownDestinationWord } from '@/lib/chain-lexicon'

// Chain words we accept in a swap phrase (kept separate from token matching so
// a token is never mistaken for a chain). Aliases come from the shared
// typo-tolerant lexicon; captures are canonicalized before they reach the
// MCP or any keyed lookup ("Etheruem" → ethereum). The short/ambiguous
// names (sol, btc, near, ton, tron, sui, op) are safe HERE because they
// only match inside the from/to chain slots of an already-swap-shaped ask.
const CHAIN_ALT = `${chainAlt()}|sol|btc|near|ton|tron|sui|op`

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

// Under-specified shapes that are still clearly cross-chain moves — each
// gets an honest clarify naming EXACTLY the missing piece, never a generic
// re-ask for things already in the message (the 2026-07-22 dead-end).
// "move my USDC from base to solana" — origin present, amount missing.
const AMOUNTLESS_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade|transfer)\\s+(?:my\\s+|all\\s+(?:my\\s+)?|some\\s+)?(${TOKEN})\\s+(?:from|on)\\s+(${CHAIN_ALT})\\b`,
  'i',
)
// "bridge 5 USDC to Arbitrum" — destination present, origin missing.
const DEST_ONLY_RE = new RegExp(
  `\\b(?:swap|bridge|move|convert|send|trade|transfer)\\s+(${AMOUNT})\\s+(${TOKEN})\\s+(?:to|into|onto)\\s+(${CHAIN_ALT})\\b`,
  'i',
)

/**
 * Parse an imperative cross-chain swap. Returns the params, a `problem` when
 * it's clearly a cross-chain swap but under-specified, or null when it isn't
 * one at all (→ falls through to normal routing / quote questions).
 */
export function parseCrossChainSwap(rawMessage: string): CrossChainSwapParams | { problem: string } | null {
  const message = normalizeChainWords(rawMessage)
  const o = message.match(ORIGIN_RE)
  if (!o) {
    // Wh-questions ("what's the cheapest way to move USDT from …") belong to
    // the planner's quote tools — the clarifies below are for imperatives.
    if (/^\s*(?:what|how|why|where|when|which|who)\b/i.test(message)) return null
    const al = message.match(AMOUNTLESS_RE)
    if (al) {
      const tok = cleanTok(al[1]).toUpperCase()
      const dest = message.slice((al.index ?? 0) + al[0].length).match(DEST_RE)
      const destWord = dest ? prettyChainWord(canonicalChainWord(dest[2]) ?? dest[2]) : 'Arbitrum'
      const originWord = prettyChainWord(canonicalChainWord(al[2]) ?? al[2])
      return { problem: `How much ${tok}? Say e.g. “swap 5 ${tok} from ${originWord} to ${destWord}” and I'll build it.` }
    }
    const dOnly = message.match(DEST_ONLY_RE)
    if (dOnly) {
      const tok = cleanTok(dOnly[2]).toUpperCase()
      return { problem: `Which chain should the ${dOnly[1]} ${tok} come FROM? Say e.g. “swap ${dOnly[1]} ${tok} from Base to ${prettyChainWord(canonicalChainWord(dOnly[3]) ?? dOnly[3])}” and I'll build it.` }
    }
    return null
  }
  const rest = message.slice((o.index ?? 0) + o[0].length)
  const d = rest.match(DEST_RE)
  const originToken = cleanTok(o[2])
  if (!d) {
    // Grammar missed the destination — but before re-asking for what may
    // already be in the message, try the word actually sitting in the "to …"
    // slot: a fuzzy chain typo becomes the destination, and a word we truly
    // don't know gets NAMED in the clarify (the "Etheruem" dead-end asked
    // for "the amount and pair" the user had already typed).
    const unknown = unknownDestinationWord(rest)
    const fuzzy = rest.match(/\bto\s+([A-Za-z]{5,14})\b/i)
    const fuzzyChain = fuzzy ? canonicalChainWord(fuzzy[1]) : null
    if (fuzzyChain) {
      return {
        amount: o[1],
        originToken,
        originChain: canonicalChainWord(o[3]) ?? o[3],
        destinationToken: originToken,
        destinationChain: fuzzyChain,
      }
    }
    if (unknown) {
      return {
        problem: `I don't recognize “${unknown}” as a chain. I can reach Base, Ethereum, Arbitrum, Optimism, Polygon, Solana, and ~30 more — say the destination like “swap ${o[1]} ${originToken.toUpperCase()} from ${o[3]} to Arbitrum”.`,
      }
    }
    return { problem: `Got it — ${o[1]} ${originToken.toUpperCase()} from ${o[3]}. Tell me the destination chain too, e.g. “swap ${o[1]} ${originToken.toUpperCase()} from ${o[3]} to Arbitrum”.` }
  }
  return {
    amount: o[1],
    originToken,
    // Canonicalize before the MCP call / chain-id lookups — the grammar
    // accepts typo aliases, downstream maps key on canonical words.
    originChain: canonicalChainWord(o[3]) ?? o[3],
    // Same token on the other chain unless a second token is named.
    destinationToken: d[1] ? cleanTok(d[1]) : originToken,
    destinationChain: canonicalChainWord(d[2]) ?? d[2],
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
/** The app-fee echo the MCP passes through from 1Click's quote response:
 *  what we asked for, and the 50/50 split 1Click actually applied. */
export interface BuiltAppFee {
  requested?: Array<{ recipient?: string; fee?: number }>
  applied?: Array<{ recipient?: string; fee?: number }> | null
  note?: string
}
export interface BuiltSwap {
  kind?: string
  appFee?: BuiltAppFee
  quote?: { sell?: { amountAtoms?: string; token?: string; chain?: string; usd?: string }; receive?: { token?: string; chain?: string }; summary?: string }
  deposit?: { address?: string; addressExpires?: string | null; deliveredTo?: string }
  balanceCheck?: { ok?: boolean | null; note?: string }
  steps?: BuiltStep[]
  warnings?: string[]
}

/**
 * Guardrail-priced notional of the leg — the quote's own USD figure (the
 * 1Click API prices the sell side as `amountInUsd`), null when absent or
 * unparseable. Must ride guardrails.valueUsd on every offered build: a
 * signed turn with null value never counts toward money moved and never
 * ranks on the intent-links board.
 */
export function crossChainValueUsd(built: BuiltSwap): number | null {
  const usd = Number(built.quote?.sell?.usd)
  return Number.isFinite(usd) && usd > 0 ? Number(usd.toFixed(2)) : null
}

export interface GuardResult {
  ok: boolean
  /** Block reasons — when non-empty the tx must NOT be offered for signing. */
  reasons: string[]
  /** Advisory notes (e.g. low balance) — shown but not blocking. */
  warnings: string[]
  /** Operator-only notes about the venue fee — traced, never user-facing. */
  feeNotes?: string[]
  /** Net bps of the venue fee this build actually carries (0 when none). */
  feeBps?: number
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
/**
 * Verify the venue fee on a build we asked to carry one. The user's funds are
 * never at risk from the fee itself — it comes out of the OUTPUT, so a
 * missing one costs us revenue, not them — but an EVM recipient we did NOT
 * pin means someone redirected value out of the user's swap, and that is a
 * refusal. 1Click's own protocol share arrives as a non-EVM implicit
 * account, so only 0x recipients are ours to police.
 *
 * Returns block reasons (fatal) and notes (advisory, e.g. the fee silently
 * didn't apply because the MCP hasn't been redeployed yet).
 */
export function checkCrossChainFee(
  built: BuiltSwap,
  expected: { recipient: string; bps: number } | null,
): { reasons: string[]; notes: string[] } {
  const reasons: string[] = []
  const notes: string[] = []
  const applied = built.appFee?.applied
  if (!expected) {
    // We asked for no fee — any app fee at all is unexpected value leaving
    // the swap, and we refuse rather than pass it on.
    if (applied?.length) reasons.push('The quote carries an app fee we did not request — refusing.')
    return { reasons, notes }
  }
  if (!applied?.length) {
    notes.push('fee not applied by the venue (older MCP build) — the swap is unaffected')
    return { reasons, notes }
  }
  const evmEntries = applied.filter((f) => typeof f.recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(f.recipient))
  const ours = evmEntries.filter((f) => eqAddr(f.recipient, expected.recipient))
  const foreign = evmEntries.filter((f) => !eqAddr(f.recipient, expected.recipient))
  if (foreign.length > 0) {
    reasons.push(`The quote pays an app fee to an address we did not pin (${foreign[0].recipient}) — refusing.`)
  }
  if (ours.length === 0) {
    notes.push('fee not applied by the venue — the swap is unaffected')
  }
  const totalBps = applied.reduce((s, f) => s + (typeof f.fee === 'number' ? f.fee : 0), 0)
  if (totalBps > expected.bps) {
    reasons.push(`The quote's app fee (${totalBps} bps) exceeds the ${expected.bps} bps we requested — refusing.`)
  }
  return { reasons, notes }
}

export function guardCrossChainBuild(
  built: BuiltSwap,
  expected: { chainId: number | null; fee?: { recipient: string; bps: number } | null },
): GuardResult {
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

  // Fee problems that BLOCK are reasons; the rest are operator notes (traced,
  // never shown as a "⚠️ Heads up" — a fee that didn't apply is our revenue
  // problem, not something the user needs to worry about mid-swap).
  const fee = checkCrossChainFee(built, expected.fee ?? null)
  reasons.push(...fee.reasons)

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    feeNotes: fee.notes,
    // What the USER paid (the requested rate), only once the venue confirms
    // it applied — the disclosure line must never claim a fee that isn't on
    // the quote, and never omit one that is.
    feeBps: fee.notes.length === 0 && expected.fee ? expected.fee.bps : 0,
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
