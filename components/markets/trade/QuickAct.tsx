'use client'

// QuickAct (MK2/EXEC) — the compact chip row for an index row on /markets:
// two or three honest chips from the venue map (lib/symbol-venues quickActs)
// so a row can act without opening the symbol page. Each chip is a complete
// ask that SENDS through onAsk on click (the chip IS the contract; the page's
// connect-to-act door opens for a stranger). Meant for a hover/focus reveal
// inside a row; it renders nothing for a chartless symbol.

import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import type { ChartPair } from '@/lib/charts'
import { quickActs } from '@/lib/symbol-venues'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import './trade.css'

export default function QuickAct({ symbol, pair, onAsk, className = '' }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void; className?: string }) {
  const tradable = useTradable()
  // A chip for a symbol no venue can fill is a dead button
  // (lib/trade-venue-gate). The row KEEPS its chart, its quote and its link —
  // only the buttons go, and the seat says so rather than sitting blank.
  const all = useMemo(() => quickActs(symbol, pair), [symbol, pair])
  const acts = useMemo(() => all.filter((a) => canTradeAsk(a.ask, tradable)), [all, tradable])
  if (acts.length === 0) {
    if (all.length === 0) return null
    return (
      <span className={`mkt-quick ${className}`} data-acts={0} data-shut="1">
        <span className="mkt-quick__none mono" title={`No venue can fill ${pair.symbol} right now — the chart stays, the order doesn't.`}>
          NO VENUE
        </span>
      </span>
    )
  }
  const fire = (ask: string) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation() // the row itself is a link to /t/<sym>
    onAsk(ask)
  }
  return (
    <span className={`mkt-quick ${className}`} role="group" aria-label={`Act on ${pair.symbol}`} data-acts={acts.length}>
      {acts.map((a) => (
        <button key={a.ask} type="button" className={`mkt-quick__chip mkt-quick__chip--${a.tone}`} title={a.ask} data-ask={a.ask} onClick={fire(a.ask)}>
          {a.label}
        </button>
      ))}
    </span>
  )
}
