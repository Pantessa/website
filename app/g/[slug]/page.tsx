import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Footer from '@/components/Footer'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import { GROUP_SURFACE } from '@/components/community/group/GroupFrame'
import { RoomMain, RoomProvider, RoomSide } from '@/components/community/group/Room'
import { cleanVia, roomMeta, telegramDoor } from '@/components/community/group/room-logic'
import { communityPath } from '@/lib/community/spec'
import { inviterLabel } from '@/lib/community/store'
import { readRoom } from './room-read'

// /g/<slug> — a ROOM (squad community, lane GROUP). Public, in the markets
// frame with the spine. The page is an invitation first: opened with
// ?via=<code> it says so, the Join is one tap for a proven identity, and a
// stranger's join is held through the sign-in and finishes by itself.
//
// The frame's side column carries the room's own boards here (who brought
// people, who traded with proof, the linked chats): docked on a desk, under
// the feed on a phone.

export const runtime = 'nodejs'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { room, known, internal } = await readRoom(slug)
  if (known && !room) return { title: 'Room not available · Pantessa', robots: { index: false, follow: false } }
  const meta = roomMeta(room, slug, internal)
  const url = communityPath(slug)
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    robots: meta.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title: meta.title, description: meta.description, url, siteName: 'Pantessa', type: 'website' },
    twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
  }
}

export default async function RoomPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const { room, known } = await readRoom(slug)
  if (known && !room) notFound()
  // The bot that joins people from Telegram, when the Telegram lane's env
  // names one. Absent (today): the chooser offers the sign-in door alone.
  const telegram = telegramDoor(process.env.TELEGRAM_BOT_NAME, process.env.TELEGRAM_APP_NAME)
  // Who the invite belongs to, when the code is a real invite of this room.
  const via = cleanVia(query.via)
  const invitedBy = via && room ? await inviterLabel(slug, via).catch(() => null) : null

  return (
    <MarketsShell surface={GROUP_SURFACE}>
      <RoomProvider slug={slug} initial={room} via={via} invitedBy={invitedBy} telegram={telegram}>
        <main className="mkt-frame__main grp" data-group-page="room">
          <RoomMain />
        </main>
        <MarketsSide label="Members and linked chats">
          <RoomSide />
        </MarketsSide>
        <div className="mkt-frame__foot">
          <Footer />
        </div>
      </RoomProvider>
    </MarketsShell>
  )
}
