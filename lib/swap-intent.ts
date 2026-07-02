// ─────────────────────────────────────────────────────────────────────────
//  Swap intent — deterministic parse of a natural-language swap ask (A2c).
//  Mirrors lib/vote-intent: a cheap, pure gate the chat route runs when a CoW
//  service is active. Detection is deliberately conservative: a full
//  amount+pair match proceeds; a swap-ish message with missing pieces gets a
//  clarifying `problem`; anything else falls through to normal routing.
//  Amount parsing stays HUMAN here — atoms conversion (decimals!) happens at
//  build time via humanToAtoms, where the token is resolved.
// ─────────────────────────────────────────────────────────────────────────

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
