import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import { EXPLAINER_VIDEO, explainerEmbedUrl, explainerPosterUrl, explainerWatchUrl, isoDuration } from '@/lib/explainer-video'
import RosterHome from '@/components/RosterHome'
import LinksHero from '@/components/LinksHero'
import LandingMotion from '@/components/LandingMotion'
import IntentMachine from '@/components/IntentMachine'
import LinkEconomy from '@/components/LinkEconomy'
import NightShift from '@/components/NightShift'
import EmbedAnywhere from '@/components/EmbedAnywhere'
import TrustStrip from '@/components/TrustStrip'
import StayUpToDate from '@/components/StayUpToDate'
import MobileCtaBar from '@/components/MobileCtaBar'
import Footer from '@/components/Footer'

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

const TITLE = 'Pantessa — You have an intent. We do the rest.'
const DESCRIPTION =
  'Mint a link that carries an ask — buy a stock, stake ETH, set a recurring buy. Whoever opens it connects their own wallet; Pantessa scans, funds across chains, builds guarded transactions, and receipts every move. Killer onboarding for any dapp; creators earn on the conversions their links produce.'

/** The Roster homepage tripwire (ROSTER-MEMO: flip when a stranger signs
 *  twice OR one real non-house hire lands) — one env change + redeploy.
 *  Exactly 'true' or the current homepage renders from its own untouched
 *  JSX below, byte-identical (pinned in test-api). */
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
    name: 'Pantessa intent links',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description:
      'Short links that carry a plain-English ask — buy a tokenized stock, stake ETH, set a recurring buy, protect a position. Opening one connects the visitor’s own wallet; Pantessa compiles the ask into guarded on-chain transactions (deterministic builders, fail-closed checks, cross-chain funding included), the visitor signs, and every move is receipted. Creators earn half of Pantessa’s 0.20% conversion fee; the chat doubles as the link builder and embeds on any site.',
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
        {/* The claim + the live link economy */}
        <LinksHero />

        {/* The centerpiece: a runnable model of one turn — four real asks,
            four different endings. Carries what FundAnything and TxPipeline
            used to argue separately (funding, and quote → build → guardrails
            → sign → receipt): they were always stages of the same turn. */}
        <IntentMachine />

        {/* Distribution: one link, four surfaces, receipts coming back —
            with the house set tappable */}
        <LinkEconomy />

        {/* The underlying value: standing intent as a clock that keeps
            running — jobs, DCA, Guardian, money moving between your turns */}
        <NightShift />

        {/* Hosts: the 5-line embed + the loop that sharpens their set */}
        <EmbedAnywhere />

        {/* Why hosts embed it / why users sign */}
        <TrustStrip />

        <StayUpToDate />
      </main>

      <Footer />
      <MobileCtaBar />
    </>
  )
}
