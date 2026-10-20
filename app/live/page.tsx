import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import LiveSurface from '@/components/live/LiveSurface'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import { readTradability } from '@/lib/tradability-store'
import { cardAlt, cardUrlFor, parseLiveShare, shareDescription, shareText } from '@/lib/live-share'
import '@/components/live/live.css'
import '@/components/live/battle.css'
import '@/components/live/flyover.css'

// /live — the live tape (2026-10-06): the venue's fills as they land, USD
// notional per second by taker flow, five tiles, and the sentence that does
// the same thing at the end of every row. The same evening it grew three
// more views on the same stream (`?view=front|siege|map` — the tape as a war
// for ground, lib/battle): one to five armies, percent move as the ground,
// the last sixty seconds of fills as the strength. Public to look at
// (lib/app-entry isPublicAppPath via isMarketsPath); the wallet is asked for
// at the action. The fills come from Dune's real-time feeds through our
// relay (lib/tape-feed over /api/live/stream — HyperCore, Lighter, Lighter
// Robinhood perps and the DEX spot trial; the venue's keyless socket is the
// fallback); mids and candles are the venue's (lib/battle-feed). The Flyover
// (`?view=flyover`, 2026-10-15, lib/flyover) draws every market as terrain
// with three.js, loaded lazily by that view alone. This page only reads which
// rows can be acted on.

const TITLE = 'Live feed — every print is a button'
const DESCRIPTION =
  'Hyperliquid, Lighter and DEX fills as they land through Dune\'s real-time feed: notional per second by taker flow, the largest print, the hot market, the taker split, and the tape. Every row offers the sentence that does the same — your wallet signs it.'

const BASE: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

// A shared pick unfurls as ITS card (GTM squad 2026-10-13, lane CARD): when
// `?t=` names a market, og:image + twitter:image are app/api/og/live drawn for
// that view, those markets and that window, and the title names them. No `t`
// (or garbage) → exactly the page's own metadata, and Next's file convention
// (./opengraph-image, ./twitter-image) supplies the generic card — setting
// `images` here is what tells Next to step aside (resolve-metadata keeps the
// file card only when the page's openGraph/twitter carry no `images` key).
// Pure: no fetch, so a bot's blocking metadata never waits on the venue.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const share = parseLiveShare(await searchParams)
  if (!share) return BASE
  const title = `${shareText(share.view, share.pick, share.since)} · Pantessa Live`
  const description = shareDescription(share.view, share.markets, share.since)
  const image = { url: cardUrlFor(share), width: 1200, height: 630, alt: cardAlt(share.view, share.markets), type: 'image/png' }
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
  }
}

export const dynamic = 'force-dynamic'

export default async function LivePage() {
  const tradable = await readTradability()
  return (
    <MarketsShell>
      <LiveSurface tradable={tradable} />
      <div className="mkt-frame__foot">
        <Footer />
      </div>
    </MarketsShell>
  )
}
