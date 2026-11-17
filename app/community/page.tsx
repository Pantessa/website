import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { Plus } from 'lucide-react'
import Footer from '@/components/Footer'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import CommunityFeed from '@/components/community/CommunityFeed'
import CommunityDirectory from '@/components/community/group/CommunityDirectory'
import { FEED_PAGE, communityPath, type FeedPost, type PublicCommunity } from '@/lib/community/spec'
import { listCommunities, listFeed } from '@/lib/community/store'
import { absoluteUrl } from '@/lib/site-url'
import '@/components/community/community.css'

// /community — the public feed (squad community, 2026-11-09, Nate: "like
// reddit, where sharing chart ideas videos, lines is easy to join like a
// telegram channel and easy to share with prove on trades as we have").
//
// Every room's posts on one page: chart ideas (each a stamped call), links,
// videos, and trades with proof, voted and ranked hot / new / top. It rides
// the markets frame: the spine is the navigation (the COMMUNITY seat lit, by
// path), the side column holds the Ask door + the account control over the
// room directory (lane GROUP's), and on a phone the directory becomes a strip
// of rooms above the feed. Reading needs no wallet (lib/app-entry
// isPublicAppPath); a vote asks for an identity at the vote, a post for a
// sign-in at the post, a chip for a wallet at the chip.
//
// A front door is never force-dynamic: the page is static with a one-minute
// revalidate. The first page of the feed and the top rooms are read on the
// server for a stranger (no viewer, so no votes ride the cached HTML); the
// list re-reads quietly in the browser, where the reader's own votes light.

const TITLE = 'Community: chart ideas, videos and trades with proof'
const DESCRIPTION =
  'What traders on Pantessa are posting: chart ideas stamped with the time and the price, videos, and trades the chain confirmed. Vote on what holds up, join a room in one tap, act on any card from your own wallet.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/community') },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl('/community'), siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const runtime = 'nodejs'
export const revalidate = 60

// Each read is its own failure domain: a store that is not answering leaves a
// page whose list reads itself in the browser, never a 500.
const firstPage = unstable_cache(
  async (): Promise<{ posts: FeedPost[]; next: string | null } | null> => {
    try {
      const page = await listFeed({ sort: 'hot', limit: FEED_PAGE })
      return { posts: page.posts, next: page.next }
    } catch {
      return null
    }
  },
  ['community-feed-hot-v1'],
  { revalidate: 60 },
)
const topRooms = unstable_cache(
  async (): Promise<PublicCommunity[]> => {
    try {
      return await listCommunities({ sort: 'members', limit: 8 })
    } catch {
      return []
    }
  },
  ['community-top-rooms-v1'],
  { revalidate: 60 },
)

export default async function CommunityPage() {
  const [initial, rooms] = await Promise.all([firstPage(), topRooms()])
  return (
    <MarketsShell>
      <main className="mkt-frame__main cmy-page" data-community="feed">
        <header className="cmy-page__head">
          <div className="cmy-page__eyebrow">Community</div>
          <h1 className="cmy-page__title">Chart ideas, videos and trades with proof</h1>
          <p className="cmy-page__sub">Post a call, a clip, or a trade the chain confirmed. Vote on what holds up. Any card can be acted on from your own wallet.</p>
        </header>

        {/* Phones: the rooms as one row above the feed (the side column is a desk thing). */}
        <nav className="cmy-strip" id="rooms" aria-label="Rooms">
          {rooms.map((r) => (
            <Link key={r.slug} href={communityPath(r.slug)} className="cmy-strip__chip">
              {r.name} <small>{r.members.toLocaleString('en-US')}</small>
            </Link>
          ))}
          <Link href="/g/new" className="cmy-strip__chip cmy-strip__chip--new" data-door="start-room">
            <Plus aria-hidden /> {rooms.length ? 'Start a room' : 'Start the first room'}
          </Link>
        </nav>

        <CommunityFeed initial={initial} />
      </main>

      <MarketsSide label="Rooms">
        <div className="cmy-rail">
          <div className="cmy-rail__head">
            <span className="cmy-rail__title">Rooms</span>
            <Link href="/g/new" className="cmy-rail__new" data-door="start-room">
              <Plus aria-hidden /> Start a room
            </Link>
          </div>
          <div className="cmy-rail__body">
            <CommunityDirectory variant="rail" limit={12} />
          </div>
          <p className="cmy-rail__note">A room is a feed with members. Joining is one tap and never needs a wallet.</p>
        </div>
      </MarketsSide>

      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}
