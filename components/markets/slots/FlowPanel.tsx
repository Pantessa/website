// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; VIZ builds the real component at
// components/markets/viz/FlowPanel.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import SlotCard from './SlotCard'

export type FlowPanelProps = { symbol: string; pair: ChartPair }

export default function FlowPanel(props: FlowPanelProps) {
  return <SlotCard slot="FlowPanel" lane="VIZ" title="Where the money lives" body={`${props.symbol} across dapps: pool liquidity, Aave reserves, HL open interest, holders.`} />
}
