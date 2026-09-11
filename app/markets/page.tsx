import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import MarketsIndex from '@/components/markets/shell/MarketsIndex'

// /markets — the front door to the symbol pages, laid out as a full-screen
// terminal. The frame is a grid: the market data (MarketsIndex's <main>) and
// the site footer stack in the left column; the watchlist rail spans both on
// the right, so it stays docked for the whole page like a terminal's side
// panel. The body is a client component (live quotes); the shell is static.

const TITLE = 'Markets — the chart that executes'
const DESCRIPTION =
  'Stocks 24/7 on Robinhood Chain, crypto spot and Hyperliquid perps on one chart surface. Every chip is a sentence your wallet signs. Unlimited watchlists and alerts, free.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default function MarketsPage() {
  return (
    <div className="mkt-frame">
      <MarketsIndex />
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </div>
  )
}
