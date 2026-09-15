// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; EXEC builds the real component at
// components/markets/trade/RouteTable.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import SlotCard from './SlotCard'

export type RouteTableProps = { symbol: string; pair: ChartPair; onAsk: (ask: string) => void; /** The chart's last close (EXEC sizes the limit + stake rows from it). */ last?: number | null }

export default function RouteTable(props: RouteTableProps) {
  return <SlotCard slot="RouteTable" lane="EXEC" title="Every venue" body={`Every way a wallet can act on ${props.symbol}: spot, perp, lend, stake, DCA, protect — live quotes, one chip per row.`} />
}
