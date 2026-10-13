'use client'

// Trade — what is left of the order panel once the ticket lives beside the
// chart. Real (SHELL).
//
// THE COCKPIT (2026-10-13, Nate: "I like B with the buy side on the right"):
// the order ticket is the right column's lead on every tab (components/
// markets/trade/RailTicket), so this tab no longer carries its own copy. It
// keeps the three things the ticket doesn't: every venue a wallet can act on
// (RouteTable — a row re-aims the page's one size, lib/order-size, it never
// opens a second form), buy → stake → protect as ONE signed job
// (CompoundComposer), and what THIS wallet holds in the symbol across venues
// (PositionPanel). Their asks run through the act door (`onAskText`), which
// runs them in the app on arrival (lib/arrival-intent). Connect to act, sign
// in to keep (rule 6). The wallet signature is the only gate; nothing here
// touches funds.
//
// A symbol no venue can fill keeps its page: the composer's first leg would
// move money onto a chain that can't complete the buy, so the composer goes
// and a note says why (lib/trade-venue-gate).

import { useMemo } from 'react'
import type { ChartPair } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import RouteTable from '@/components/markets/slots/RouteTable'
import CompoundComposer from '@/components/markets/slots/CompoundComposer'
import PositionPanel from '@/components/markets/slots/PositionPanel'
import { useSession } from '@/lib/session'
import { sideOf, type TradeAsk } from '@/lib/trade-asks'
import { canFill, noVenueNote } from '@/lib/tradability'
import { useTradable } from '@/lib/use-tradable'

// The grammar (sides a pair can offer, the sentence per side, the default
// chip row) lives in lib/trade-asks — pure, shared with the header strip,
// the ask door and the harness.
export { composeAsk, sideOf, sidesFor, tradeAsks } from '@/lib/trade-asks'
export type { InjectedPrompt, TradeAsk, TradeSide } from '@/lib/trade-asks'

export default function TradeTab({
  symbol,
  pair,
  onAsk,
  onAskText,
  last,
}: {
  symbol: string
  pair: ChartPair
  onAsk?: (ask: TradeAsk) => void
  /** The act door for a bare ask string (the slots' onAsk). */
  onAskText?: (ask: string) => void
  /** Kept for the slot contract: the page's build door. The ticket that used
   *  it sits in the right column now (RailTicket); nothing here builds. */
  onBuild?: (ask: string) => void
  /** The chart's last close (the header's stats) — EXEC sizes unit rows from it. */
  last?: number | null
}) {
  const askText = onAskText ?? ((a: string) => onAsk?.({ side: sideOf(a), label: a, ask: a }))
  const { walletAddress } = useSession()
  const tradable = useTradable()
  const name = symbolName(symbol)
  const shutSides = useMemo(() => (['buy', 'sell'] as const).filter((sd) => !canFill(tradable[pair.symbol.toUpperCase()], sd)), [tradable, pair.symbol])

  return (
    <div className="mkt-trade mk-trade">
      {/* Every venue a wallet can act on this symbol (EXEC) */}
      <div className="mk-trade__routes">
        <RouteTable symbol={symbol} pair={pair} onAsk={askText} last={last ?? null} />
      </div>
      {shutSides.length > 0 ? (
        <section className="mkt-card mkt-order" aria-label={`Trade ${symbol}`} data-shut={shutSides.join('+')}>
          <header className="mkt-card__head">
            <h2 className="mkt-card__title">Trade {name}</h2>
            <span className="mkt-card__eyebrow mono">NO VENUE RIGHT NOW</span>
          </header>
          <p className="mkt-card__note">{noVenueNote(pair.symbol, [...shutSides])}</p>
        </section>
      ) : (
        /* Buy → stake → protect as ONE signed job (EXEC) */
        <div className="mk-trade__compound">
          <CompoundComposer symbol={symbol} pair={pair} onAsk={askText} />
        </div>
      )}
      {/* What THIS wallet holds in the symbol across venues (EXEC) */}
      <div className="mk-trade__position">
        <PositionPanel symbol={symbol} pair={pair} address={walletAddress ?? undefined} onAsk={askText} />
      </div>
    </div>
  )
}
