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
import { canonicalChainWord, chainMentions } from './chain-lexicon'

export interface SwapIntent {
  isSwap: boolean
  mode?: 'swap' | 'limit'
  sellAmountHuman?: string
  /** Dollar-denominated sell ("swap $1 worth of ETH…") — the route prices the
   *  token and converts to sellAmountHuman before building. Exactly one of
   *  sellAmountHuman / sellAmountUsd is set on a complete parse. */
  sellAmountUsd?: string
  /** Unset on a buy-dollar ask with no spend token named ("buy $5 of AAPL")
   *  — the route fills in the chain's primary stable. */
  sellToken?: string
  /** Unset on a bare sell with no buy side named ("sell $50 of ETH") — the
   *  route fills in the chain's primary stable (chips when the sell side IS
   *  the stable). */
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
// it belongs to a cross-chain agent (NEAR Intents). Chain words come from
// the shared typo-tolerant lexicon (lib/chain-lexicon): "Etheruem" and
// "arbitum" are real users mid-flow, not strangers ("Etheruem" fell to the
// same-chain clarify live, 2026-07-22). Short/ambiguous names (sol, ton,
// near, tron, sui, op) only count next to a chain preposition — "a ton of
// USDC" is not a chain.

export interface CrossChainRead {
  /** True when the ask clearly spans chains (or explicitly says so). */
  crossChain: boolean
  /** Distinct canonical chains the message names, detection order. */
  chains: string[]
}

/** Pure read of the chains a message names + whether it's a cross-chain ask. */
export function detectCrossChain(message: string): CrossChainRead {
  const distinct = chainMentions(message).map((m) => m.chain)
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
// "$1" / "1 dollar" / "1.50 usd" / "5 bucks" — group 1 xor group 2 carries
// the number. Users hedge dollar asks ("about $1 worth"), so a filler word
// is tolerated before the amount (the live 2026-07-14 dead-end: "can i swap
// about $1 worth of ETH for USDG?").
const FILLER = String.raw`(?:(?:about|around|roughly|approximately|approx\.?|~)\s*)?`
const USD_AMOUNT = String.raw`(?:\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:dollars?|usd|bucks?))`
const usdOf = (m: RegExpMatchArray, i: number) => m[i] ?? m[i + 1]

// "swap/sell/convert/trade 100 USDC for/to/into WETH"
const MARKET_RE = new RegExp(
  String.raw`\b(?:swap|sell|convert|trade)\s+${AMOUNT}\s*${TOKEN}\s+(?:for|to|into)\s+${TOKEN}\b`,
  'i',
)
// "swap (about) $1 (worth) of/in ETH for/to/into USDG" — dollar-denominated
// sell; the route prices the token and converts before building.
const DOLLAR_MARKET_RE = new RegExp(
  String.raw`\b(?:swap|sell|convert|trade)\s+${FILLER}${USD_AMOUNT}(?:\s+worth)?\s+(?:of|in)\s+${TOKEN}\s+(?:for|to|into)\s+${TOKEN}\b`,
  'i',
)
// "buy (about) $5 (worth) of/in AAPL (with/using USDG)" — spend token
// optional; the route defaults it to the chain's primary stable. Stock asks
// arrive share-flavored too ("buy $20 shares of AAPL", "buy $20 worth of
// shares of AAPL" — live 2026-07-22: the phrasing missed this grammar and
// fell to the planner, which quoted and asked for a confirm instead of
// building the signable swap in one turn).
const BUY_DOLLAR_RE = new RegExp(
  String.raw`\bbuy\s+${FILLER}${USD_AMOUNT}(?:\s+worth)?\s+(?:(?:of|in)\s+(?:shares?\s+(?:of|in)\s+)?|shares?\s+(?:of|in)\s+)${TOKEN}(?:\s+(?:with|using)\s+${TOKEN})?`,
  'i',
)
// "buy 5 shares of AAPL" — a share-COUNT ask. Buys here are sized in what
// you spend, not what you receive (exact-output stock swaps aren't wired),
// so this clarifies deterministically toward the dollar phrasing instead of
// falling to the planner's quote-and-confirm detour.
const BUY_SHARES_COUNT_RE = new RegExp(String.raw`\bbuy\s+${FILLER}${AMOUNT}\s+shares?\s+(?:of|in)\s+${TOKEN}`, 'i')
// "I need $50 of USDG on Robinhood, can you make that happen?" — an
// ACQUISITION ask: no buy/swap verb, but the same shape as a dollar buy
// (dollars + target token; the spend token is the route's to default).
// Live 2026-07-23: this exact ask fell to the planner, which replied
// "USDG is not a standard token" — about the one token Robinhood Chain
// trades everything against. When the target IS the chain's own stable,
// the route answers with the funding plan instead of a swap.
const NEED_DOLLAR_RE = new RegExp(
  String.raw`\b(?:i\s+)?(?:need|want|get\s+me)\s+${FILLER}${USD_AMOUNT}(?:\s+worth)?\s+(?:of|in)\s+${TOKEN}\b`,
  'i',
)
// "sell/swap $50 (worth) of/in ETH" — a sell with NO buy side named (the
// chart overlay's Sell chip sends exactly this shape). The route fills the
// buy side with the chain's primary stable — the mirror of the buy-dollar
// default. Live 2026-07-28: "Sell $50 of ETH" got the prose clarify, the
// typed "USDC" answer fell to the planner, and the planner called CoW with
// an invalid chain enum — three turns, nothing built.
const SELL_DOLLAR_NO_TARGET_RE = new RegExp(
  String.raw`\b(?:swap|sell|convert|trade)\s+${FILLER}${USD_AMOUNT}(?:\s+worth)?\s+(?:of|in)\s+${TOKEN}\b`,
  'i',
)
// "sell 0.25 ETH" — unit-amount sell, no buy side named.
const SELL_UNIT_NO_TARGET_RE = new RegExp(String.raw`\b(?:swap|sell|convert|trade)\s+${AMOUNT}\s*${TOKEN}\b`, 'i')
// The no-target token slot must hold a real symbol: filler words ("sell 2 of
// my NFTs" puts "of" there) and dollar words never claim; chain words are
// guarded separately (canonicalChainWord, ≥5 chars — eth/base stay tokens).
const NO_TARGET_STOPWORDS = /^(?:of|my|the|an?|to|for|in|on|at|it|that|this|these|them|some|all|more|worth|usd|dollars?|bucks?|shares?|percent|pct)$/i
const claimableBareToken = (tok: string) => !NO_TARGET_STOPWORDS.test(tok) && !(tok.length >= 5 && canonicalChainWord(tok))
// Dollar amounts on OTHER venues (perps etc.) must not be hijacked into a
// spot swap — "buy $12 of ETH on hyperliquid" belongs to the HL exec layer.
const OTHER_VENUE_RE = /\bhyperliquid\b|\bperp(?:s|etual)?\b|\bleverage\b|\b\d+x\b/i
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
    // "swap 1 USDC to arbitrum" — the buy slot holds a CHAIN, not a token.
    // Building a token literally named "ARBITRUM" is a dead-end (or worse);
    // this is a cross-chain move missing its origin — say exactly that.
    // Four-letter-and-under words (eth, sol, base) stay tokens: too ambiguous.
    const destChain = m[3].length >= 5 ? canonicalChainWord(m[3]) : null
    if (destChain) {
      return {
        isSwap: true,
        problem: `Which chain should the ${m[1]} ${m[2].toUpperCase()} come FROM? That looks like a cross-chain move — say e.g. “swap ${m[1]} ${m[2].toUpperCase()} from Base to ${destChain}” and I'll build it.`,
      }
    }
    return { isSwap: true, mode: 'swap', sellAmountHuman: m[1], sellToken: m[2], buyToken: m[3] }
  }
  if (!OTHER_VENUE_RE.test(message)) {
    const dm = message.match(DOLLAR_MARKET_RE)
    if (dm) {
      return { isSwap: true, mode: 'swap', sellAmountUsd: usdOf(dm, 1), sellToken: dm[3], buyToken: dm[4] }
    }
    const bm = message.match(BUY_DOLLAR_RE)
    if (bm) {
      // sellToken stays unset when no spend token is named — the route fills
      // in the chain's primary stable (USDC on Base, USDG on Robinhood).
      return { isSwap: true, mode: 'swap', sellAmountUsd: usdOf(bm, 1), buyToken: bm[3], sellToken: bm[4] }
    }
    const sm = message.match(BUY_SHARES_COUNT_RE)
    if (sm) {
      // buyToken rides along so the clarify can offer preset-$ chips.
      return {
        isSwap: true,
        buyToken: sm[2],
        problem: `Buys here are sized by what you spend — say it in dollars ("buy $20 of ${sm[2].toUpperCase()}") and I'll build it at the live price.`,
      }
    }
    // Acquisition asks ride the dollar-buy shape: "I need $50 of USDG" ≡
    // "buy $50 of USDG" as far as the route is concerned (the route's
    // stable-target branch decides funding-plan vs swap). Checked LAST so a
    // real verb ("I want to swap 1 USDC for WETH") keeps its own grammar,
    // and never on cadence asks — "I need $10 of AAPL every week" belongs
    // to the DCA layer, and a one-shot buy would silently eat the schedule.
    const nm = message.match(NEED_DOLLAR_RE)
    if (nm && !/\b(?:every|each|daily|weekly|monthly)\b/i.test(message)) {
      return { isSwap: true, mode: 'swap', sellAmountUsd: usdOf(nm, 1), buyToken: nm[3] }
    }
    // Sells with no buy side — the route defaults the buy to the chain's
    // primary stable (selling the stable itself asks with chips instead).
    const sd = message.match(SELL_DOLLAR_NO_TARGET_RE)
    if (sd && claimableBareToken(sd[3])) {
      return { isSwap: true, mode: 'swap', sellAmountUsd: usdOf(sd, 1), sellToken: sd[3] }
    }
    const su = message.match(SELL_UNIT_NO_TARGET_RE)
    if (su && claimableBareToken(su[2])) {
      return { isSwap: true, mode: 'swap', sellAmountHuman: su[1], sellToken: su[2] }
    }
  }
  if (swapish(message)) {
    // A pair with no amount ("swap USDC for WETH") stays under-specified
    // (`problem` set — callers gate on it) but CARRIES the pair, so the
    // route can answer with tappable preset amounts instead of prose
    // homework. A chain word in either slot is a cross-chain shape, not a
    // pair — carry nothing.
    const pm = message.match(PAIR_NO_AMOUNT_RE)
    const pairOk = pm && claimableBareToken(pm[1]) && claimableBareToken(pm[2])
    return {
      isSwap: true,
      problem: 'Say the amount and pair — e.g. “swap 100 USDC for WETH” or “swap $5 of ETH for USDG”.',
      ...(pairOk ? { sellToken: pm[1], buyToken: pm[2] } : {}),
    }
  }
  return NOT_SWAP
}

// ── Chip-bearing clarifies ───────────────────────────────────────────────────
// When a swap ask IS under-specified, hand the user options to TAP, not
// homework (live 2026-07-28: the chart chip's "Sell $50 of ETH" got "Say the
// amount and pair…" and the typed answers fell to the planner). Every resume
// is a COMPLETE ask that round-trips parseSwapIntent — the chip is the
// contract, same as funding/DCA/stock-pairing chips.

export interface SwapClarifyChips {
  reply: string
  question: string
  options: { label: string; resume: string }[]
}

const PRESET_USD = [25, 50, 100] as const

/**
 * Compose a chip clarify for an under-specified swap intent, or null when the
 * parse doesn't pin enough to write complete resumes (prose is all that's
 * left then). `targets` supplies buy-side candidates for a stable sell —
 * chain-aware, so the route passes the chain's own token list.
 */
export function swapClarify(intent: SwapIntent, opts: { targets?: string[] } = {}): SwapClarifyChips | null {
  if (!intent.isSwap || intent.mode === 'limit') return null
  const sell = intent.sellToken?.toUpperCase()
  const buy = intent.buyToken?.toUpperCase()
  const amountless = !intent.sellAmountHuman && !intent.sellAmountUsd
  // Pair known, amount missing ("swap USDC for WETH") → preset $ amounts.
  if (sell && buy && amountless) {
    return {
      reply: `How much ${sell} → ${buy}? Pick an amount, or say one — “swap $5 of ${sell} for ${buy}”, “swap 100 ${sell} for ${buy}”.`,
      question: `How much ${sell}?`,
      options: PRESET_USD.map((usd) => ({ label: `$${usd}`, resume: `Swap $${usd} of ${sell} for ${buy}` })),
    }
  }
  // Target known, amount missing ("buy 5 shares of AAPL" — sized by what you
  // spend, so the chips restate it in dollars).
  if (!sell && buy && amountless) {
    return {
      reply: `Buys are sized by what you spend — pick an amount for ${buy}, or say one (“buy $20 of ${buy}”).`,
      question: `How much ${buy}?`,
      options: PRESET_USD.map((usd) => ({ label: `$${usd}`, resume: `Buy $${usd} of ${buy}` })),
    }
  }
  // Amount known, buy side missing, and the sell side is the chain's own
  // stable ("sell $50 of USDC") — no honest default; offer the chain's
  // targets. Two minimum: one option is not a question (lib/clarify drops
  // single-option payloads client-side).
  const targets = opts.targets ?? []
  if (sell && !buy && !amountless && targets.length >= 2) {
    const amountPhrase = intent.sellAmountUsd ? `$${intent.sellAmountUsd} of ${sell}` : `${intent.sellAmountHuman} ${sell}`
    return {
      reply: `Swap ${amountPhrase} into what? Pick a target, or name any token (“swap ${amountPhrase} for ETH”).`,
      question: `Buy what with the ${sell}?`,
      options: targets.slice(0, 4).map((t) => ({ label: t.toUpperCase(), resume: `Swap ${amountPhrase} for ${t.toUpperCase()}` })),
    }
  }
  return null
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
export function swapWorkingContext(intent: SwapIntent, venue: 'uniswap' | 'cow' | 'lifi', prior?: WorkingContext, chainId?: number): WorkingContext {
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
      summary: `${mode === 'limit' ? 'limit order' : 'swap'} ${amount} ${sellToken} → ${buyToken} on ${venue === 'cow' ? 'CoW' : venue === 'lifi' ? 'the chain’s own venue (LiFi-routed)' : 'Uniswap'} — awaiting the user's signature`,
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
