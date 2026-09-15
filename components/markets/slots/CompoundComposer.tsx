// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; EXEC builds the real component at
// components/markets/trade/CompoundComposer.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair } from '@/lib/charts'
import SlotCard from './SlotCard'

export type CompoundComposerProps = { symbol: string; pair: ChartPair; onAsk: (ask: string) => void }

export default function CompoundComposer(props: CompoundComposerProps) {
  return <SlotCard slot="CompoundComposer" lane="EXEC" title="Compound ask" body={`Buy → stake → protect, compiled into one signed job for ${props.symbol}.`} />
}
