'use client'

// Trade — the overlay chips promoted to a proper order panel. Real (SHELL).
//
// The panel composes ONE sentence an existing parser accepts (buy/sell →
// the swap layer with 4663 inference for stocks; protect → the Spot
// Guardian on Base or the HL Guardian for perps) and SENDS it. Since
// 2026-10-06 the order card IS the order ticket (components/markets/trade/
// OrderTicket, the same form the header's act chips open): side tabs,
// Market / Limit, the size in dollars or units with a slider over what the
// wallet holds, leverage and a stop for a perp, the sentence printed. Its
// button builds on this page through `onBuild` (Ask the chart's ticket under
// the chart); the venue map, the composer and the position panel keep the
// act door (`onAskText`), which runs their asks in the app on arrival
// (lib/arrival-intent). Connect to act, sign in to keep (rule 6). The wallet
// signature is the only gate; the panel itself never touches funds.
//
// The Sell side shows only while the connected wallet holds the symbol
// (lib/sell-gate, 2026-09-16): nothing to sell, no Sell. A perp's Short is
// not a sell of a held token and stays.

import { useMemo, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import RouteTable from '@/components/markets/slots/RouteTable'
import CompoundComposer from '@/components/markets/slots/CompoundComposer'
import PositionPanel from '@/components/markets/slots/PositionPanel'
import OrderTicket from '@/components/markets/trade/OrderTicket'
import { useSession } from '@/lib/session'
import { execAsks, sideOf, type TradeAsk } from '@/lib/trade-asks'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { canFill, noVenueNote } from '@/lib/tradability'
import { useTradable } from '@/lib/use-tradable'
import { fallbackSide, type TicketSide } from '@/lib/order-ticket'

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
  onBuild,
  last,
}: {
  symbol: string
  pair: ChartPair
  onAsk?: (ask: TradeAsk) => void
  /** The act door for a bare ask string (the slots' onAsk). */
  onAskText?: (ask: string) => void
  /** The page's build door: the order ticket's sentence builds on this page. */
  onBuild?: (ask: string) => void
  /** The chart's last close (the header's stats) — EXEC sizes unit rows from it. */
  last?: number | null
}) {
  const askText = onAskText ?? ((a: string) => onAsk?.({ side: sideOf(a), label: a, ask: a }))
  const { walletAddress } = useSession()
  const held = useHeld()
  const tradable = useTradable()
  // The ticket's sides are the header strip's honest set, through the same
  // two gates: nothing to sell → no Sell; a shut venue → no Buy.
  const all = useMemo(() => execAsks(pair, { usd: 50, last: last ?? undefined }), [pair, last])
  const sides = useMemo(() => all.filter((a) => canSellAsk(a.ask, held) && canTradeAsk(a.ask, tradable)).map((a) => a.side as TicketSide), [all, held, tradable])
  // The picked side is kept while it is hidden: the card shows the first
  // side the moment the wallet stops holding the token, and Sell comes back
  // picked if a wallet that holds it returns.
  const [pickedSide, setSide] = useState<TicketSide>(all[0]?.side ?? 'buy')
  const side = fallbackSide(pickedSide, sides)

  const name = symbolName(symbol)
  // Nothing a venue can fill: the order form and the "Chain it" composer
  // would both compose an ask that only refuses — and the composer's first
  // leg would move money onto a chain that can't complete the buy. The panel
  // says so instead (lib/trade-venue-gate); the chart, the position and the
  // rest of the page are untouched.
  const shutSides = useMemo(() => (['buy', 'sell'] as const).filter((sd) => !canFill(tradable[pair.symbol.toUpperCase()], sd)), [tradable, pair.symbol])
  const noOrder = sides.length === 0

  return (
    <div className="mkt-trade mk-trade">
      {/* Every venue a wallet can act on this symbol (EXEC) */}
      <div className="mk-trade__routes">
        <RouteTable symbol={symbol} pair={pair} onAsk={askText} last={last ?? null} />
      </div>
      {noOrder || !side ? (
        <section className="mkt-card mkt-order" aria-label={`Trade ${symbol}`} data-shut={shutSides.join('+') || 'held'}>
          <header className="mkt-card__head">
            <h2 className="mkt-card__title">Trade {name}</h2>
            <span className="mkt-card__eyebrow mono">{shutSides.length > 0 ? 'NO VENUE RIGHT NOW' : 'NOTHING TO SELL'}</span>
          </header>
          <p className="mkt-card__note">{shutSides.length > 0 ? noVenueNote(pair.symbol, [...shutSides]) : `Nothing to sell yet — this panel comes back when the wallet holds ${pair.symbol}.`}</p>
        </section>
      ) : (
        <section className="mkt-card mkt-order" aria-label={`Trade ${symbol}`}>
          <header className="mkt-card__head">
            <h2 className="mkt-card__title">Trade {name}</h2>
            <span className="mkt-card__eyebrow mono">SET THE SIZE · GUARDED BUILD · YOU SIGN</span>
          </header>
          <OrderTicket key={pair.symbol} symbol={symbol} pair={pair} sides={sides} side={side} onSide={setSide} last={last ?? null} onSend={onBuild ?? askText} seat="card" />
        </section>
      )}
      {/* Buy → stake → protect as ONE signed job (EXEC) */}
      {!shutSides.includes('buy') && (
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
