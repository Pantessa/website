import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
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

const TITLE = 'Yeetful — You have an intent. We do the rest.'
const DESCRIPTION =
  'Mint a link that carries an ask — buy a stock, stake ETH, set a recurring buy. Whoever opens it connects their own wallet; Yeetful scans, funds across chains, builds guarded transactions, and receipts every move. Killer onboarding for any dapp; creators earn on the conversions their links produce.'

export const metadata: Metadata = {
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
    name: 'Yeetful',
    url: SITE,
    description: DESCRIPTION,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Yeetful intent links',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description:
      'Short links that carry a plain-English ask — buy a tokenized stock, stake ETH, set a recurring buy, protect a position. Opening one connects the visitor’s own wallet; Yeetful compiles the ask into guarded on-chain transactions (deterministic builders, fail-closed checks, cross-chain funding included), the visitor signs, and every move is receipted. Creators earn half of Yeetful’s 0.20% conversion fee; the chat doubles as the link builder and embeds on any site.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    provider: { '@type': 'Organization', name: 'Yeetful', url: SITE },
  },
])

export default function HomePage() {
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
