// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; VIZ builds the real component at
// components/markets/viz/MarketMap.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import SlotCard from './SlotCard'

export type MarketMapProps = { section?: 'stocks' | 'crypto' | 'perps' | 'all'; onOpen: (symbol: string) => void }

export default function MarketMap(props: MarketMapProps) {
  void props
  return <SlotCard slot="MarketMap" lane="VIZ" title="Market map" body="The whole index as a heat map — size by liquidity, color by move." />
}
