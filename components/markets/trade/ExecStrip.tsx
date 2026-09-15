'use client'

// MK2/EXEC placeholder — the real ExecStrip lands this round (EXEC.md).
import type { ChartPair } from '@/lib/charts'

export default function ExecStrip({ symbol }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }) {
  return (
    <section className="mkt-card" aria-label="ExecStrip">
      <p className="mkt-card__note mono">ExecStrip · {symbol} · coming</p>
    </section>
  )
}
