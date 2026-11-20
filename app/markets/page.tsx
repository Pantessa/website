import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import MarketsIndex from '@/components/markets/shell/MarketsIndex'
import HlPerpsPrime from '@/components/markets/shell/HlPerpsPrime'
import TheRead from '@/components/home/TheRead'
import AppsRow from '@/components/home/AppsRow'
import CalledShelf from '@/components/home/CalledShelf'
import SuggestionsBoard from '@/components/home/SuggestionsBoard'
import { SITE } from '@/lib/docs'
import { readTradability } from '@/lib/tradability-store'
import { readTrending } from '@/app/markets/trending'
import { readSnapshotForRender } from '@/lib/read-server'
import { readCalledShelf } from '@/app/x/_lib/home-shelf'
import { readSuggestions } from '@/lib/suggestions-server'
import { HL_PERPS_HANDOFF_GLOBAL, liveHlPerpNames } from '@/lib/charts'

// `/markets` — THE SIGNED-IN HOME (2026-11-19, Nate: "create a markets page
// where we no longer show the hero and brochure things when the user is
// signed in and anytime they hit logo and they are signed in it goes to
// that"). `/` stays the stranger's page: the hero mosaic, the tour, the trust
// section and the closing doors, with no watchlist rail. This is the same
// markets index with none of that: THE READ leads (a desk of tokens since
// 2026-11-20, lib/read-desk: the visitor's open watchlist, or the crypto
// desk when there is none), the watchlist rail is on
// the right (the no-rail rule in components/home/mosaic.css keys on the
// claim block, which this page never mounts), then the boards.
//
// The spine's logo and MARKETS seat point here for anyone not signed out
// (components/AppSpine), and a sign-in from the landing lands here
// (lib/app-entry SIGN_IN_LANDING). It is public like `/` (isMarketsPath), so
// a signed-out visitor who opens it looks and is asked for a wallet at the
// action. It used to 308 to `/` (2026-10-06 → 11-19); that redirect went out
// with `max-age=0`, so no browser holds it.

export const metadata: Metadata = {
  title: 'Markets · Pantessa',
  description: 'Crypto, stocks 24/7, perps and macro, live. Your watchlist leads; every chart is the order form and your wallet signs.',
  alternates: { canonical: `${SITE}/markets` },
}

// The same ISR rule as `/`: every read is cached per server and fail-soft.
export const revalidate = 60

export default async function MarketsPage() {
  const [trending, tradable, read, called, suggestions] = await Promise.all([readTrending(), readTradability(), readSnapshotForRender(), readCalledShelf(), readSuggestions()])
  // The venue's live table, handed down (see app/page.tsx: without it React
  // throws #418 on a warm server for the Hyperliquid builder rows).
  const hlPerps = liveHlPerpNames()
  const hlHandoff = hlPerps ? `window.${HL_PERPS_HANDOFF_GLOBAL}=${JSON.stringify(hlPerps).replace(/</g, '\\u003c')}` : null
  return (
    <>
      {hlHandoff && <script dangerouslySetInnerHTML={{ __html: hlHandoff }} />}
      <HlPerpsPrime hlPerps={hlPerps}>
        <MarketsShell>
          <MarketsIndex
            trending={trending}
            tradable={tradable}
            lead={
              <div data-home-lead className="min-w-0">
                <TheRead initial={read} />
              </div>
            }
            guide={<AppsRow />}
            called={called.summaries.length ? <CalledShelf data={called} /> : undefined}
            suggest={<SuggestionsBoard data={suggestions} />}
          />
          <div className="mkt-frame__foot">
            <Footer />
          </div>
        </MarketsShell>
      </HlPerpsPrime>
    </>
  )
}
