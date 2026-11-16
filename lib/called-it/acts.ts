// The trade a call offers (squad called-gtm, lane TRADE, 2026-11-16). Pure:
// no browser APIs, no server imports. Pinned by scripts/called-gtm-trade-pins.ts.
//
// A follower who landed on a call can act on that market from the call itself.
// Nothing here is a new grammar: every sentence comes from lib/trade-asks
// (`composeExecAsk`, the same composer the symbol page's header strip uses),
// sized at CALL_ACT_USD, and every one passes the gates every chip passes:
//
//   bull → the buy (a spot buy where the pair offers one; a coin that trades
//          here only as a perp offers the long, which is how the app buys it)
//   bear → the sell, only when the connected wallet holds the token
//          (lib/sell-gate canSellAsk, fails closed on unknown holdings),
//          and the short on Hyperliquid when the venue lists a perp
//   every sentence → lib/trade-venue-gate canTradeAsk (a measured refusal,
//          a delisted perp, a look-only index all hide it)
//
// Where nothing can run, the list is empty and the surface renders nothing:
// no dead button, no "no venue" pill. The label IS the sentence.

import type { ChartPair } from '@/lib/charts'
import type { TradabilityMap } from '@/lib/tradability'
import { composeExecAsk, execSidesFor, type ExecSide } from '@/lib/trade-asks'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { canSellAsk } from '@/lib/sell-gate'
import type { HeldSymbol } from '@/lib/watchlists'
import { actSideFor } from './gtm'
import type { CallStance } from './spec'

/** The size a call's chip offers. Above every venue's floor (a perp refuses under $10). */
export const CALL_ACT_USD = 25

/** The words under the chips. Exact (the lane's brief). */
export const CALL_ACT_CAPTION = 'Your wallet signs. Pantessa never holds your funds.'

export interface CallAct {
  side: Extract<ExecSide, 'buy' | 'sell' | 'long' | 'short'>
  /** The sentence that is sent, and the button's label. */
  ask: string
  tone: 'buy' | 'sell'
}

/** The sides a stance would offer on this pair, before any gate. */
export function callActSides(pair: ChartPair | null | undefined, stance: CallStance): CallAct['side'][] {
  if (!pair) return []
  const sides = execSidesFor(pair)
  if (actSideFor(stance) === 'buy') {
    if (sides.includes('buy')) return ['buy']
    if (sides.includes('long')) return ['long']
    return []
  }
  const out: CallAct['side'][] = []
  if (sides.includes('sell')) out.push('sell')
  if (sides.includes('short')) out.push('short')
  return out
}

/**
 * The chips a call offers on this pair, gated. `held` null = holdings unknown
 * (no wallet, still reading): a sell is not offered. `tradable` empty = nothing
 * measured: offered (a cold cache never closes a market).
 */
export function callActsFor(
  pair: ChartPair | null | undefined,
  stance: CallStance,
  gates: { tradable: TradabilityMap | null | undefined; held: readonly HeldSymbol[] | null | undefined; now?: number },
): CallAct[] {
  if (!pair) return []
  const out: CallAct[] = []
  for (const side of callActSides(pair, stance)) {
    const ask = composeExecAsk(pair, side, { usd: CALL_ACT_USD })
    if (!ask) continue
    if (!canTradeAsk(ask, gates.tradable, gates.now)) continue
    if (!canSellAsk(ask, gates.held)) continue
    out.push({ side, ask, tone: side === 'buy' || side === 'long' ? 'buy' : 'sell' })
  }
  return out
}
