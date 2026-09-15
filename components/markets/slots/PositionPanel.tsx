// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; EXEC builds the real component at
// components/markets/trade/PositionPanel.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import SlotCard from './SlotCard'

export type PositionPanelProps = { symbol: string; pair: ChartPair; address?: string; onAsk: (ask: string) => void }

export default function PositionPanel(props: PositionPanelProps) {
  return <SlotCard slot="PositionPanel" lane="EXEC" title="Your position" body={`What this wallet holds in ${props.symbol} across venues, PnL, exits.`} />
}
