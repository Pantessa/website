// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; EXEC builds the real component at
// components/markets/trade/ExecStrip.tsx. At integration QA replaces this
// body with a one-line re-export. Props are the contract; keep them exact.
//
// This stub is NOT a "coming" card: it renders the act chips the header
// already shipped (lib/trade-asks — Buy · Sell · DCA · Protect where honest),
// so the page never regresses before EXEC lands. The harness pins these
// chips by class (`sym__act-chip sym__act-chip--<side>`, a /chat prefill
// href each, Protect never on a stock) — the real ExecStrip keeps those
// class names on its equivalents or re-pins them consciously.

'use client'

import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import type { ChartPair } from '@/lib/charts'
import { tradeAsks } from '@/lib/trade-asks'

export type ExecStripProps = { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

export default function ExecStrip({ symbol, pair, onAsk }: ExecStripProps) {
  const acts = tradeAsks(pair)
  if (acts.length === 0) return null
  const sendOnClick = (ask: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    onAsk(ask)
  }
  return (
    <div className="sym__act" aria-label={`Act on ${symbol}`} data-acts={acts.length} data-slot="ExecStrip" data-stub="EXEC">
      <span className="sym__act-eyebrow mono">ACT ON {symbol} · SENDS THE ASK · YOUR WALLET SIGNS</span>
      <div className="sym__act-chips">
        {acts.map((a) => (
          <Link key={a.label} href={promptHref(a.ask)} className={`sym__act-chip sym__act-chip--${a.side}`} title={a.ask} onClick={sendOnClick(a.ask)}>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
