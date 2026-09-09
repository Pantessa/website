// ─────────────────────────────────────────────────────────────────────────
//  "what stocks can I buy on robinhood" — a READ question the planner used
//  to answer with brokerage prose ("I'm not a financial advisor… US stocks,
//  ETFs") and, once (prod 2026-09-08, a $4k wallet), by calling a PAID
//  x402 pricing endpoint on the house burner. The answer is a fact we hold:
//  Robinhood Chain's curated stock list (lib/token-list, chain 4663). Pure
//  grammar here; the route composes the list + buy chips.
// ─────────────────────────────────────────────────────────────────────────

import { chainById } from '@/lib/chains'
import { resolveToken } from '@/lib/cow'
import { dynamicTokensFor } from '@/lib/token-list'

export const ROBINHOOD_CHAIN_ID = 4663

const QUESTION_RE =
  /^(?:(?:hey|hi|ok|okay|so)[,\s]+)?(?:(?:can|could|would)\s+(?:i|you|we)\s+)?(?:(?:please\s+)?(?:show(?:\s+me)?|list|tell\s+me|give\s+me|see)|what(?:'s|\s+is|\s+are|\s+kind\s+of|\s+sort\s+of)?|which|do\s+you\s+(?:have|support|offer)|are\s+there|is\s+there|how\s+many)\b/i
const IMPERATIVE_RE = /^(?:(?:i\s+)?(?:want|wanna|would\s+like)\s+to\s+)?(?:buy|trade|invest\s+in|get)\s+(?:some\s+|a\s+few\s+|a\s+)?(?:tokenized\s+|tokenised\s+)?(?:stocks?|equities|shares)\b/i
// "can i buy stocks here" — the verb followed DIRECTLY by the plural noun.
// A company name in between ("can i buy apple stock") is an order for the
// swap layer's name pairing, never the list.
const CAN_BUY_RE = /^(?:(?:hey|hi|ok|okay|so)[,\s]+)?(?:can|could|would)\s+(?:i|we|you)\s+(?:buy|trade|get|invest\s+in)\s+(?:some\s+|any\s+|a\s+few\s+)?(?:tokenized\s+|tokenised\s+)?(?:stocks?|equities|shares)\b/i
const STOCK_WORD_RE = /\b(?:stocks?|equities|tokeni[sz]ed\s+(?:stocks?|shares|equities))\b/i
const CONTEXT_RE = /\b(?:robin\s?hoo?d(?:\s?chain)?|tokeni[sz]ed|on[\s-]?chain|available|buy|trade|tradeable|tradable|support(?:ed)?|offer|list)\b/i
// A ticker or an amount means it's an ORDER, never a list question
// ("buy $10 of AAPL stock", "buy 5 shares of TSLA").
const ORDER_SHAPE_RE = /\$\s?\d|\b\d+(?:\.\d+)?\s+(?:shares?|of)\b|\b[A-Z]{2,5}\b(?=\s+(?:stock|shares?)\b)/

export interface StockListAsk {
  kind: 'stock-list'
}

/** The list question, or null. Never claims an order. */
export function parseStockListAsk(message: string): StockListAsk | null {
  const m = message.trim()
  if (!STOCK_WORD_RE.test(m)) return null
  if (ORDER_SHAPE_RE.test(m)) return null
  const question = QUESTION_RE.test(m) && CONTEXT_RE.test(m)
  const imperative = IMPERATIVE_RE.test(m) || CAN_BUY_RE.test(m)
  return question || imperative ? { kind: 'stock-list' } : null
}

/** Is this symbol an exact entry on Robinhood Chain's STOCK list? 4663's
 *  list = stocks + exactly two infra classes (wrapped gas, stables) —
 *  resolving there to a non-infra address IS the stock proof. Callers warm
 *  the 4663 list (lib/token-list ensureTokenList). */
export function isRobinhoodStockSymbol(symbol: string): boolean {
  const addr = resolveToken(symbol, ROBINHOOD_CHAIN_ID)
  if (!addr) return false
  const rh = chainById(ROBINHOOD_CHAIN_ID)
  if (!rh) return false
  const wethAddr = resolveToken('WETH', ROBINHOOD_CHAIN_ID)
  const isInfra = addr.toLowerCase() === (wethAddr ?? '').toLowerCase() || rh.stables[addr.toLowerCase()] !== undefined
  return !isInfra
}

/** Every stock ticker on the warmed 4663 list, A→Z, with names where the
 *  list carries them. Empty when the list never warmed — callers say so. */
export function robinhoodStocks(): { symbol: string; name?: string }[] {
  const seen = new Set<string>()
  const out: { symbol: string; name?: string }[] = []
  for (const t of dynamicTokensFor(ROBINHOOD_CHAIN_ID)) {
    const sym = t.symbol.toUpperCase()
    if (seen.has(sym) || !isRobinhoodStockSymbol(sym)) continue
    seen.add(sym)
    out.push({ symbol: sym, ...(t.name ? { name: t.name } : {}) })
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/** The household names to lead the chips with, in this order, when present. */
export const FEATURED_STOCKS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY']
