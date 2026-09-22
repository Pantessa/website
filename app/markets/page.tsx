import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import MarketsIndex from '@/components/markets/shell/MarketsIndex'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import { readTrending } from './trending'
import { readTradability } from '@/lib/tradability-store'

// /markets — the front door to the symbol pages, laid out as a full-screen
// terminal. The frame is a grid: the market data (MarketsIndex's <main>) and
// the site footer stack in the left column; the watchlist rail spans both on
// the right, so it stays docked for the whole page like a terminal's side
// panel. The app spine (the chat's left column) stands beside the frame and
// IS the navigation here — the brochure nav is gone on the markets surface
// (MarketsShell). The body is a client component (live quotes); the shell
// is static.

const TITLE = 'Markets — the chart that executes'
const DESCRIPTION =
  'Stocks 24/7 on Robinhood Chain, crypto spot and Hyperliquid perps on one chart surface. Every chip is a sentence your wallet signs. Unlimited watchlists and alerts, free.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

// The "Trending on Pantessa" strip reads embed_turns (fenced, fail-soft),
// so the page renders per request; everything else on it is static data.
export const dynamic = 'force-dynamic'

export default async function MarketsPage() {
  // Both reads are fail-soft and cached per server: the strip, and which
  // rows can actually be acted on (lib/tradability-store — an empty answer
  // offers everything, exactly as before the cache existed).
  const [trending, tradable] = await Promise.all([readTrending(), readTradability()])
  return (
    <MarketsShell>
      <MarketsIndex trending={trending} tradable={tradable} />
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}
