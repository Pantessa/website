'use client'

// MK2/EXEC placeholder — the real PositionPanel lands this round (EXEC.md).
import type { ChartPair } from '@/lib/charts'

export function positionSummary(): string {
  return ''
}

export default function PositionPanel({ symbol }: { symbol: string; pair: ChartPair; address?: string; onAsk: (ask: string) => void }) {
  return (
    <section className="mkt-card" aria-label="PositionPanel">
      <p className="mkt-card__note mono">PositionPanel · {symbol} · coming</p>
    </section>
  )
}
