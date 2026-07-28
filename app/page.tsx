import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import LinksHero from '@/components/LinksHero'
import LinkLane from '@/components/LinkLane'
import IntentMachine from '@/components/IntentMachine'
import FundAnything from '@/components/FundAnything'
import NightShift from '@/components/NightShift'
import TxPipeline from '@/components/TxPipeline'
import EmbedAnywhere from '@/components/EmbedAnywhere'
import TrustStrip from '@/components/TrustStrip'
import StayUpToDate from '@/components/StayUpToDate'
import MobileCtaBar from '@/components/MobileCtaBar'
import Footer from '@/components/Footer'

/** / — the links-first landing (2026-07-22 repositioning): intent links are
 * the product, chat is the link builder. One claim up top — "You have an
 * intent. We do the rest." — then the link economy's live numbers, what a
 * link can carry, the onboarding story, the standing/Guardian value, the
 * trust pipeline, and the host-side embed door. One message per section.
 * Server component so it can export metadata + JSON-LD. */

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
      <main className="x-main x-main--fluid">
        {/* The claim + the live link economy */}
        <LinksHero />

        {/* The centerpiece: a runnable model of one turn — four real asks,
            four different endings */}
        <IntentMachine />

        {/* What a link can carry — the six house links, tappable */}
        <LinkLane />

        {/* The onboarding story: "Buy $2 of AAPL" funds itself across chains */}
        <FundAnything />

        {/* The underlying value: standing intent as a clock that keeps
            running — jobs, DCA, Guardian, money moving between your turns */}
        <NightShift />

        {/* The edge: quote → build → guardrails → sign → receipt */}
        <TxPipeline />

        {/* Hosts: the 5-line embed + host buttons */}
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
