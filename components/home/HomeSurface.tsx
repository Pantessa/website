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
import type { TrendingRow } from '@/app/markets/trending'
import type { TradabilityMap } from '@/lib/tradability'
import { EMPTY_READ, type ReadSnapshot } from '@/lib/read'

export default function HomeSurface({ trending = [], tradable, read = EMPTY_READ }: { trending?: TrendingRow[]; tradable?: TradabilityMap; read?: ReadSnapshot }) {
  return (
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
    />
  )
}
