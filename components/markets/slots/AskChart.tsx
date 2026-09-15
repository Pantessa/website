// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; AI builds the real component at
// components/markets/ai/AskChart.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import type { ChartState } from '@/lib/chart-state'
import SlotCard from './SlotCard'

export type AskChartProps = { symbol: string; pair: ChartPair; chartState?: ChartState; visible?: { from: number; to: number }; onAsk: (ask: string) => void; onChartState?: (s: ChartState) => void }

export default function AskChart(props: AskChartProps) {
  return <SlotCard slot="AskChart" lane="AI" title="Ask the chart" body={`A chart-aware ask box for ${props.symbol}: what's on screen is the context.`} />
}
