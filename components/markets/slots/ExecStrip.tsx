// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; EXEC builds the real component at
// components/markets/trade/ExecStrip.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import SlotCard from './SlotCard'

export type ExecStripProps = { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }

export default function ExecStrip(props: ExecStripProps) {
  return <SlotCard slot="ExecStrip" lane="EXEC" title="Act row" body={`Buy · Sell · Long · Short · DCA · Protect · Stake · Supply — where honest for ${props.symbol}.`} />
}
