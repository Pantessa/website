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
import './trade.css'

export default function QuickAct({ symbol, pair, onAsk, className = '' }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void; className?: string }) {
  const acts = useMemo(() => quickActs(symbol, pair), [symbol, pair])
  if (acts.length === 0) return null
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
