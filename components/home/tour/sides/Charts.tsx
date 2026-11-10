'use client'

// THE TOUR · CHARTS (lane SIDES-A owns this file, and may add
// components/home/tour/sides/charts.css beside it). CONTRACT STUB: the shared
// panel around a placeholder. The lane replaces the stub with the side's
// live miniature. The words live in lib/home-tour/charts.ts; the hands (act,
// fill, canAct, data, read) come from useTour() in ../context.

import { meta } from '@/lib/home-tour/charts'
import { TourDemoStub, TourPanel } from '../Panel'

export default function ChartsSide() {
  return (
    <TourPanel side={meta}>
      <TourDemoStub side={meta} />
    </TourPanel>
  )
}
