import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import HomeHeroFusion from '@/components/HomeHeroFusion'
import StandingIntent from '@/components/StandingIntent'
import ComposeSet from '@/components/ComposeSet'
import EngineInside from '@/components/EngineInside'
import TxPipeline from '@/components/TxPipeline'
import FundAnything from '@/components/FundAnything'
import EmbedAnywhere from '@/components/EmbedAnywhere'
import TrustStrip from '@/components/TrustStrip'
import SwitchboardServers from '@/components/SwitchboardServers'
import SwitchboardProof from '@/components/SwitchboardProof'
import SwitchboardStats from '@/components/SwitchboardStats'
import StayUpToDate from '@/components/StayUpToDate'
import MobileCtaBar from '@/components/MobileCtaBar'
import Footer from '@/components/Footer'

/** / — the landing page tells the pivot story: compose a few MCPs into one
 * agent, Yeetful builds + guardrails + receipts the transactions, and the
 * chat embeds on any site (mega apps). Sharp routing survives demoted — the
 * engine INSIDE your set (EngineInside). Server component so it can export
 * metadata + JSON-LD; interactive pieces are client children. */

const TITLE = 'Yeetful — Every dapp. One chat. Tell it once.'
const DESCRIPTION =
  'Pick a few MCPs — or bring your own — and get one agent that swaps, votes, and keeps working between your turns: recurring buys, stop-loss protections, multi-step jobs. The non-custodial back office for autonomous money — guardrails, your wallet signs, every move receipted. Embed it on any site in five lines.'

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
    name: 'Yeetful embeddable agent chat',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description:
      'An embeddable chat that composes multiple MCP servers into one agent for agentic finance: free first-party MCPs (Uniswap, Snapshot, CoW Protocol, Hyperliquid, Robinhood Chain, OpenSea) plus your own. It quotes and builds on-chain transactions (swaps, DAO votes, NFT listings) with per-step guardrails, runs standing work between turns (recurring buys, stop-loss protections, multi-step fund-then-act jobs), signs with the user’s own wallet via the host page, and receipts every move.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    provider: { '@type': 'Organization', name: 'Yeetful', url: SITE },
  },
])

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main x-main--fluid">
        {/* The claim + the fusion artwork (live /embed summoned on demand) */}
        <HomeHeroFusion />

        {/* The product claim, straight after the hero: standing intent —
            jobs, DCA, Guardian, NFTs — money that moves between your turns */}
        <StandingIntent />

        {/* The power example: "Buy $2 of AAPL" funds itself across chains —
            the onboarding story as one turn */}
        <FundAnything />

        {/* Recipes: what a composed set unlocks */}
        <ComposeSet />

        {/* The demoted engine — sharp routing inside YOUR set (old hero, retold) */}
        <EngineInside />

        {/* The edge: quote → build → guardrails → sign → receipt */}
        <TxPipeline />

        {/* Distribution: the 5-line install + the two fork demos */}
        <EmbedAnywhere />

        {/* Why hosts embed it / why users sign */}
        <TrustStrip />

        {/* The working set: the free first-party fleet + bring your own */}
        <SwitchboardServers />

        {/* Proof: real turns — prompt, answer, on-chain tx */}
        <SwitchboardProof />

        {/* Aggregate analytics — real settled volume */}
        <SwitchboardStats />

        <StayUpToDate />
      </main>

      <Footer />
      <MobileCtaBar />
    </>
  )
}
