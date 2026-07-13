// ─────────────────────────────────────────────────────────────────────────
//  Swap intent — deterministic parse of a natural-language swap ask (A2c).
//  Mirrors lib/vote-intent: a cheap, pure gate the chat route runs when a CoW
//  service is active. Detection is deliberately conservative: a full
//  amount+pair match proceeds; a swap-ish message with missing pieces gets a
//  clarifying `problem`; anything else falls through to normal routing.
//  Amount parsing stays HUMAN here — atoms conversion (decimals!) happens at
//  build time via humanToAtoms, where the token is resolved.
// ─────────────────────────────────────────────────────────────────────────

import type { WorkingContext } from './working-context'

export interface SwapIntent {
  isSwap: boolean
  mode?: 'swap' | 'limit'
  sellAmountHuman?: string
  sellToken?: string
  buyToken?: string
  /** Limit orders only: the minimum acceptable buy amount (the named price). */
  buyAmountAtLeastHuman?: string
  /** Set when the message is clearly a swap ask but under-specified. */
  problem?: string
}

const NOT_SWAP: SwapIntent = { isSwap: false }

// ── Cross-chain detection ────────────────────────────────────────────────────
// The native venue layer (Uniswap/CoW) is Base-only by design. A swap ask
// that names OTHER chains ("swap 1 USDC from base to arbitrum", "bridge to
// solana") must never be hijacked into a Base build or a dead-end clarify —
// it belongs to a cross-chain agent (NEAR Intents). Detection is pure and
// deliberately typo-tolerant where users actually typo ("arbitum", live
// 2026-07-09). Short/ambiguous names (sol, ton, near, tron, sui, op) only
// count next to a chain preposition — "a ton of USDC" is not a chain.
const CHAIN_WORDS: [chain: string, re: RegExp][] = [
  ['base', /\bbase\b/i],
  ['arbitrum', /\barb(?:itrum|itum|itrium)?\b/i],
  ['ethereum', /\bethereum\b|\beth\s?mainnet\b|\bmainnet\b/i],
  ['optimism', /\boptimism\b/i],
  ['polygon', /\bpolygon\b|\bmatic\b/i],
  ['bnb', /\bbsc\b|\bbnb(?:\s?chain)?\b|\bbinance\b/i],
  ['avalanche', /\bavalanche\b|\bavax\b/i],
  ['gnosis', /\bgnosis\b|\bxdai\b/i],
  ['scroll', /\bscroll\b/i],
  ['robinhood', /\brobinhood(?:\s?chain)?\b/i],
  ['solana', /\bsolana\b|(?:\bon|\bfrom|\bto|\binto)\s+sol\b/i],
  ['bitcoin', /\bbitcoin\b|(?:\bon|\bfrom|\bto|\binto)\s+btc\b/i],
  ['near', /(?:\bon|\bfrom|\bto|\binto)\s+near\b/i],
  ['ton', /(?:\bon|\bfrom|\bto|\binto)\s+ton\b/i],
  ['tron', /(?:\bon|\bfrom|\bto|\binto)\s+tron\b/i],
  ['sui', /(?:\bon|\bfrom|\bto|\binto)\s+sui\b/i],
  ['op', /(?:\bon|\bfrom|\bto|\binto)\s+op\b/i],
]

export interface CrossChainRead {
  /** True when the ask clearly spans chains (or explicitly says so). */
  crossChain: boolean
  /** Distinct chains the message names, detection order. */
  chains: string[]
}

/** Pure read of the chains a message names + whether it's a cross-chain ask. */
export function detectCrossChain(message: string): CrossChainRead {
  const chains = CHAIN_WORDS.filter(([, re]) => re.test(message)).map(([chain]) => chain)
  // op + optimism both firing is one chain, not two.
  const distinct = [...new Set(chains.map((c) => (c === 'op' ? 'optimism' : c)))]
  const explicit = /\bcross[\s-]?chain\b/i.test(message) || (/\bbridge\b/i.test(message) && distinct.length >= 1)
  return { crossChain: distinct.length >= 2 || explicit, chains: distinct }
}

// ── Cross-chain agent resolution ─────────────────────────────────────────────
// Matched on slug/name/description so custom modal-added rows count too.
export const CROSS_CHAIN_MCP_RE = /near[\s-]?intents|cross[\s-]?chain/i

export interface CrossChainAgentRead<T> {
  /** The first working-set agent that claims cross-chain capability. */
  agent?: T
  /** True when that agent can actually be CALLED. A row without an endpoint
   *  (an add-MCP shell whose tool discovery failed — seen live 2026-07-09 as
   *  `near-intents-mcp-yeetful`, endpoint:null, 0 endpoints) contributes
   *  nothing to the planner menu; routing a swap at it makes the planner
   *  hallucinate venue options. Unusable → answer honestly instead. */
  usable: boolean
}

/** Find the working set's cross-chain-capable agent and whether it's callable. */
export function crossChainAgentOf<T extends { slug: string; name: string; description?: string | null; endpoint?: string | null }>(
  servers: T[],
): CrossChainAgentRead<T> {
  const agent = servers.find((s) => CROSS_CHAIN_MCP_RE.test(`${s.slug} ${s.name} ${s.description ?? ''}`))
  return { agent, usable: !!agent?.endpoint }
}

const AMOUNT = String.raw`(\d+(?:\.\d+)?)`
const TOKEN = String.raw`\$?([a-zA-Z]{2,10}|0x[0-9a-fA-F]{40})`

// "swap/sell/convert/trade 100 USDC for/to/into WETH"
const MARKET_RE = new RegExp(
  String.raw`\b(?:swap|sell|convert|trade)\s+${AMOUNT}\s*${TOKEN}\s+(?:for|to|into)\s+${TOKEN}\b`,
  'i',
)
// "limit … sell 0.5 WETH for/at/when it hits (at least) 1750 USDC"
const LIMIT_RE = new RegExp(
  String.raw`\b(?:sell|swap)\s+${AMOUNT}\s*${TOKEN}\s+(?:for|at|when(?:\s+it)?\s+hits?)\s+(?:at\s+least\s+)?${AMOUNT}\s*${TOKEN}\b`,
  'i',
)
// "swap USDC for WETH" — a pair with no amount → ask how much.
const PAIR_NO_AMOUNT_RE = new RegExp(
  String.raw`\b(?:swap|convert|trade)\s+${TOKEN}\s+(?:for|to|into)\s+${TOKEN}\b`,
  'i',
)
// Swap-ish enough to clarify (imperative + a number somewhere) — plain
// questions like "what is a swap?" fall through to normal routing.
const swapish = (message: string) =>
  PAIR_NO_AMOUNT_RE.test(message) || (/\b(?:swap|convert)\b|\bsell\b/i.test(message) && /\d/.test(message))

export function parseSwapIntent(message: string): SwapIntent {
  const wantsLimit = /\blimit\b/i.test(message)

  if (wantsLimit) {
    const m = message.match(LIMIT_RE)
    if (m) {
      return {
        isSwap: true,
        mode: 'limit',
        sellAmountHuman: m[1],
        sellToken: m[2],
        buyAmountAtLeastHuman: m[3],
        buyToken: m[4],
      }
    }
    if (swapish(message)) {
      return {
        isSwap: true,
        problem:
          'For a limit order, name the full price — e.g. “limit order: sell 0.5 WETH for at least 1750 USDC”.',
      }
    }
    return NOT_SWAP
  }

  const m = message.match(MARKET_RE)
  if (m) {
    return { isSwap: true, mode: 'swap', sellAmountHuman: m[1], sellToken: m[2], buyToken: m[3] }
  }
  if (swapish(message)) {
    return {
      isSwap: true,
      problem: 'Say the amount and pair — e.g. “swap 100 USDC for WETH”.',
    }
  }
  return NOT_SWAP
}

// ── Working context for swap/order artifacts (invariant #11) ─────────────────
// A returned artifact is a PENDING action the user is looking at: the next
// turn's "actually make it 2 USDC" / "cancel that" must resolve against it,
// not against a re-parse of prose.

/**
 * The working context a swap/order artifact turn returns. `pending.kind`:
 * 'order' = a CoW EIP-712 order awaiting SignOrderButton; 'swap' = a Uniswap
 * transaction awaiting SendTxButton. The prior turn's scope/offers are carried
 * — building a swap doesn't erase the list the user was just shown.
 */
export function swapWorkingContext(intent: SwapIntent, venue: 'uniswap' | 'cow', prior?: WorkingContext, chainId?: number): WorkingContext {
  const mode = intent.mode ?? 'swap'
  const sellToken = (intent.sellToken ?? '').toUpperCase()
  const buyToken = (intent.buyToken ?? '').toUpperCase()
  const amount = intent.sellAmountHuman ?? ''
  return {
    v: 1,
    age: 0,
    ...(prior?.scope ? { scope: prior.scope } : {}),
    ...(prior?.offers ? { offers: prior.offers } : {}),
    pending: {
      kind: venue === 'cow' ? 'order' : 'swap',
      summary: `${mode === 'limit' ? 'limit order' : 'swap'} ${amount} ${sellToken} → ${buyToken} on ${venue === 'cow' ? 'CoW' : 'Uniswap'} — awaiting the user's signature`,
      data: {
        sellToken,
        buyToken,
        amount,
        venue,
        mode,
        // The chain the artifact was built for — "make it 2" amends rebuild
        // on the SAME chain, never silently back on Base.
        ...(chainId && chainId !== 8453 ? { chainId: String(chainId) } : {}),
        ...(intent.buyAmountAtLeastHuman ? { buyAmountAtLeast: intent.buyAmountAtLeastHuman } : {}),
      },
    },
  }
}

export type SwapFollowUp = { kind: 'cancel' } | { kind: 'amend'; intent: SwapIntent }

const CANCEL_RE =
  /^(?:no[,.!]?\s*)?(?:cancel|scratch|drop|abandon|abort|forget|nevermind|never\s+mind|don'?t\s+(?:do|send|sign|submit))(?:\s+(?:it|that|this|the))?(?:\s+(?:swap|order|trade|one))?[.!\s]*$/i
// "actually make it 2 USDC" / "change it to 0.5" / bare "2 USDC". The verb is
// optional only when a token is named — a lone number is too ambiguous to
// hijack (it could be answering a numbered list).
const AMEND_RE = new RegExp(
  String.raw`^(?:ok(?:ay)?[,.]?\s*)?(?:actually[,.]?\s*)?(?:(make\s+(?:it|that)|change\s+(?:it|that)(?:\s+to)?|let'?s\s+do|how\s+about|do)\s+)?${AMOUNT}\s*([a-zA-Z]{2,10})?(?:\s+instead)?[.!?\s]*$`,
  'i',
)

/**
 * Deterministic follow-up resolution against a pending swap/order artifact.
 * Conservative: anything not clearly a cancel or an amount amendment returns
 * null and the message routes normally.
 */
export function parseSwapFollowUp(
  message: string,
  pending: { kind: string; summary: string; data: Record<string, string> } | undefined,
): SwapFollowUp | null {
  if (!pending || (pending.kind !== 'swap' && pending.kind !== 'order')) return null
  const { sellToken, buyToken, mode } = pending.data
  if (!sellToken || !buyToken) return null
  const text = message.trim()
  if (CANCEL_RE.test(text)) return { kind: 'cancel' }
  // Amending a LIMIT order's sell amount silently changes its price — too
  // surprising to do deterministically. Only market swaps amend.
  if (mode === 'limit') return null
  const m = text.match(AMEND_RE)
  if (!m) return null
  const [, verb, amount, token] = m
  if (!verb && !token) return null
  // A named token must be the SELL side — "make it 2 WETH" against a
  // USDC→WETH order flips the meaning; let it route normally instead.
  if (token && token.toUpperCase() !== sellToken.toUpperCase()) return null
  return { kind: 'amend', intent: { isSwap: true, mode: 'swap', sellAmountHuman: amount, sellToken, buyToken } }
}
