import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import SwitchboardHero from '@/components/SwitchboardHero'
import SwitchboardTry from '@/components/SwitchboardTry'
import SwitchboardLive from '@/components/SwitchboardLive'
import Footer from '@/components/Footer'

/** /switchboard — the routing engine's own page. Server component so it can
 * export metadata + JSON-LD (the interactive hero/try/live pieces are their own
 * client components). The hero animates the brain: a plain-English request
 * arrives, the operator weighs candidate MCP routes, patches the cheapest under
 * cap, and settles per call. Below: a live route preview + real settlements +
 * the Ask → Weigh → Patch explainer. */

const TITLE = 'Switchboard — route MCP calls by plain-English ask'
const DESCRIPTION =
  'Switchboard is Yeetful’s MCP routing engine: ask in plain English, it weighs every route, picks the cheapest proven one under your cap, and pays per call in USDC.'
const URL = `${SITE}/switchboard`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: URL, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const JSON_LD = JSON.stringify([
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: TITLE,
    description: DESCRIPTION,
    url: URL,
    isPartOf: { '@type': 'WebSite', name: 'Yeetful', url: SITE },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Switchboard',
    serviceType: 'MCP routing engine',
    description:
      'Ask in plain English; Switchboard weighs every MCP route that can answer, picks the cheapest proven one under your budget cap, patches the call, and pays per call in USDC on Base over x402.',
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
    t: 'Switchboard weighs the routes',
    d: 'It scores every MCP that can answer — on price, proven settlement history, and your budget cap — and picks the best one.',
  },
  {
    n: '03',
    t: 'It patches the call',
    d: 'The winning route settles over x402 in USDC. Over-cap routes get dropped, not paid. You get a receipt with the tx.',
  },
]

export default function SwitchboardPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main x-main--fluid">
        <SwitchboardHero />

        {/* Interactive: pick a need, watch the engine rank + pick a route */}
        <SwitchboardTry />

        {/* Real settled routes — the engine at work */}
        <SwitchboardLive />

        {/* How routing works */}
        <section className="explain">
          <div className="explain__head">
            <span className="explain__eyebrow mono">HOW THE OPERATOR WORKS</span>
            <h2 className="explain__h2">You bring the question. Switchboard brings the route.</h2>
          </div>
          <div className="explain__steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="step__n mono">{s.n}</span>
                <h3 className="step__t">{s.t}</h3>
                <p className="step__d">{s.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}
