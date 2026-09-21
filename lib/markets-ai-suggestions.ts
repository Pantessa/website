// MK2/AI — the ask bar's suggestion row, as pure grammar. No React, no CSS:
// the harness imports this and pins every act entry through the ladder
// replica without rendering a thing (the lib/trade-asks idiom).
//
// A suggestion is one of two things, and the row says which:
//   • `question` — a sentence for the AI lane. It goes to `POST
//     /api/markets/ask`, comes back as a drawing, an alert preview or prose,
//     and never leaves the page.
//   • `act` — a complete ask. Same contract as the header strip's chips
//     (memory chip-send-contract: the chip IS the contract): one tap SENDS it
//     through the page's act door, exactly like the `act` reply's chip.
//
// Why `act` is not a question (2026-09-18): it used to go through the ask
// route too, which spent a round trip re-deriving what the grammar already
// knew and then put a SECOND button carrying the same words in front of the
// reader. The first tap looked dead — same words as a Buy button, no door, no
// build, no message — and reaching the door took two clicks.

import { execAsks } from '@/lib/trade-asks'
import type { ChartPair } from '@/lib/charts'

/** What the row's act chip is sized at. */
export const SUGGESTED_ACT_USD = 25

export type AskSuggestion =
  | { kind: 'question'; label: string; q: string }
  | { kind: 'act'; label: string; ask: string }

/** The suggestion row for a pair. The act entry is composed by the SAME
 *  grammar as the header strip (lib/trade-asks `execAsks`) rather than a
 *  template of its own, so it inherits the honest side set: a coin whose home
 *  is not an EVM chain (SOL, XRP, DOGE) is offered the perp it can actually
 *  have, not a spot buy that only ever clarifies. */
export function askChartSuggestions(symbol: string, pair: ChartPair): AskSuggestion[] {
  const out: AskSuggestion[] = [
    { kind: 'question', label: 'Draw support and resistance', q: 'Draw the support and resistance levels' },
    { kind: 'question', label: "What's the trend on screen?", q: `What is the trend in the ${symbol} candles on screen?` },
    { kind: 'question', label: 'Alert me on a 5% move', q: `Tell me when ${symbol} moves 5%` },
  ]
  // The lead buy-side chip: `buy` for spot and stocks, `long` where the perp
  // IS the honest whole. No buy-side chip (nothing honest to offer) → no act
  // suggestion, never a guess.
  const lead = execAsks(pair, { usd: SUGGESTED_ACT_USD }).find((a) => a.tone === 'buy')
  if (lead) out.push({ kind: 'act', label: `${lead.side === 'long' ? 'Long' : 'Buy'} $${SUGGESTED_ACT_USD} of ${pair.symbol}`, ask: lead.ask })
  return out
}
