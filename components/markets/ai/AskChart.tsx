'use client'

// MK2/AI — the chart-aware ask box (README "Slots": AskChart). Placeholder
// for the first push; the real box lands in this file this round.

import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'

export type AskChartProps = {
  symbol: string
  pair: ChartPair
  chartState?: ChartState
  visible?: { from: number; to: number }
  onAsk: (ask: string) => void
  onChartState?: (s: ChartState) => void
}

export default function AskChart({ symbol }: AskChartProps) {
  return (
    <section className="mk-ai mk-ai--ask" data-slot="AskChart" data-lane="AI">
      <header className="mk-ai__head">
        <span className="mk-ai__title">Ask the chart</span>
        <span className="mk-ai__eyebrow mono">AI · WIRING</span>
      </header>
      <p className="mk-ai__body">Ask about what is on the {symbol} chart.</p>
    </section>
  )
}
