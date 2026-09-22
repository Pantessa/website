// ─────────────────────────────────────────────────────────────────────────
//  Sell needs something to sell (Nate, 2026-09-16: "never show the sell
//  option if they do not own the token as there is nothing to sell").
//
//  Pure + client-safe. Every surface that offers a Sell chip asks canSellAsk
//  with the connected wallet's holdings (lib/use-held: the same read as the
//  YOU HOLD pill) and renders the chip only on a yes. Those surfaces: the
//  symbol header strip, the route table, the Trade panel's side, a drawn
//  level's chips, the Technicals verdict, the AI brief and morning tape, the
//  ⌘K door, community post chips, the watchlist row menu, and the chat's
//  chart overlay.
//
//  The rule reads the SENTENCE a chip sends, so one rule covers every
//  grammar, including a chip row that spans symbols (the morning tape):
//  • a sell is "Sell …" or "limit order: sell …", the token itself leaving
//    the wallet. A perp Short, a take-profit, a stop and a borrow are not,
//    and pass untouched;
//  • the token must be held: a HeldSymbol with a positive amount. A sell that
//    names a chain ("… on Base") needs the token ON that chain;
//  • unknown holdings (no wallet, still reading, a failed read), a sell whose
//    token can't be read and a chain the rule can't name all fail CLOSED:
//    no Sell until the wallet is known to hold it.
// ─────────────────────────────────────────────────────────────────────────

import { ROBINHOOD_CHAIN_ID, SPOT_CHAINS } from '@/lib/symbol-venues'
import { normalizeWatchSymbol, type HeldSymbol } from '@/lib/watchlists'

/** The chain words a sell sentence ends with ("… on Base"), by id. */
const CHAIN_WORDS: ReadonlyMap<string, number> = new Map([
  ...SPOT_CHAINS.flatMap((c) => [[c.word.toLowerCase(), c.id] as const, [c.name.toLowerCase(), c.id] as const]),
  ['mainnet', 1],
  ['arb', 42161],
  ['op', 10],
  ['robinhood chain', ROBINHOOD_CHAIN_ID],
  ['robinhood', ROBINHOOD_CHAIN_ID],
])

const SELL_VERB_RE = /^\s*(?:limit\s+order\s*:\s*)?sell\b/i
const SYM = String.raw`\$?([A-Za-z][A-Za-z0-9]{0,11})\b`
const USD = String.raw`\$\d[\d,]*(?:\.\d+)?`
const UNITS = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)`
/** Where the token sits in each sell shape the app composes, most specific first. */
const TARGET_RES: readonly RegExp[] = [
  new RegExp(String.raw`^\s*limit\s+order\s*:\s*sell\s+${UNITS}\s+${SYM}`, 'i'), // limit order: sell 0.0198 ETH for at least 51.23 USDC on Base
  new RegExp(String.raw`^\s*sell\s+all\s+(?:of\s+)?my\s+${SYM}`, 'i'), // Sell all my AAPL for USDG on Robinhood Chain
  new RegExp(String.raw`^\s*sell\s+${USD}\s+(?:worth\s+)?of\s+(?:my\s+)?${SYM}`, 'i'), // Sell $50 of ETH on Base
  new RegExp(String.raw`^\s*sell\s+${UNITS}\s+${SYM}`, 'i'), // Sell 0.5 ETH
  new RegExp(String.raw`^\s*sell\s+(?:my\s+)?${SYM}`, 'i'), // Sell ETH
]
const TRAILING_CHAIN_RE = /\bon\s+([a-z][a-z ]*?)\s*[.!]?\s*$/i

/**
 * The chain a sentence ends with ("… on Base"), for any grammar — shared
 * with the venue gate (lib/trade-venue-gate), so one table of chain words
 * serves both. `named: false` = the sentence names no chain (the layer
 * infers it); a named chain this table can't read comes back
 * `{ named: true, chainId: null }`, which every caller treats as unknown.
 */
export function chainNamedInAsk(ask: string): { named: boolean; chainId: number | null } {
  const on = ask.match(TRAILING_CHAIN_RE)
  if (!on) return { named: false, chainId: null }
  return { named: true, chainId: CHAIN_WORDS.get(on[1].toLowerCase().replace(/\s+/g, ' ')) ?? null }
}

/** True when the sentence sells the token itself ("Sell …", "limit order: sell …"). */
export function isSellAsk(ask: string): boolean {
  return SELL_VERB_RE.test(ask)
}

/**
 * What a sell sentence sells and where: the token as the holdings read names
 * it (WETH → ETH) and the chain id when the sentence names one (null = any
 * chain the wallet holds it on). Null for a sentence that isn't a sell, or a
 * sell whose token or chain can't be read.
 */
export function sellTarget(ask: string): { symbol: string; chainId: number | null } | null {
  if (!isSellAsk(ask)) return null
  let symbol: string | null = null
  for (const re of TARGET_RES) {
    const m = ask.match(re)
    if (m) {
      symbol = normalizeWatchSymbol(m[1])
      break
    }
  }
  if (!symbol) return null
  const on = ask.match(TRAILING_CHAIN_RE)
  if (!on) return { symbol, chainId: null }
  const chainId = CHAIN_WORDS.get(on[1].toLowerCase().replace(/\s+/g, ' '))
  return chainId === undefined ? null : { symbol, chainId }
}

/**
 * Show this chip? Anything that isn't a sell: yes. A sell: only when the
 * wallet holds the token (on the chain the sentence names, if it names one).
 * `held` null = unknown, which is a no.
 */
export function canSellAsk(ask: string, held: readonly HeldSymbol[] | null | undefined): boolean {
  if (!isSellAsk(ask)) return true
  const target = sellTarget(ask)
  if (!target || !held) return false
  const h = held.find((x) => x.symbol === target.symbol)
  if (!h || !(h.amount > 0)) return false
  return target.chainId === null || h.chainIds.includes(target.chainId)
}
