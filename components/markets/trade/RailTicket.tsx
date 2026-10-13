'use client'

// The right column's order ticket — THE COCKPIT (2026-10-13, Nate: "I like B
// with the buy side on the right… make sure the rest fits properly").
//
// The symbol page's buy side is permanent now: the ticket leads the right
// column on EVERY tab (Overview, Chart, News, Community, Technicals, Trade),
// the watchlist and the About card follow it, and the header is one line
// again. This is the same OrderTicket the header's act chips used to open
// under themselves (components/markets/trade/OrderTicket, the `card` seat:
// its own side tabs — Buy · Sell · Long · Short · Stake · Supply · Protect,
// whatever the pair honestly offers through the two gates, nothing to sell →
// no Sell (lib/sell-gate), a shut venue → no Buy (lib/trade-venue-gate)).
// It never builds, prices or signs: its button hands the printed sentence to
// the page's build door (SymbolPage: Ask the chart's ticket under the chart,
// connect to act, the wallet signature is the gate).
//
// Two things ride under it. A fold (remembered per browser) that collapses
// the form to its header so the watchlist gets the column back; and the ask
// row — "Or just say it" — which hands a sentence to the same conversation
// the chart carries (Ask the chart), so the one column holds everything you
// DO on the page while the floating ask pill steps aside on this surface.
//
// The strip in the header (ExecStrip + its own ticket) is the PHONE's: below
// the rail-docking width this component is hidden by markets.css and the
// chips lead the chart as before; above it the chips hide and this is the
// ticket. Both are in the HTML, so every act-strip pin on the served page
// holds and the phone keeps tap-to-open.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, CornerDownLeft } from 'lucide-react'
import type { ChartPair } from '@/lib/charts'
import OrderTicket from '@/components/markets/trade/OrderTicket'
import { execAsks } from '@/lib/trade-asks'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { useOrderAim } from '@/lib/order-size'
import { canTradeAsk, tradeTarget } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import { noVenueNote } from '@/lib/tradability'
import { fallbackSide, type TicketSide } from '@/lib/order-ticket'

/** The fold, remembered per browser ('0' = folded to its header). */
export const RAIL_TICKET_OPEN_KEY = 'pantessa.markets.railticket.open'

export default function RailTicket({
  symbol,
  pair,
  last,
  side,
  onSide,
  onBuild,
  onSay,
}: {
  symbol: string
  pair: ChartPair
  /** The chart's last close (the header's stats) — sizes units ↔ dollars. */
  last: number | null
  /** The side the page wants shown (the YOU HOLD pill aims Sell); null = the lead side. */
  side: TicketSide | null
  onSide: (side: TicketSide) => void
  /** The page's build door: the sentence builds on this page. */
  onBuild: (ask: string) => void
  /** The ask row: a sentence for Ask the chart (a question or a trade with an if). */
  onSay: (text: string) => void
}) {
  const held = useHeld()
  const tradable = useTradable()
  const all = useMemo(() => execAsks(pair, { usd: 50, last: last ?? undefined }), [pair, last])
  // Two gates, one place (the header strip's exact set): nothing to sell, and
  // nothing a venue can fill. The venue gate SAYS SO instead of going quiet.
  const asks = useMemo(() => all.filter((a) => canSellAsk(a.ask, held) && canTradeAsk(a.ask, tradable)), [all, held, tradable])
  const shut = useMemo(() => {
    const sides = new Set<'buy' | 'sell'>()
    for (const a of all) {
      if (asks.includes(a)) continue
      const t = tradeTarget(a.ask)
      if (t && !canTradeAsk(a.ask, tradable)) sides.add(t.side)
    }
    return [...sides]
  }, [all, asks, tradable])
  const sides = useMemo(() => asks.map((a) => a.side as TicketSide), [asks])
  // The side shown: the page's pick while it is offered, else the lead side
  // (a wallet that stopped holding, a shut venue — never a blank form).
  const shown = side ? fallbackSide(side, sides) : (sides[0] ?? null)

  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_TICKET_OPEN_KEY) === '0') setOpen(false)
    } catch {
      /* stays open */
    }
  }, [])
  // Aimed from the Depth chart (lib/order-size useOrderAim): the rail opens
  // (a folded ticket would take the aim silently) and shows the aim's side;
  // the ticket itself turns into the limit. Only while the side is offered.
  const aim = useOrderAim((s) => s.aim)
  const aimedRef = useRef<number>(0)
  useEffect(() => {
    if (!aim || aim.symbol !== pair.symbol || aimedRef.current === aim.at) return
    if (!sides.includes(aim.side)) return
    aimedRef.current = aim.at
    setOpen(true)
    onSide(aim.side)
  }, [aim, pair.symbol, sides, onSide])
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(RAIL_TICKET_OPEN_KEY, o ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !o
    })

  const [say, setSay] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = say.trim()
    if (!text) return
    onSay(text)
    setSay('')
  }

  return (
    <section className="mkt-railticket" data-slot="order-ticket" data-open={open ? '1' : '0'} data-side={shown ?? undefined} data-acts={asks.length} aria-label={`Act on ${pair.symbol}`}>
      <div className="mkt-railticket__head">
        <span className="mkt-railticket__k mono">ACT ON {pair.symbol}</span>
        <span className="mkt-railticket__sub mono">YOUR WALLET SIGNS</span>
        <button type="button" className="mkt-railticket__fold" aria-expanded={open} aria-label={open ? 'Fold the order ticket' : 'Open the order ticket'} title={open ? 'Fold' : 'Open'} onClick={toggle}>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open &&
        (shown ? (
          <OrderTicket key={pair.symbol} symbol={symbol} pair={pair} sides={sides} side={shown} onSide={onSide} last={last} onSend={onBuild} seat="card" />
        ) : (
          <p className="mkt-railticket__shut" data-shut={shut.join('+') || 'none'}>
            {shut.length > 0 ? noVenueNote(pair.symbol, shut) : `Nothing to act on for ${pair.symbol} yet — the ticket comes back when a venue lists it.`}
          </p>
        ))}
      <form className="mkt-railticket__say" onSubmit={submit} data-say="">
        <input
          className="mkt-railticket__in"
          value={say}
          onChange={(e) => setSay(e.target.value)}
          placeholder={`Or just say it — ask about ${pair.symbol}, or a trade with an if…`}
          aria-label={`Ask about ${pair.symbol} or say a trade`}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="mkt-railticket__go" aria-label="Send to Ask the chart" title="Send" disabled={!say.trim()}>
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      </form>
    </section>
  )
}
