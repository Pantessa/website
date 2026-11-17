// The look-only door (2026-11-09) — what a typed ORDER on an index gets.
//
// "Buy $25 of NDX", "long the VIX on Hyperliquid", "sell my DXY": nothing
// listed here trades an index (lib/charts isLookOnlyPair), so the swap layer
// would only ever answer "I don't know the token NDX" and the perp layer "NDX
// isn't a Hyperliquid perp" — true, and a dead end on a page whose chart the
// visitor is looking at. This door answers first, with no model and no venue
// read: it says the thing is an index, names the closest thing that IS
// listed (lib/macro lookOnlyNear — the same neighbours the home's read and
// the index's own page name), and offers that sentence and the chart.
//
// Pure. The sentence rule is the chip gate's own (lib/trade-venue-gate
// lookOnlyTarget), so the door and every chip surface agree on what counts
// as an order on an index: a sentence that only MENTIONS one ("buy $25 of
// SPY when the VIX is over 20") targets SPY and never reaches here.

import { chartIndexFor, chartPairFor } from '@/lib/charts'
import type { ClarifyRequest } from '@/lib/clarify'
import { lookOnlyNear, lookOnlySpoken } from '@/lib/macro'
import { lookOnlyTarget } from '@/lib/trade-venue-gate'

export interface LookOnlyTurn {
  buildPath: 'native-look-only'
  /** The index the order named (the page symbol). */
  symbol: string
  reply: string
  clarify: ClarifyRequest
}

/** The order's own dollar size when it states one ($5–$10,000), else $25. */
function sizeOf(message: string): number {
  const m = message.match(/\$\s?(\d[\d,]*(?:\.\d+)?)/)
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN
  return Number.isFinite(n) && n >= 5 && n <= 10_000 ? Math.round(n) : 25
}

/** The door for a message that orders a look-only index, or null. */
export function lookOnlyDoor(message: string): LookOnlyTurn | null {
  const text = message.trim()
  if (!text || text.length > 200) return null
  const target = lookOnlyTarget(text)
  const index = target ? chartIndexFor(target) : null
  if (!index) return null
  const sym = index.symbol
  const usd = sizeOf(text)
  const spoken = lookOnlySpoken(sym)
  const near = lookOnlyNear(sym)
  const options: { label: string; resume: string }[] = []
  const named: string[] = []
  for (const n of near) {
    // Only a stock listed here is offered as an order (the static table: SPY,
    // QQQ, SHY…); any other neighbour is a chart to open, never a guess.
    if (chartPairFor(n.symbol)?.source === 'robinhood') {
      if (!options.some((o) => o.label.startsWith('Buy '))) options.push({ label: `Buy $${usd} of ${n.symbol}`, resume: `Buy $${usd} of ${n.symbol}` })
      named.push(`**${n.symbol}**, ${n.as}`)
    } else {
      options.push({ label: `Show me the ${n.symbol} chart`, resume: `Show me the ${n.symbol} chart` })
      named.push(`**${n.symbol}**, ${n.as}`)
    }
  }
  options.push({ label: `Show me the ${sym} chart`, resume: `Show me the ${sym} chart` })
  const closest = named.length === 0 ? `Nothing listed here trades ${spoken}.` : `The closest ${named.length === 1 ? 'thing' : 'things'} listed here: ${named.join(' and ')}.`
  return {
    buildPath: 'native-look-only',
    symbol: sym,
    reply: `🧭 ${sym} is an index — ${spoken} is here to read, and nothing listed here places an order on it. ${closest}`,
    clarify: { question: named.length === 0 ? `${sym}: open the chart` : 'The closest thing listed here', options: options.slice(0, 4) },
  }
}
