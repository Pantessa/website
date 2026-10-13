'use client'

// The splash's body (squad front-door, 2026-10-06): the markets index with
// three seats — the CLAIM at the top of the main column (SPLASH lane,
// components/home/SplashClaim: HERO_LINE as the visible h1, one sentence,
// the door to /story), THE DECK above the session strip (2026-10-13,
// components/home/Deck: the live pulse as the first of four channels — Pulse ·
// Tape · The Front · The Siege — with the streaming-order-book switch; the
// band itself is components/home/PulseSlot in its stage seat) and the GUIDE
// under the movers tape (GUIDE lane, components/guide/GuideSeat). The
// SentHomeNotice rides in the lead seat too: the signed-out gate sends a
// stranger to `/`, and this is `/` now.
//
// SPLASH lane owns this file. The seats are MarketsIndex's `claim` / `lead` /
// `guide` props; a lane never edits MarketsIndex to place its component.

import MarketsIndex from '@/components/markets/shell/MarketsIndex'
import SentHomeNotice from '@/components/SentHomeNotice'
import SplashClaim from '@/components/home/SplashClaim'
import Deck from '@/components/home/Deck'
import GuideSeat from '@/components/guide/GuideSeat'
import type { TrendingRow } from '@/app/markets/trending'
import type { TradabilityMap } from '@/lib/tradability'

export default function HomeSurface({ trending = [], tradable }: { trending?: TrendingRow[]; tradable?: TradabilityMap }) {
  return (
    <MarketsIndex
      trending={trending}
      tradable={tradable}
      claim={<SplashClaim />}
      lead={
        <div data-home-lead className="min-w-0">
          <SentHomeNotice />
          <Deck />
        </div>
      }
      guide={<GuideSeat surface="home" />}
    />
  )
}
