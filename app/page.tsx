import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import { EXPLAINER_VIDEO, explainerEmbedUrl, explainerPosterUrl, explainerWatchUrl, isoDuration } from '@/lib/explainer-video'
import RosterHome from '@/components/RosterHome'
import LinksHero from '@/components/LinksHero'
import MarketsBand from '@/components/MarketsBand'
import LandingMotion from '@/components/LandingMotion'
import MoversStrip from '@/components/landing/MoversStrip'
import VenueBand from '@/components/landing/VenueBand'
import MarketMapTeaser from '@/components/landing/MarketMapTeaser'
import HonestyStrip from '@/components/landing/HonestyStrip'
import ShareBand from '@/components/landing/ShareBand'
import LinkEconomy from '@/components/LinkEconomy'
import EmbedAnywhere from '@/components/EmbedAnywhere'
import TrustStrip from '@/components/TrustStrip'
import StayUpToDate from '@/components/StayUpToDate'
import MobileCtaBar from '@/components/MobileCtaBar'
import Footer from '@/components/Footer'
import { LINK_FEE_PCT } from '@/lib/fees'
import { HOME_DESCRIPTION, HOME_TITLE } from '@/lib/markets-copy'

/** / — the links-first landing (2026-07-22 repositioning): intent links are
 * the product, chat is the link builder. One claim up top — "You have an
 * intent. We do the rest." — then the link economy's live numbers, what a
 * link can carry, and what happens when someone opens one.
 *
 * 2026-07-28 overhaul: the middle of the page used to be five slabs of
 * copy-beside-a-still (FundAnything, TxPipeline, StandingIntent, LinkLane).
 * Those stills argued for a machine nobody could see. Now the machine runs
 * (IntentMachine — it absorbed the funding story AND the quote→build→guard→
 * sign→receipt pipeline, because both are just stages of one turn), standing
 * intent is a clock that keeps running (NightShift), and links are drawn as
 * the distribution channel they are (LinkEconomy). One message per section
 * still holds; there are simply fewer, louder sections.
 *
 * Server component so it can export metadata + JSON-LD; the moving parts are
 * client children. */

/** MARKETS re-message (2026-09-11): the hero line + <title> live in
 *  lib/markets-copy so the hero, the root social card, and the harness pin
 *  can never disagree. The links-first story (2026-07-22) stays on the page
 *  as the distribution channel; the chart is now the front door. */
const TITLE = HOME_TITLE
const DESCRIPTION = HOME_DESCRIPTION

/** The Roster homepage tripwire (ROSTER-MEMO: flip when a stranger signs
 *  twice OR one real non-house hire lands) — one env change + redeploy.
 *  Exactly 'true' or the current homepage renders from its own untouched
 *  JSX below, byte-identical (pinned in test-api). */
const ROSTER_HOME = process.env.NEXT_PUBLIC_ROSTER_HOMEPAGE === 'true'

/** The honesty strip + the links stats read the ledger at render: on a
 *  static route they'd bake at build. ISR every 5 minutes keeps the public
 *  numbers within five minutes of the ledger (QA-4, mk2 2026-09-15). */
export const revalidate = 300

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
  // The explainer under the spread — the same record the facade renders
  // (lib/explainer-video), so search results and the page can't disagree.
  {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: EXPLAINER_VIDEO.title,
    description: EXPLAINER_VIDEO.description,
    thumbnailUrl: [explainerPosterUrl],
    uploadDate: EXPLAINER_VIDEO.uploadDate,
    duration: isoDuration(EXPLAINER_VIDEO.seconds),
    embedUrl: explainerEmbedUrl,
    contentUrl: explainerWatchUrl,
    publisher: { '@type': 'Organization', name: 'Pantessa', url: SITE },
  },
])

export default function HomePage() {
  // Dark until the tripwire: the Roster front door renders ONLY on the flag;
  // the flag-off return below is the shipped homepage, untouched.
  if (ROSTER_HOME) return <RosterHome />
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      {/* One scroll listener + one observer for the whole page: stations,
          decorative parallax, and the one-time section reveals */}
      <LandingMotion />
      <main className="x-main x-main--fluid">
        {/* mk2 LANDING (2026-09-15) — the chart-first front door, in order:
            the movers tape · the executing chart (hero) · every dapp, one
            chart · the whole index · receipt-grade numbers · their meters
            vs ours · then the distribution story (links + embed) trimmed. */}
        <MoversStrip />

        {/* The claim, and the chart that performs it */}
        <LinksHero />

        {/* The section a charting subscription cannot ship */}
        <VenueBand />

        {/* The whole index as a map, click → the symbol page */}
        <MarketMapTeaser />

        {/* Every number here is a signed on-chain fact, fenced */}
        <HonestyStrip />

        {/* Their meters vs ours + the six lines they cannot sell */}
        <MarketsBand />

        {/* BELOW THE FOLD — distribution: share a trade (links), embed the
            chart (hosts). Trimmed, not deleted: the explainer band rides in
            the spread. */}
        <ShareBand />
        <LinkEconomy />
        <EmbedAnywhere />

        <TrustStrip />

        <StayUpToDate />
      </main>

      <Footer />
      <MobileCtaBar />
    </>
  )
}
