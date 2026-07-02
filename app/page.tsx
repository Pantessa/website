import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import Reveal from '@/components/Reveal'
import SwitchboardHero from '@/components/SwitchboardHero'
import SwitchboardServers from '@/components/SwitchboardServers'
import SwitchboardTry from '@/components/SwitchboardTry'
import SwitchboardProof from '@/components/SwitchboardProof'
import SwitchboardStats from '@/components/SwitchboardStats'
import StayUpToDate from '@/components/StayUpToDate'
import MobileCtaBar from '@/components/MobileCtaBar'
import Footer from '@/components/Footer'

/** / — the landing page IS Switchboard, the routing engine. Server component so
 * it can export metadata + JSON-LD (the interactive pieces are client children).
 * The full agent directory lives at /servers. */

const TITLE = 'Yeetful — Agentic payments & routing layer'
const DESCRIPTION =
  'One key for every model and data source. Router sends each request — inference or live data — to the best-priced MCP; your agent pays per call in USDC.'

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
    '@type': 'Service',
    name: 'Router',
    serviceType: 'MCP routing engine',
    description:
      'Smart routing and payments for agents: one key for every model and data source. Router weighs every MCP that can answer, picks the best-priced route under your budget cap, and the agent pays per call in USDC on Base over x402.',
    provider: { '@type': 'Organization', name: 'Yeetful', url: SITE },
    areaServed: 'Worldwide',
  },
])

const STEPS = [
  {
    n: '01',
    t: 'Ask in plain English',
    d: 'Send a request the way you’d say it out loud. No endpoint names, no params, no docs to read first.',
  },
  {
    n: '02',
    t: 'Router weighs the routes',
    d: 'It scores every MCP that can answer — on price, proven settlement history, and your budget cap — and picks the best one.',
  },
  {
    n: '03',
    t: 'The agent pays the call',
    d: 'The winning route settles over x402 in USDC from your agent’s own wallet. Over-cap routes get dropped, not paid. You get a receipt with the tx.',
  },
]

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main x-main--fluid">
        <SwitchboardHero />

        {/* Breadth: every model + data source, one key */}
        <SwitchboardServers />

        {/* Interactive: pick a need, watch the engine rank + pick a route */}
        <SwitchboardTry />

        {/* Proof: real routed turns — prompt, answer, on-chain tx */}
        <SwitchboardProof />

        {/* Aggregate analytics — we track every paying + earning agent */}
        <SwitchboardStats />

        {/* How routing works — rises in with the blog-index motion language:
            head first, then the steps stagger; the route rail carries one
            accent packet under the head. */}
        <section className="explain">
          <Reveal>
            <div className="explain__head">
              <span className="explain__eyebrow mono">HOW THE OPERATOR WORKS</span>
              <h2 className="explain__h2">You bring the question. Router brings the route.</h2>
            </div>
            <div className="swrail" aria-hidden="true" />
          </Reveal>
          <div className="explain__steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={120 + i * 110} className="step">
                <span className="step__n mono">{s.n}</span>
                <h3 className="step__t">{s.t}</h3>
                <p className="step__d">{s.d}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <StayUpToDate />
      </main>

      <Footer />
      <MobileCtaBar />
    </>
  )
}
