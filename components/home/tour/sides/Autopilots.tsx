'use client'

// THE TOUR · AUTOPILOTS (lane SIDES-B owns this file, and may add
// components/home/tour/sides/autopilots.css beside it). CONTRACT STUB: the shared
// panel around a placeholder. The lane replaces the stub with the side's
// live miniature. The words live in lib/home-tour/autopilots.ts; the hands (act,
// fill, canAct, data, read) come from useTour() in ../context.

import { meta } from '@/lib/home-tour/autopilots'
import { TourDemoStub, TourPanel } from '../Panel'

export default function AutopilotsSide() {
  return (
    <TourPanel side={meta}>
      <TourDemoStub side={meta} />
    </TourPanel>
  )
}
