import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import RosterHome from '@/components/RosterHome'
import HomeSurface from '@/components/home/HomeSurface'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import { SITE } from '@/lib/docs'
import { LINK_FEE_PCT } from '@/lib/fees'
import { HOME_DESCRIPTION, HOME_TITLE } from '@/lib/markets-copy'
import { readTradability } from '@/lib/tradability-store'
import { readTrending } from '@/app/markets/trending'

// `/` — THE FRONT DOOR IS THE APP (squad front-door, 2026-10-06, Nate: "the
// landing page falls a bit flat and our new live page feels more alive …
// skip the brochure side and put the user directly on the app right away …
// combine the live feed with the markets page as the splash page").
//
// The splash is the markets index in the app shell (the spine on the left,
// the watchlist rail on the right, the phone frame below lg) with the live
// pulse on top of the main column — the venue's fills aggregated into a
// calm band, every number a button (components/home/PulseSlot) — and the
// guide that teaches links, jobs, the wallet and the AI door as the visitor
// moves (components/guide/GuideSeat). Looking needs no wallet (lib/app-entry
// isPublicAppPath: `/` is a markets path); the wallet is asked for at the
// action (lib/use-connect-to-act). /markets redirects here (next.config);
// the brochure that used to be `/` is /story.
//
// Server component so it can export metadata + JSON-LD; the body is client
// (live quotes, the stream).

const TITLE = HOME_TITLE
const DESCRIPTION = HOME_DESCRIPTION

/** The Roster homepage tripwire (ROSTER-MEMO: flip when a stranger signs
 *  twice OR one real non-house hire lands) — one env change + redeploy.
 *  Exactly 'true' or the splash renders (pinned in test-api). */
const ROSTER_HOME = process.env.NEXT_PUBLIC_ROSTER_HOMEPAGE === 'true'

const ROSTER_TITLE = 'Pantessa — Your wallet gets a staff. You keep the only pen.'
const ROSTER_DESCRIPTION =
  'Hire AI agents into mandate slots — rebalance, DCA, protection, yield. They compete on public signed records and can only propose: every move lands in your inbox as a guarded, signable card. Non-custodial; firing is instant; there is nothing to withdraw.'

export const metadata: Metadata = ROSTER_HOME
  ? {
      title: ROSTER_TITLE,
      description: ROSTER_DESCRIPTION,
      alternates: { canonical: SITE },
      openGraph: { title: ROSTER_TITLE, description: ROSTER_DESCRIPTION, url: SITE, type: 'website' },
      twitter: { card: 'summary_large_image', title: ROSTER_TITLE, description: ROSTER_DESCRIPTION },
    }
  : {
      title: TITLE,
      description: DESCRIPTION,
      alternates: { canonical: SITE },
      openGraph: { title: TITLE, description: DESCRIPTION, url: SITE, type: 'website' },
      twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
    }

const JSON_LD = JSON.stringify([
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Pantessa',
    url: SITE,
    description: DESCRIPTION,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Pantessa Markets',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description:
      `Live charts for tokenized stocks (24/7 on Robinhood Chain), crypto spot and Hyperliquid perps where every chart is the order form: a chip builds a guarded on-chain transaction the visitor's own wallet signs. Unlimited watchlists and alerts, free. Short links that carry a plain-English ask — buy a tokenized stock, stake ETH, set a recurring buy, protect a position. Opening one connects the visitor’s own wallet; Pantessa compiles the ask into guarded on-chain transactions (deterministic builders, fail-closed checks, cross-chain funding included), the visitor signs, and every move is receipted. Creators earn half of Pantessa’s ${LINK_FEE_PCT} link conversion fee; the chat doubles as the link builder and embeds on any site.`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    provider: { '@type': 'Organization', name: 'Pantessa', url: SITE },
  },
])

// ISR, not force-dynamic (QA's prod control, 2026-10-06): today's `/` is served
// from Vercel's edge cache (first byte 0.12–0.63s) while the same index at
// /markets rendered on every request (2.4–2.9s) — a front door must not wait
// two seconds for its first byte. The two server reads here are fail-soft and
// coarse ("Trending on Pantessa" is a 7-day window; the tradability verdicts
// refresh every 10 min), so a 60s edge copy is as fresh as a visitor can tell;
// everything live on the page (quotes, the pulse, the guide) is the browser's.
export const revalidate = 60

export default async function HomePage() {
  // Dark until the tripwire: the Roster front door renders ONLY on the flag.
  if (ROSTER_HOME) return <RosterHome />
  // Both reads are fail-soft and cached per server: the strip, and which
  // rows can actually be acted on (lib/tradability-store — an empty answer
  // offers everything).
  const [trending, tradable] = await Promise.all([readTrending(), readTradability()])
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <MarketsShell>
        <HomeSurface trending={trending} tradable={tradable} />
        <div className="mkt-frame__foot">
          <Footer />
        </div>
      </MarketsShell>
    </>
  )
}
