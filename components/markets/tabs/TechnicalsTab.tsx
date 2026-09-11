// STUB — the TECH lane builds the real one at components/markets/technicals/TechnicalsTab.tsx
// (GET /api/charts/technicals: three gauges, oscillator + moving-average
// tables, pivots, verdict chips). QA replaces this file with a one-line
// re-export at integration.

import type { ChartPair } from '@/lib/charts'
import ComingCard from '@/components/markets/shell/ComingCard'

export default function TechnicalsTab({ symbol }: { symbol: string; pair: ChartPair }) {
  return (
    <ComingCard
      lane="TECH"
      title={`${symbol} technicals`}
      body={`Summary, oscillators and moving averages as three gauges, the tables behind them, five pivot systems — and every verdict carries a chip whose ask your wallet can sign.`}
    />
  )
}
