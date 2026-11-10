'use client'

// The splash's body (squad front-door, 2026-10-06; the lead re-thought
// 2026-11-09): the markets index with three seats — the CLAIM at the top of
// the main column (components/home/SplashClaim: HERO_LINE as the visible h1,
// one sentence, the door to /story), THE READ under the tool strip
// (components/home/TheRead, rules in lib/read: the market as one sentence
// whose clauses are buttons, the macro line of nine tiles — the 10-year
// yield and the dollar among them — and the chart of the pick with what can
// be done about it here) and THE APPS ROW under the market boards
// (components/home/AppsRow: the fleet's marks, each a door into the chat's
// apps drawer with that app on).
//
// The live deck (components/home/Deck: Pulse · Tape · The Front · The Siege ·
// The Flyover) held the lead seat from 2026-10-13 until 2026-11-09 — Nate:
// "the flyover and the front just seem a bit too gimmicky", then "rethink
// the home page". Its channels are /live's views; the home opens no stream
// now. The SentHomeNotice rides in the lead seat too: the signed-out gate
// sends a stranger to `/` from /wallet and the dashboard, and this is `/`.
//
// The seats are MarketsIndex's `claim` / `lead` / `guide` props.

import MarketsIndex from '@/components/markets/shell/MarketsIndex'
import SentHomeNotice from '@/components/SentHomeNotice'
import SplashClaim from '@/components/home/SplashClaim'
import TheRead from '@/components/home/TheRead'
import AppsRow from '@/components/home/AppsRow'
import Tour from '@/components/home/tour/Tour'
import HowItWorks from '@/components/home/HowItWorks'
import ClosingDoors from '@/components/home/ClosingDoors'
import HomeModeSync from '@/components/home/HomeModeSync'
import type { TrendingRow } from '@/app/markets/trending'
import type { TradabilityMap } from '@/lib/tradability'
import { EMPTY_READ, type ReadSnapshot } from '@/lib/read'
import { EMPTY_TOUR, type TourSnapshot } from '@/lib/home-tour'

// THE LANDING (squad landing, 2026-11-10): three more seats. THE TOUR under
// the read (components/home/tour — eight sides of the product, a door into
// each), the trust section in the small "how" card's place
// (components/home/HowItWorks) and the closing doors last
// (components/home/ClosingDoors). `tour` is the server's TourSnapshot
// (lib/home-tour-server), a prop so the first paint is the server's.
// HomeModeSync keeps the stranger / returning posture (lib/home-mode).

export default function HomeSurface({ trending = [], tradable, read = EMPTY_READ, tour = EMPTY_TOUR }: { trending?: TrendingRow[]; tradable?: TradabilityMap; read?: ReadSnapshot; tour?: TourSnapshot }) {
  return (
    <>
      <HomeModeSync />
      <MarketsIndex
        trending={trending}
        tradable={tradable}
        claim={<SplashClaim />}
        lead={
          <div data-home-lead className="min-w-0">
            <SentHomeNotice />
            <TheRead initial={read} />
          </div>
        }
        guide={<AppsRow />}
        tour={<Tour data={tour} read={read} />}
        how={<HowItWorks data={tour} />}
        close={<ClosingDoors data={tour} />}
      />
    </>
  )
}
