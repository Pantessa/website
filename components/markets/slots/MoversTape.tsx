// MK2 SLOT STUB — squad README "Slots" contract (2026-09-15).
// MARKETS owns this file; VIZ builds the real component at
// components/markets/viz/MoversTape.tsx. At integration QA replaces this body with a
// one-line re-export. Props are the contract; keep them exact.

import SlotCard from './SlotCard'

export type MoversTapeProps = { onOpen: (symbol: string) => void }

export default function MoversTape(props: MoversTapeProps) {
  void props
  return <SlotCard slot="MoversTape" lane="VIZ" title="Movers" body="The live movers ribbon — biggest 24h moves across the index." />
}
