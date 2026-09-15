// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; AI builds the real component at
// components/markets/ai/AiBrief.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import type { ChartPair, ChartTf } from '@/lib/charts'
import SlotCard from './SlotCard'

export type AiBriefProps = { symbol: string; pair: ChartPair; tf?: ChartTf; onAsk: (ask: string) => void }

export default function AiBrief(props: AiBriefProps) {
  return <SlotCard slot="AiBrief" lane="AI" title="Brief" body={`The ${props.symbol} brief, streamed, with chips that execute.`} />
}
