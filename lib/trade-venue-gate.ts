// ─────────────────────────────────────────────────────────────────────────
//  A chip needs a venue that can fill it (Nate, 2026-09-22, on the /markets
//  row for AMBA: "if there is no way to swap a token we should not offer a
//  button to do it… make sure the system knows what's possible so people do
//  not click to dead flows").
//
//  Pure + client-safe, and shaped exactly like lib/sell-gate — the surfaces
//  already filter their chips through one sentence rule, so this is a second
//  one in the same place. Every surface that offers a Buy or Sell chip asks
//  `canTradeAsk` with the measured venue verdicts (lib/use-tradable) and
//  renders the chip only on a yes.
//
//  The rule reads the SENTENCE, so one rule covers every grammar, including
//  chip rows that span symbols (the morning tape) and compound asks whose
//  buy rides behind a funding leg ("Fund Robinhood Chain … then buy $50 of
//  TSLA").
//
//  What it judges, and what it leaves alone:
//  • a market Buy or Sell of the symbol itself — the same-chain swap the
//    cascade builds. Judged;
//  • a CoW LIMIT order — a different venue with its own book, and a resting
//    order is not a dead click. Left alone;
//  • a perp Long/Short, a stake, a supply, a borrow, a guardian, a bridge —
//    not swaps. Each carries its own venue fence. Left alone;
//  • a card buy ("… with a card") — it ends in the same swap, so an
//    unfillable symbol must not take someone through a checkout first.
//    Judged, on the buy it funds.
//
//  It fails OPEN: only a MEASURED, recent refusal hides anything
//  (lib/tradability canFill). A symbol nobody has read yet keeps its chips.
// ─────────────────────────────────────────────────────────────────────────

import { chainNamedInAsk, isSellAsk } from '@/lib/sell-gate'
import { canFill, fillRefusal, type SymbolTradability, type TradabilityMap, type TradeSideKey } from '@/lib/tradability'
import { normalizeWatchSymbol } from '@/lib/watchlists'

const SYM = String.raw`\$?([A-Za-z][A-Za-z0-9]{0,11})\b`
const USD = String.raw`\$\d[\d,]*(?:\.\d+)?`
const UNITS = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)`

/** A resting CoW order — its own venue, its own book. Never judged here. */
const LIMIT_RE = /^\s*limit\s+order\s*:/i

/** Where the token sits in each BUY shape the app composes, most specific
 *  first. The last one also catches the buy clause of a compound ask, which
 *  is why it is anchored on the verb rather than the start of the string. */
const BUY_RES: readonly RegExp[] = [
  new RegExp(String.raw`\bbuy\s+${USD}\s+(?:worth\s+)?of\s+${SYM}`, 'i'), // Buy $50 of AAPL [on Base] [with a card]
  new RegExp(String.raw`\bbuy\s+${UNITS}\s+${SYM}`, 'i'), // Buy 0.5 ETH on Base
  new RegExp(String.raw`^\s*buy\s+${SYM}`, 'i'), // Buy AAPL
]

export interface TradeTarget {
  symbol: string
  side: TradeSideKey
  /** The chain the sentence names, or null when it names none (the layer
   *  infers it — a stock is always Robinhood Chain). */
  chainId: number | null
  /** The sentence named a chain this rule can't place: treat as unknown. */
  unreadableChain?: true
}

/**
 * What a sentence would swap, and where — or null when it isn't a market
 * buy or sell of the symbol itself.
 */
export function tradeTarget(ask: string): TradeTarget | null {
  if (LIMIT_RE.test(ask)) return null
  const side: TradeSideKey | null = isSellAsk(ask) ? 'sell' : /\bbuy\b/i.test(ask) ? 'buy' : null
  if (!side) return null
  // A perp names its venue, and "long"/"short" never reach the swap layer.
  if (/\bon\s+hyperliquid\b/i.test(ask) || /^\s*(?:\d+x\s+)?(?:long|short)\b/i.test(ask)) return null
  let symbol: string | null = null
  if (side === 'sell') {
    symbol = sellSymbol(ask)
  } else {
    for (const re of BUY_RES) {
      const m = ask.match(re)
      if (m) {
        symbol = normalizeWatchSymbol(m[1])
        break
      }
    }
  }
  if (!symbol) return null
  const chain = chainNamedInAsk(ask)
  if (!chain.named) return { symbol, side, chainId: null }
  return chain.chainId === null ? { symbol, side, chainId: null, unreadableChain: true } : { symbol, side, chainId: chain.chainId }
}

const SELL_RES: readonly RegExp[] = [
  new RegExp(String.raw`^\s*sell\s+all\s+(?:of\s+)?my\s+${SYM}`, 'i'),
  new RegExp(String.raw`^\s*sell\s+${USD}\s+(?:worth\s+)?of\s+(?:my\s+)?${SYM}`, 'i'),
  new RegExp(String.raw`^\s*sell\s+${UNITS}\s+${SYM}`, 'i'),
  new RegExp(String.raw`^\s*sell\s+(?:my\s+)?${SYM}`, 'i'),
]
function sellSymbol(ask: string): string | null {
  for (const re of SELL_RES) {
    const m = ask.match(re)
    if (m) return normalizeWatchSymbol(m[1])
  }
  return null
}

/**
 * Show this chip? Anything that isn't a market buy or sell: yes. A buy or a
 * sell: only unless every venue that could fill it has been measured
 * refusing, recently. Unknown — no reading, a stale one, a chain the rule
 * can't place — is a yes.
 */
export function canTradeAsk(ask: string, tradable: TradabilityMap | null | undefined, now = Date.now()): boolean {
  const t = tradeTarget(ask)
  if (!t || !tradable) return true
  if (t.unreadableChain) return true
  return canFill(tradable[t.symbol], t.side, t.chainId, now)
}

/** The cascade's own words for why a chip is missing, or null when nothing
 *  is known to refuse. What a surface says in place of the button. */
export function tradeRefusal(ask: string, tradable: TradabilityMap | null | undefined, now = Date.now()): string | null {
  const t = tradeTarget(ask)
  if (!t || !tradable || t.unreadableChain) return null
  return fillRefusal(tradable[t.symbol], t.side, t.chainId, now)
}

/** Which sides of a symbol can be filled anywhere right now — what a page
 *  says once, instead of every dropped chip saying it. */
export function fillableSides(t: SymbolTradability | null | undefined, now = Date.now()): TradeSideKey[] {
  return (['buy', 'sell'] as const).filter((side) => canFill(t, side, null, now))
}
