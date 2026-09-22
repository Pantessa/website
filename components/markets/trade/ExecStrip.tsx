'use client'

// ExecStrip (MK2/EXEC) — the header-level act row: the honest set of sides
// for the pair (Buy · Sell · Long · Short · Stake · Supply · Protect,
// where each is honest — lib/trade-asks execSidesFor). One chip per side;
// each chip's label is a complete ask that SENDS on click (the chip IS the
// contract). Replaces the Overview-era Buy/Sell/DCA/Protect strip (DCA
// dropped 2026-09-16) and KEEPS its wire: the `sym__act` wrapper, the eyebrow
// sentence, the legacy `sym__act-chip sym__act-chip--buy|sell|protect` class names on the
// equivalent sides (long/short wear buy/sell), and the `/chat?prompt=` href
// as the no-JS fallback (a URL never fires a turn — memory chip-send-
// contract), so main's act-strip pins stay green on the merged tree. The
// grammar lives in lib/trade-asks (pure) so the harness pins it without
// rendering. Sell renders only while the connected wallet holds the symbol
// (lib/sell-gate, 2026-09-16): there is nothing to sell otherwise, so the
// server render and a stranger's page carry Buy without Sell.

import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import type { ChartPair } from '@/lib/charts'
import { execAsks, type ExecSide } from '@/lib/trade-asks'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import './trade.css'
import { canTradeAsk, tradeTarget } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import { noVenueNote } from '@/lib/tradability'

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

export default function ExecStrip({
  symbol,
  pair,
  onAsk,
  last,
  usd = 50,
}: {
  symbol: string
  pair: ChartPair
  onAsk: (ask: string) => void
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
  // click sends through the page's act door instead.
  const sendOnClick = (ask: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    onAsk(ask)
  }
  return (
    <div className="sym__act" aria-label={`Act on ${symbol}`} data-acts={asks.length}>
      <span className="sym__act-eyebrow mono">ACT ON {pair.symbol} · SENDS THE ASK · YOUR WALLET SIGNS</span>
      <div className="sym__act-chips">
        {asks.map((a) => (
          <Link
            key={a.side}
            href={promptHref(a.ask)}
            className={`sym__act-chip sym__act-chip--${LEGACY[a.side]}`}
            title={a.ask}
            data-ask={a.ask}
            data-side={a.side}
            data-kind={a.kind}
            data-tone={a.tone}
            onClick={sendOnClick(a.ask)}
          >
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
