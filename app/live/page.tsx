import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import LiveFeed from '@/components/live/LiveFeed'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import { readTradability } from '@/lib/tradability-store'
import '@/components/live/live.css'

// /live — the live tape (2026-10-06): the venue's fills as they land, USD
// notional per second by taker flow, five tiles, and the sentence that does
// the same thing at the end of every row. Public to look at (lib/app-entry
// isPublicAppPath via isMarketsPath); the wallet is asked for at the action.
// The stream is opened by the browser (lib/tape-feed); this page only reads
// which rows can be acted on, like /markets does.

const TITLE = 'Live feed — every print is a button'
const DESCRIPTION =
  'Hyperliquid fills as they land: notional per second by taker flow, the largest print, the hot market, the taker split, and the tape. Every row offers the sentence that does the same — your wallet signs it.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export const dynamic = 'force-dynamic'

export default async function LivePage() {
  const tradable = await readTradability()
  return (
    <MarketsShell>
      <LiveFeed tradable={tradable} />
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}
