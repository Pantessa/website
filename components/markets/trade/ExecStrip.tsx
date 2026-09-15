'use client'

// ExecStrip (MK2/EXEC) — the header-level act row: the honest set of sides
// for the pair (Buy · Sell · Long · Short · Stake · Supply · DCA · Protect,
// where each is honest — lib/trade-asks execSidesFor). One chip per side;
// each chip's label is a complete ask that SENDS on click (the chip IS the
// contract). Replaces the Overview-era Buy/Sell/DCA/Protect strip; the
// grammar lives in lib/trade-asks (pure) so the harness pins it without
// rendering.

import { useMemo } from 'react'
import type { ChartPair } from '@/lib/charts'
import { execAsks } from '@/lib/trade-asks'
import './trade.css'

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
  const asks = useMemo(() => execAsks(pair, { usd, last: last ?? undefined }), [pair, usd, last])
  if (asks.length === 0) return null
  return (
    <div className="mkt-exec" aria-label={`Act on ${symbol}`} data-acts={asks.length}>
      <span className="mkt-exec__eyebrow mono">ACT ON {pair.symbol} · ACROSS EVERY DAPP · YOUR WALLET SIGNS</span>
      <div className="mkt-exec__chips">
        {asks.map((a) => (
          <button
            key={a.side}
            type="button"
            className={`mkt-exec__chip mkt-exec__chip--${a.tone} mkt-exec__chip--${a.kind}`}
            title={a.ask}
            data-ask={a.ask}
            data-side={a.side}
            onClick={() => onAsk(a.ask)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
