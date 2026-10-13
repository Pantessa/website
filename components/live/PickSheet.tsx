'use client'

// THE FIRST-RUN PICK (GTM squad 2026-10-13, lane ARENA fills this file).
// One tap fills an untouched row: "From your watchlist" · "From your wallet"
// · "Top gainers" · "Biggest" + the add box — a sheet on a phone, a popover
// on a desktop. Mounted (one line each, the coordinator's seats) in the
// battle picker head, the pulse band's row and the tape stage's row; reads
// lib/use-market-pick. Renders nothing until ARENA lands.

import type { MarketPickState } from '@/lib/use-market-pick'

export interface PickSheetProps {
  pick: MarketPickState
  /** Where it sits; the words and the opening rule differ per seat. */
  seat: 'battle' | 'pulse' | 'tape' | 'deck'
}

export default function PickSheet(_props: PickSheetProps) {
  return null
}
