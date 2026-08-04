import type { Metadata } from 'next'
import { SITE } from '@/lib/docs'
import { PLANS } from '@/lib/plans'
import PricingPlans from '@/components/PricingPlans'
import StayUpToDate from '@/components/StayUpToDate'
import Footer from '@/components/Footer'

/** /pricing — the external plan page. Server component for SEO; the cards +
 * checkout are the PricingPlans client child. The same plan config powers
 * the dashboard plan page, so numbers can't drift. */

const TITLE = 'Pricing — Pantessa'
const DESCRIPTION =
  'Three plans metered in YEET credits, with a generous free tier. House-model answers spend credits; on-chain calls stay pay-per-call from your own wallet. Monthly billing via Stripe.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/pricing` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE}/pricing`, type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Pantessa embeddable agent chat',
  description: DESCRIPTION,
  offers: PLANS.map((p) => ({
    '@type': 'Offer',
    name: `Pantessa ${p.name}`,
    price: String(p.priceUsd),
    priceCurrency: 'USD',
  })),
})

const FAQ: { q: string; a: string }[] = [
  {
    q: 'How do creator kickbacks work?',
    a: "Pantessa takes a 0.20% fee on fee-bearing swap conversions — and when the conversion came through your intent link, half of that fee is yours. Earnings accrue automatically from server-truth signed turns; claims open at $10 and pay out in USDC on Base. Every plan earns the same split; plans differ only in how many links can be active at once.",
  },
  {
    q: 'What is a YEET credit?',
    a: 'One credit is one answer written by the house model. Credits are ledgered off-chain today and are designed to become an ERC-20 — your balance and usage history carry over when that ships.',
  },
  {
    q: 'What about on-chain calls and paid MCPs?',
    a: 'Never credits. Swaps, votes, and paid data/inference MCPs settle pay-per-call in USDC on Base over x402, from your own wallet, with a receipt for every call — the same on every plan.',
  },
  {
    q: 'What happens when I run out?',
    a: 'House-model answers pause until the month resets or you upgrade. Everything paid keeps working — add a paid engine like Yeetful · Claude and the chat continues pay-per-call.',
  },
]

export default function PricingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main">
        <section className="pricing">
          <div className="pricing__head">
            <span className="pricing__eyebrow mono">PRICING</span>
            <h1 className="pricing__h1">
              Plans that scale with <span className="pricing__em">your dapp.</span>
            </h1>
            <p className="pricing__sub">
              Every plan gets the full product — intent links, safe transaction building, receipts,
              the embeddable chat. Plans meter <strong>active links</strong> and{' '}
              <strong>YEET credits</strong>; on-chain calls stay pay-per-call from your users&rsquo;
              own wallets. And every plan earns: creators keep{' '}
              <strong>half of Pantessa&rsquo;s 0.20% fee</strong> on their links&rsquo; conversions.
            </p>
          </div>

          <PricingPlans />

          <div className="pricing__faq">
            {FAQ.map((f) => (
              <div className="pricing__faqitem" key={f.q}>
                <h3 className="pricing__faqq">{f.q}</h3>
                <p className="pricing__faqa">{f.a}</p>
              </div>
            ))}
          </div>

          <p className="pricing__enterprise">
            Running a top-ten venue or need custom terms?{' '}
            <a href="mailto:hello@yeetful.com?subject=Pantessa%20Enterprise">Talk to us</a> — SSO,
            custom credit pools, and co-marketing live there.
          </p>
        </section>

        <StayUpToDate />
      </main>
      <Footer />
    </>
  )
}
