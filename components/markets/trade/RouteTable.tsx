'use client'

// MK2/EXEC placeholder — the real RouteTable lands this round (EXEC.md).
import type { ChartPair } from '@/lib/charts'

export default function RouteTable({ symbol }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }) {
  return (
    <section className="mkt-card" aria-label="RouteTable">
      <p className="mkt-card__note mono">RouteTable · {symbol} · coming</p>
    </section>
  )
}
