'use client'

// THE TOUR · ASK (lane SIDES-A owns this file, and may add
// components/home/tour/sides/ask.css beside it). CONTRACT STUB: the shared
// panel around a placeholder. The lane replaces the stub with the side's
// live miniature. The words live in lib/home-tour/ask.ts; the hands (act,
// fill, canAct, data, read) come from useTour() in ../context.

import { meta } from '@/lib/home-tour/ask'
import { TourDemoStub, TourPanel } from '../Panel'

export default function AskSide() {
  return (
    <TourPanel side={meta}>
      <TourDemoStub side={meta} />
    </TourPanel>
  )
}
