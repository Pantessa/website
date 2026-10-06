'use client'

// ExecStrip (MK2/EXEC) — the header-level act row: the honest set of sides
// for the pair (Buy · Sell · Long · Short · Stake · Supply · Protect,
// where each is honest — lib/trade-asks execSidesFor). One chip per side.
// Replaces the Overview-era Buy/Sell/DCA/Protect strip (DCA dropped
// 2026-09-16) and KEEPS its wire: the `sym__act` wrapper, the eyebrow
// sentence, the legacy `sym__act-chip sym__act-chip--buy|sell|protect` class
// names on the equivalent sides (long/short wear buy/sell), and the
// `/chat?prompt=` href as the no-JS fallback (a URL never fires a turn —
// memory chip-send-contract), so main's act-strip pins stay green on the
// merged tree. The grammar lives in lib/trade-asks (pure) so the harness
// pins it without rendering. Sell renders only while the connected wallet
// holds the symbol (lib/sell-gate, 2026-09-16): there is nothing to sell
// otherwise, so the server render and a stranger's page carry Buy without
// Sell.
//
// THE ORDER TICKET (2026-10-06, Nate: "allow users to enter the number they
// want to buy… similar to Coinbase's buy / sell section… the amount can then
// trigger the app to build the transaction"). A chip used to send a hidden
// $50. Now a chip PICKS its side and the ticket opens right under the chips
// (components/markets/trade/OrderTicket): the size in dollars or units, a
// slider over what the wallet holds, Market / Limit, leverage and a stop
// for a perp, the sentence printed, one button that sends it through the
// page's build door (`onBuild`: the chart's own order ticket, under the
// chart; `onAsk` when the page has no dock). Desktop opens the ticket on the
// lead side by itself (remembered per browser); a phone starts on the chips
// so the chart stays high, and a tap opens it. The server renders the chips
// only, so every act-strip pin on the HTML holds.

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import type { ChartPair } from '@/lib/charts'
import { execAsks, type ExecSide } from '@/lib/trade-asks'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import './trade.css'
import { canTradeAsk, tradeTarget } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import { noVenueNote } from '@/lib/tradability'
import OrderTicket from '@/components/markets/trade/OrderTicket'
import { fallbackSide, TICKET_AUTO_OPEN_MIN_PX, TICKET_OPEN_KEY, type TicketSide } from '@/lib/order-ticket'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

/** The legacy class the side wears (long/short = the perp's buy/sell). */
const LEGACY: Record<ExecSide, string> = {
  buy: 'buy',
  long: 'buy',
  sell: 'sell',
  short: 'sell',
  protect: 'protect',
  stake: 'stake',
  supply: 'supply',
}

function rememberOpen(open: boolean) {
  try {
    // The memory decides the desktop only; a phone's tap never flips it.
    if (window.innerWidth < TICKET_AUTO_OPEN_MIN_PX) return
    window.localStorage.setItem(TICKET_OPEN_KEY, open ? '1' : '0')
  } catch {
    /* not remembered */
  }
}

export default function ExecStrip({
  symbol,
  pair,
  onAsk,
  onBuild,
  last,
  usd = 50,
}: {
  symbol: string
  pair: ChartPair
  /** The page's act door: runs the ask in the app (the chip contract). */
  onAsk: (ask: string) => void
  /** The page's BUILD door: the sentence builds on this page (the chart's own
   *  order ticket). The ticket sends here; without it, through onAsk. */
  onBuild?: (ask: string) => void
  /** The chart's last close — sizes the Lido stake chip in ETH units
   *  (optional; without it the Stake chip is omitted, never guessed). */
  last?: number | null
  usd?: number
}) {
  const held = useHeld()
  const tradable = useTradable()
  const all = useMemo(() => execAsks(pair, { usd, last: last ?? undefined }), [pair, usd, last])
  // Two gates, one place: nothing to sell (lib/sell-gate), and nothing that
  // can fill it (lib/trade-venue-gate). The venue one SAYS SO — a symbol
  // whose market is shut keeps its page, and the strip explains the silence
  // instead of rendering nothing (Nate, 2026-09-22).
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
  const sideList = useMemo(() => asks.map((a) => a.side as TicketSide), [asks])

  // ── The ticket: which side it is open on (null = chips only) ──
  const [ticket, setTicket] = useState<TicketSide | null>(null)
  const leadSide = all[0]?.side ?? null
  useEffect(() => {
    let open: boolean | null = null
    try {
      const v = window.localStorage.getItem(TICKET_OPEN_KEY)
      if (v === '0' || v === '1') open = v === '1'
    } catch {
      /* no memory */
    }
    // A phone always starts on the chips (the chart stays high; a tap opens
    // the ticket); the memory only decides the desktop.
    if (window.innerWidth < TICKET_AUTO_OPEN_MIN_PX) open = false
    if (open === null) open = true
    if (open && leadSide) setTicket((t) => t ?? leadSide)
    // Once per mount: the symbol page remounts the strip per symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pick = (side: TicketSide) => {
    setTicket((t) => {
      const next = t === side ? null : side
      rememberOpen(next !== null)
      return next
    })
  }
  const close = () => {
    setTicket(null)
    rememberOpen(false)
  }
  // The side the ticket shows: the picked one while it is still offered,
  // else the first side left (a wallet that stopped holding, a shut venue).
  const shown = ticket ? fallbackSide(ticket, sideList) : null

  if (asks.length === 0 && shut.length > 0) {
    return (
      <div className="sym__act" aria-label={`Act on ${symbol}`} data-acts={0} data-shut={shut.join('+')}>
        <span className="sym__act-eyebrow mono">ACT ON {pair.symbol} · NO VENUE RIGHT NOW</span>
        <p className="sym__act-shut">{noVenueNote(pair.symbol, shut)}</p>
      </div>
    )
  }
  if (asks.length === 0) return null
  // A chip is a real link (the /chat prefill: no-JS, a new tab); a plain
  // click opens the ticket on that side (a second tap on the open side
  // folds it), and the ticket's button sends.
  const pickOnClick = (side: TicketSide) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    pick(side)
  }
  return (
    <div className="sym__act" aria-label={`Act on ${symbol}`} data-acts={asks.length} data-ticket={shown ?? undefined}>
      <span className="sym__act-eyebrow mono">ACT ON {pair.symbol} · SENDS THE ASK · YOUR WALLET SIGNS</span>
      <div className="sym__act-chips">
        {asks.map((a) => (
          <Link
            key={a.side}
            href={promptHref(a.ask)}
            className={`sym__act-chip sym__act-chip--${LEGACY[a.side]}`}
            title={shown === a.side ? 'Fold the order ticket' : `${a.label} — set the size`}
            data-ask={a.ask}
            data-side={a.side}
            data-kind={a.kind}
            data-tone={a.tone}
            aria-pressed={shown === a.side}
            onClick={pickOnClick(a.side)}
          >
            {a.label}
          </Link>
        ))}
      </div>
      {shown && (
        <OrderTicket
          key={pair.symbol}
          symbol={symbol}
          pair={pair}
          sides={sideList}
          side={shown}
          onSide={(s) => {
            setTicket(s)
            rememberOpen(true)
          }}
          last={last ?? null}
          onSend={onBuild ?? onAsk}
          onClose={close}
          seat="strip"
        />
      )}
    </div>
  )
}
