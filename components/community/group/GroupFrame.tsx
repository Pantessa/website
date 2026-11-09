import type { ReactNode } from 'react'
import Footer from '@/components/Footer'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import SpineLink from '@/components/SpineLink'
import './group.css'

// The frame the /g pages share: the markets frame (spine, main, the side
// column with the ask + account strip, foot), the way /leaderboard rides it.
// The side column holds something about ROOMS on these pages, not the
// watchlist: on a phone the frame stacks its rail under (or above) the main
// column, and a room page's first screen belongs to the room.
//
// SURFACE names the spine seat that lights. The COMMUNITY seat is lane
// FEED's (components/AppSpine); until it merges these pages ride the markets
// seat. COORDINATOR, AT MERGE: change the one word below.
export const GROUP_SURFACE = 'markets' as const

export function GroupFrame({ children, side, sideLabel, page }: { children: ReactNode; side: ReactNode; sideLabel: string; page: 'directory' | 'new' }) {
  return (
    <MarketsShell surface={GROUP_SURFACE}>
      <main className="mkt-frame__main grp" data-group-page={page}>
        {children}
      </main>
      <MarketsSide label={sideLabel}>{side}</MarketsSide>
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}

/** What a room is, in four lines. The side column of /g and /g/new. */
export function RoomsAside({ startDoor = true }: { startDoor?: boolean }) {
  return (
    <div className="grp-side" data-rooms-aside>
      <section className="grp-aside">
        <h2 className="grp-card__title">What a room is</h2>
        <ol className="grp-aside__list">
          <li>
            <strong>A feed for one group.</strong> Chart ideas, links, videos, and trades with proof.
          </li>
          <li>
            <strong>One tap to join.</strong> Sign in with a wallet, Google or email. Joining is free and moves no money.
          </li>
          <li>
            <strong>Proof is literal.</strong> A trade post shows a fill the chain confirmed, not a screenshot.
          </li>
          <li>
            <strong>It reaches your chat.</strong> An owner links a Telegram group or a Discord channel, and new posts are announced there.
          </li>
        </ol>
        {startDoor && (
          <SpineLink href="/g/new" className="grp-btn grp-btn--accent grp-aside__door" data-journey="Rooms: start a room">
            Start a room
          </SpineLink>
        )}
      </section>
    </div>
  )
}
