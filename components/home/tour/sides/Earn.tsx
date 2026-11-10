'use client'

// THE TOUR · EARN (lane SIDES-A owns this file, and may add
// components/home/tour/sides/earn.css beside it). CONTRACT STUB: the shared
// panel around a placeholder. The lane replaces the stub with the side's
// live miniature. The words live in lib/home-tour/earn.ts; the hands (act,
// fill, canAct, data, read) come from useTour() in ../context.

import { meta } from '@/lib/home-tour/earn'
import { TourDemoStub, TourPanel } from '../Panel'

export default function EarnSide() {
  return (
    <TourPanel side={meta}>
      <TourDemoStub side={meta} />
    </TourPanel>
  )
}
