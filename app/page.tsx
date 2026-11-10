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
import { readSnapshotForRender } from '@/lib/read-server'
import { readTourSnapshotForRender } from '@/lib/home-tour-server'
import { HOME_MODE_BOOTSTRAP } from '@/lib/home-mode'
import HlPerpsPrime from '@/components/markets/shell/HlPerpsPrime'
import { HL_PERPS_HANDOFF_GLOBAL, liveHlPerpNames } from '@/lib/charts'

// `/` — THE FRONT DOOR IS THE APP (squad front-door, 2026-10-06, Nate: "the
// landing page falls a bit flat and our new live page feels more alive …
// skip the brochure side and put the user directly on the app right away …
// combine the live feed with the markets page as the splash page").
//
// The splash is the markets index in the app shell (the spine on the left,
// the watchlist rail on the right, the phone frame below lg) with THE READ
// on top of the main column (2026-11-09, components/home/TheRead + lib/read):
// the market as one sentence whose clauses are buttons, a macro line of nine
// tiles and the chart of the pick. The snapshot behind it is read HERE, so
// the headline is in the server HTML. Looking needs no wallet (lib/app-entry
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
  // …and the read's snapshot (lib/read-server readSnapshotForRender: through
  // the data cache so this page stays ISR, fail-soft per feed, capped in
  // time, never a throw — an empty one renders "Reading the markets" and the
  // browser fills it).
  // …and THE TOUR's snapshot (squad landing, 2026-11-10; lib/home-tour-server:
  // counts and fees from the registries, the live part through the data
  // cache — the same ISR rule as the read's).
  const [trending, tradable, read, tour] = await Promise.all([readTrending(), readTradability(), readSnapshotForRender(), readTourSnapshotForRender()])
  // THE VENUE'S LIVE TABLE, HANDED DOWN (2026-11-10). The Macro board lists
  // Hyperliquid builder markets only the venue's live universe knows (SP500,
  // GOLD, SILVER, CL, NATGAS, EUR, JPY, TLT). A server that has read the
  // universe once resolves them and draws their Long / Short chips; a browser's
  // table is cold, so its first render drew none — React threw #418 on `/` and
  // re-rendered the whole page on the client (measured on prod and on a warm
  // local server: eight rows' chips in the HTML, none in the browser). The
  // symbol page already hands the names down (app/t/[symbol]/page.tsx); the
  // home now does the same: an inline script the browser runs at parse time,
  // and HlPerpsPrime for a soft navigation. Synchronous (the process's own
  // table; null on a cold server, where neither side draws the chips), so the
  // page stays static.
  const hlPerps = liveHlPerpNames()
  const hlHandoff = hlPerps ? `window.${HL_PERPS_HANDOFF_GLOBAL}=${JSON.stringify(hlPerps).replace(/</g, '\\u003c')}` : null
  return (
    <>
      {hlHandoff && <script dangerouslySetInnerHTML={{ __html: hlHandoff }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      {/* The home's posture, before first paint (lib/home-mode): a returning
          visitor's page is folded by CSS before a pixel is drawn. */}
      <script dangerouslySetInnerHTML={{ __html: HOME_MODE_BOOTSTRAP }} />
      <HlPerpsPrime hlPerps={hlPerps}>
        <MarketsShell>
          <HomeSurface trending={trending} tradable={tradable} read={read} tour={tour} />
          <div className="mkt-frame__foot">
            <Footer />
          </div>
        </MarketsShell>
      </HlPerpsPrime>
    </>
  )
}
