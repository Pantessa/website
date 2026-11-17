import type { Metadata } from 'next'
import SpineLink from '@/components/SpineLink'
import DirectoryBrowser from '@/components/community/group/DirectoryBrowser'
import { GroupFrame, RoomsAside } from '@/components/community/group/GroupFrame'

// /g — every room (squad community, lane GROUP). Public: looking needs no
// wallet, and a Join from a stranger opens the sign-in door and finishes by
// itself when they land back. Static shell; the list is read in the browser.

const TITLE = 'Rooms on Pantessa'
const DESCRIPTION = 'Rooms for chart ideas, links, videos and trades with proof. Joining takes one tap, and a room can reach its Telegram group or Discord channel.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/g' },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website', url: '/g' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default function RoomsPage() {
  return (
    <GroupFrame page="directory" sideLabel="About rooms" side={<RoomsAside />}>
      <header className="grp-pagehead">
        <div>
          <div className="grp-eyebrow">Rooms</div>
          <h1 className="grp-pagehead__title">Find a room</h1>
          <p className="grp-pagehead__sub">A room is a feed for one group: chart ideas, links, videos, and trades with proof. Join in one tap.</p>
        </div>
        <SpineLink href="/g/new" className="grp-btn grp-btn--accent" data-journey="Rooms: start a room">
          Start a room
        </SpineLink>
      </header>
      <DirectoryBrowser />
    </GroupFrame>
  )
}
