import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/docs'
import { MARKETS_HREF } from '@/lib/markets'
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
import { SPLASH } from '@/lib/markets-copy'

/** /story — THE BROCHURE (squad front-door, 2026-10-06). Until today this was
 * `/`; now `/` is the app's own splash (the markets index with the live pulse
 * on top, app/page.tsx) and this page is the long-form story behind it: the
 * rehearsing chart, every dapp around one symbol, the honest numbers, their
 * meters vs ours, the links economy, the embed. Reached from the splash's
 * "What is this?" door and the footer. Everything below is the landing as it
 * shipped, moved verbatim; the SentHomeNotice moved to the splash (the
 * signed-out gate sends people to `/`).
 *
 * (Original header follows.)
 * / — the links-first landing (2026-07-22 repositioning): intent links are
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

/** The page's own words live in lib/markets-copy's SPLASH block beside the
 *  splash's claim, so the door ("What is this?"), this title and the line
 *  back to the app can never disagree. The hero line itself is HERO_LINE,
 *  which the hero below still carries (MARKETS re-message, 2026-09-11). The
 *  links-first story (2026-07-22) stays on the page as the distribution
 *  channel; the chart is the front door — and the front door is `/`. */
const TITLE = SPLASH.storyTitle
const DESCRIPTION = SPLASH.storyDescription
const CANONICAL = `${SITE}/story`

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
      alternates: { canonical: CANONICAL },
      openGraph: { title: TITLE, description: DESCRIPTION, url: CANONICAL, type: 'website' },
      twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
    }

const JSON_LD = JSON.stringify([
  // The explainer under the spread — the same record the facade renders
  // (lib/explainer-video), so search results and the page can't disagree.
  // (WebSite + SoftwareApplication ride `/`, app/page.tsx.)
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

export default function StoryPage() {
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
        {/* THE WAY BACK (squad front-door, 2026-10-06): this is the story; the
            app is one tap away at `/`. Slim, mono, above the movers tape. */}
        <p className="mono px-4 py-1.5 text-center text-[10.5px] uppercase leading-4 tracking-[0.12em] text-[color:var(--muted)]" data-story-top>
          <span>{SPLASH.storyTopline}.</span>{' '}
          <Link href={MARKETS_HREF} className="whitespace-nowrap text-[color:var(--accent)] underline-offset-4 hover:text-[color:var(--fg)] hover:underline">
            {SPLASH.storyToplineCta} →
          </Link>
        </p>

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
