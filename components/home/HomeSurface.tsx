'use client'

// The splash's body (squad front-door, 2026-10-06): the markets index with
// two seats the lanes fill — the LIVE PULSE above the session strip (PULSE
// lane, components/home/PulseSlot) and the GUIDE under the movers tape
// (GUIDE lane, components/guide/GuideSeat). The SentHomeNotice rides here
// too: the signed-out gate sends a stranger to `/`, and this is `/` now.
//
// SPLASH lane owns this file. The seats are MarketsIndex's `lead` / `guide`
// props; a lane never edits MarketsIndex to place its component.

import MarketsIndex from '@/components/markets/shell/MarketsIndex'
import SentHomeNotice from '@/components/SentHomeNotice'
import PulseSlot from '@/components/home/PulseSlot'
import GuideSeat from '@/components/guide/GuideSeat'
import type { TrendingRow } from '@/app/markets/trending'
import type { TradabilityMap } from '@/lib/tradability'

export default function HomeSurface({ trending = [], tradable }: { trending?: TrendingRow[]; tradable?: TradabilityMap }) {
  return (
    <MarketsIndex
      trending={trending}
      tradable={tradable}
      lead={
        <div data-home-lead className="min-w-0">
          <SentHomeNotice />
          <PulseSlot />
        </div>
      }
      guide={<GuideSeat surface="home" />}
    />
  )
}
