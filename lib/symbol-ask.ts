// A symbol page's asks run in the app (2026-11-16).
//
// Nate on /t/AAPL, the rail ticket's "Buy $355.65 of AAPL" building in a chat
// runtime docked under the chart: "let's not direct AI chat buys or questions
// to an embed, let's send them to the app page and make sure to add the
// correct MCPs the user will need to run the prompt."
//
// So every sentence the symbol page composes or hears (the order ticket's
// button, the rail's "Or just say it" row, the ⌘K door, a header chip, a
// trade Ask the chart reads) travels to /chat through the arrival handoff
// (lib/arrival-intent: same tab, one shot, fires on arrival). This module is
// the two pure rules that ride with it:
//
//   symbolAskApps  the apps the ask needs ON in the chat's set. The sentence's
//                  own composition (lib/ask-apps askAppSlugs: "on Hyperliquid",
//                  "limit order", "Stake … on Lido") plus the one thing only
//                  the PAGE knows: the venue that trades this symbol. "Buy $25
//                  of AMAT" names no venue and matches no stock word, and the
//                  page knows AMAT is a Robinhood Chain listing; "Buy $25 of
//                  UNI" has no swap word, and the page knows it is a spot swap.
//   symbolAskText  the app has no chart behind it, so a QUESTION that does not
//                  name the symbol carries it ("why is it moving?" on /t/AAPL
//                  → "why is it moving? (AAPL)"). A money-shaped sentence
//                  travels exactly as typed: the parsers read it, and a typed
//                  swap of two other tokens must not gain a third.
//
// Pure: no browser APIs, no server imports. Pinned by scripts/symbol-ask-pins.ts.

import { ARRIVAL_MAX_MCPS } from '@/lib/arrival-fence'
import { NEAR_APP_SLUGS, askAppSlugs } from '@/lib/ask-apps'
import { moneyShaped } from '@/lib/ask-failure-shape'
import type { ChartPair } from '@/lib/charts'

/** Slugs that are companions, never the venue an ask runs on. */
const COMPANION_SLUGS: ReadonlySet<string> = new Set([...NEAR_APP_SLUGS, 'yeetful-tool-wallet'])

/**
 * The app that trades (and reads) this pair, when the sentence names no
 * venue of its own. A stock is a Robinhood Chain listing; a Hyperliquid
 * chart is its perp; a Coinbase-charted coin is a spot swap. An index is
 * here to read: nothing trades it, so it names no app.
 */
export function pairVenueApp(pair: Pick<ChartPair, 'source'> | null | undefined, composed: readonly string[] = []): string | null {
  if (!pair) return null
  if (pair.source === 'robinhood') return 'robinhood-free'
  if (pair.source === 'hyperliquid') return 'hyperliquid-free'
  if (pair.source === 'coinbase') return composed.some((s) => !COMPANION_SLUGS.has(s)) ? null : 'uniswap-free'
  return null
}

/**
 * The apps an ask from this symbol's page arrives with. The page's venue
 * leads; the sentence's own apps follow. The funding companion (NEAR
 * Intents) rides a money-shaped ask only: a question never bridges.
 */
export function symbolAskApps(ask: string, pair: Pick<ChartPair, 'source'> | null | undefined, extra: readonly string[] = []): string[] {
  const composed = askAppSlugs(ask)
  const mine = moneyShaped(ask) ? composed : composed.filter((s) => !NEAR_APP_SLUGS.has(s))
  const venue = pairVenueApp(pair, composed)
  return [...new Set([...(venue ? [venue] : []), ...extra, ...mine])].slice(0, ARRIVAL_MAX_MCPS)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does the text already say which symbol it is about? A short ticker (W, OP)
 *  only counts in capitals: "op" and "w" are words. */
export function namesSymbol(text: string, symbol: string): boolean {
  const sym = symbol.trim()
  if (!sym) return true
  const re = new RegExp(`(^|[^A-Za-z0-9])\\$?${escapeRe(sym)}(?![A-Za-z0-9])`, sym.length <= 2 ? '' : 'i')
  return re.test(text)
}

/** The sentence as it travels to the app (see the header). */
export function symbolAskText(text: string, pair: Pick<ChartPair, 'symbol'> | null | undefined): string {
  const said = text.trim()
  if (!said || !pair || moneyShaped(said) || namesSymbol(said, pair.symbol)) return said
  return `${said} (${pair.symbol})`
}

/** Looking needs no wallet; acting does: only a money-shaped sentence goes
 *  through the connect door before it leaves the page. */
export const symbolAskNeedsWallet = (ask: string): boolean => moneyShaped(ask)
