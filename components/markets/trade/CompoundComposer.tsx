'use client'

// MK2/EXEC placeholder — the real CompoundComposer lands this round (EXEC.md).
import type { ChartPair } from '@/lib/charts'

export default function CompoundComposer({ symbol }: { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }) {
  return (
    <section className="mkt-card" aria-label="CompoundComposer">
      <p className="mkt-card__note mono">CompoundComposer · {symbol} · coming</p>
    </section>
  )
}
