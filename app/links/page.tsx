import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import LinksBoardView from '@/components/LinksBoardView'
import { creatorPages, linksBoard, liveHouseLinks } from '@/lib/links-board'

// /links — the public leaderboard: intent links ranked by FINISHED flows
// (signed turns in embed_turns — most claimed by default, dollars moved as
// the second tab; never mint-time amounts). In-the-open energy, same ethos
// as /activity: the funnel IS the pitch, and every row is a live link a
// visitor can tap. Asks only — never creators' wallets. The body markup
// lives in LinksBoardView, shared with the chat surface's LINKS view.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TITLE = 'Intent links — money, moved by links'
const DESCRIPTION =
  'A link that carries an ask. Whoever opens it connects a wallet and the path builds itself — guarded, signed by their own wallet, receipted. The board below is live: real links, real dollars.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function LinksLeaderboardPage() {
  const board = await linksBoard()
  const onBoard = new Set([...board.byClaims, ...board.byMoved].map((r) => r.slug))
  const [house, pages] = await Promise.all([liveHouseLinks(onBoard), creatorPages()])
  return (
    <>
      <main className="x-main">
        <LinksBoardView board={board} house={house} pages={pages} />
      </main>
      <Footer />
    </>
  )
}
