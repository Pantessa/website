import type { Metadata } from 'next'
import SpineLink from '@/components/SpineLink'
import { GroupFrame, RoomsAside } from '@/components/community/group/GroupFrame'
import NewRoomForm from '@/components/community/group/NewRoomForm'

// /g/new — start a room (squad community, lane GROUP). Public to look at:
// the form is the page, and the wallet is asked for at the send.

const TITLE = 'Start a room on Pantessa'
const DESCRIPTION = 'Name it, say what it is about, pick the markets it follows. Members join in one tap, and you can link your Telegram group or Discord channel.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/g/new' },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website', url: '/g/new' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default function NewRoomPage() {
  return (
    <GroupFrame page="new" sideLabel="About rooms" side={<RoomsAside startDoor={false} />}>
      <header className="grp-pagehead">
        <div>
          <div className="grp-eyebrow">
            <SpineLink href="/g">Rooms</SpineLink> / New
          </div>
          <h1 className="grp-pagehead__title">Start a room</h1>
          <p className="grp-pagehead__sub">It takes a minute. You get a page, a feed, and an invite link to share.</p>
        </div>
      </header>
      <NewRoomForm />
    </GroupFrame>
  )
}
