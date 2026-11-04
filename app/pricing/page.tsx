import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/docs'
import { ANSWER_PACK, DESK_PLANS, DESK_PLAN_FEATURES, EARN_CENTS_PER_ANSWER, LISTED_PLANS, PLAN_BY_ID, TASTE, answersEarnedByFee } from '@/lib/plans'
import { DESIGN_PARTNER_FREE_DAYS, DESK_FEE_TIERS, DESK_PLATFORM_FEE_USD, tieredDeskFeeUsd } from '@/lib/tenant/spec'
import PricingPlans from '@/components/PricingPlans'
import DeskPlans, { type DeskTierView, type EnterpriseView } from './DeskPlans'
import StayUpToDate from '@/components/StayUpToDate'
import Footer from '@/components/Footer'
import { CREATOR_FEE_SPLIT, LINK_FEE_PCT, LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, SWAP_FEE_PCT } from '@/lib/fees'

/** /pricing (pricing v2) — the take rate is the business; a plan prices house
 * answers and nothing else. Server component for SEO; cards + checkout are the
 * PricingPlans client child. Every number is read from lib/plans + lib/fees,
 * so the page, the checkout and the gate can never drift.
 *
 * THE DESK (2026-11-03, squad five-million): a second section prices the
 * governed desk — Sandbox · Agent · Desk · Enterprise — from lib/plans
 * (DESK_PLAN_FEATURES, written from lib/tenant/entitlements) and
 * lib/tenant/spec (the Enterprise platform fee, bps tiers, design-partner
 * days). The DeskPlans client child owns its month/year switch + checkout. */

const TITLE = 'Pricing — Pantessa'
const DESCRIPTION = `Looking is free, forever. Trading costs ${SWAP_FEE_PCT}, taken inside the trade you sign. Every trade refills your chat — or get Plus for $${PLAN_BY_ID.plus.priceUsd} a month, or bring your own API key for free.`

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
  name: 'Pantessa',
  description: DESCRIPTION,
  offers: [
    ...LISTED_PLANS.map((p) => ({ '@type': 'Offer', name: `Pantessa ${p.name}`, price: String(p.priceUsd), priceCurrency: 'USD' })),
    ...DESK_PLANS.map((p) => ({ '@type': 'Offer', name: `Pantessa ${p.name} (desk)`, price: String(p.priceUsd), priceCurrency: 'USD' })),
    { '@type': 'Offer', name: `Pantessa — ${ANSWER_PACK.answers} answers`, price: String(ANSWER_PACK.priceUsd), priceCurrency: 'USD' },
  ],
})

// ── The desk, computed — never typed ────────────────────────────────────────
const usd = (n: number) => `$${n.toLocaleString('en-US')}`
const usdShort = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('en-US')}M` : usd(n))
const DESK_TIERS: DeskTierView[] = DESK_PLAN_FEATURES.map((t) => ({
  id: t.id,
  name: t.name,
  tagline: t.tagline,
  inherits: t.inherits,
  adds: t.adds.map((f) => ({ text: f.text, ...(f.soon ? { soon: true } : {}) })),
  price: t.plan ? { month: t.plan.priceUsd, year: t.plan.yearlyUsd ?? null } : null,
}))
const TIER_LINES = DESK_FEE_TIERS.map((t, i) => {
  const prev = i > 0 ? DESK_FEE_TIERS[i - 1].uptoUsd : 0
  return Number.isFinite(t.uptoUsd) ? `${t.bps} bps to ${usdShort(t.uptoUsd)}` : `${t.bps} bps above ${usdShort(prev)}`
})
const EXAMPLE_NOTIONAL = 25_000_000
const EXAMPLE_FEE = tieredDeskFeeUsd(EXAMPLE_NOTIONAL)
const DESK_ENTERPRISE: EnterpriseView = {
  platformUsd: usd(DESK_PLATFORM_FEE_USD),
  tiers: TIER_LINES,
  partner: `Design partners: free for the first ${DESIGN_PARTNER_FREE_DAYS} days.`,
  example:
    `Enterprise at ${usdShort(EXAMPLE_NOTIONAL)} of settled notional in a month: ${usd(DESK_PLATFORM_FEE_USD)} + ${usd(EXAMPLE_FEE)} = ` +
    `${usd(DESK_PLATFORM_FEE_USD + EXAMPLE_FEE)}, less the fees already taken inside those trades. Agent and Desk trades pay the ` +
    `fee every trade pays, taken inside the transaction (${SWAP_FEE_PCT} on a swap).`,
}

/** The refill ladder, computed from the live rates — never typed. */
const organicFee = (usd: number) => (usd * SWAP_FEE_BPS) / 10_000
const linkNetFee = (usd: number) => (usd * LINK_SWAP_FEE_BPS * (1 - CREATOR_FEE_SPLIT)) / 10_000
const LADDER = [
  { label: 'A $1 swap', answers: answersEarnedByFee(organicFee(1)), note: 'Too small to earn. A script farming tiny trades gets nothing.' },
  { label: 'A $100 swap', answers: answersEarnedByFee(organicFee(100)), note: `A ${Math.round(organicFee(100) * 100)}¢ fee.` },
  { label: 'A $1,000 swap', answers: answersEarnedByFee(organicFee(1000)), note: `A $${organicFee(1000).toFixed(2)} fee.` },
  { label: '$100 through a shared link', answers: answersEarnedByFee(linkNetFee(100)), note: 'After the link’s creator takes their half.' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What costs money, exactly?',
    a: `Two things. Trading: ${SWAP_FEE_PCT} on a swap (${LINK_FEE_PCT} through a shared link, half of it to whoever shared it), taken inside the transaction you sign. And house-model answers beyond the free ones. Nothing else — no seat, no account fee, no minimum, no fee on sends, bridges, staking, lending or NFT sales. The desk plans below are a separate product, for agents and firms that trade under a written policy.`,
  },
  {
    q: 'What is a house answer?',
    a: `A reply the house model writes — “what is Morpho”, “why is this moving”. Anything that builds a transaction (a swap, a stock buy, a DCA, a stop) is compiled without the model and never uses one. You get ${TASTE.wallet} house answers a day free.`,
  },
  {
    q: 'Which trades refill my chat?',
    a: `Swaps that settle through Uniswap on any chain we support, including tokenized stocks on Robinhood Chain: 1 answer for every ${EARN_CENTS_PER_ANSWER}¢ of fee, once the receipt is verified on-chain. CoW orders, Hyperliquid fills and cross-chain swaps don’t earn yet — their fee isn’t in a single receipt we can verify.`,
  },
  {
    q: 'Is my API key safe with you?',
    a: 'It is checked with Anthropic’s free token-counting endpoint, encrypted at rest, and never shown again — not to you, not in a log. Use a key from its own Console workspace with a spend limit, and remove it from Settings whenever you like. A key that stops working never falls back to our bill silently; the chat tells you.',
  },
  {
    q: 'What happens when I run out?',
    a: 'House answers pause until midnight UTC. Trades, DCA, guardians, jobs, charts, watchlists and alerts all keep working. You can also add a paid engine like Pantessa · Claude and keep going pay-per-call from your wallet. Answers you earned or bought are spent only for a wallet that has signed in — one free signature.',
  },
  {
    q: 'How do creator kickbacks work?',
    a: `A swap that comes through an intent link pays ${LINK_FEE_PCT}, and half of it is the link creator’s — for life on every wallet that link brought. On a Uniswap swap with a stablecoin side, that half is paid to the creator inside the same transaction; everything else accrues, and claims open at $10 in USDC on Base. Every account earns the same split.`,
  },
]

const ALWAYS_FREE = [
  'Every chart, every timeframe, every symbol',
  'Unlimited watchlists and sections',
  'Unlimited price alerts',
  'Technicals, news and community on every symbol page',
  'DCA schedules, guardians and multi-step jobs — no caps',
  'Intent links, your public page, and creator earnings',
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
              Looking is free. <span className="pricing__em">Trading pays.</span>
            </h1>
            <p className="pricing__sub">
              Charts, watchlists, alerts and every automation are free at every tier, with no limits. A trade costs{' '}
              <strong>{SWAP_FEE_PCT}</strong>, taken inside the transaction you sign, and nothing else. The one thing with a
              meter is the house model, and <strong>every trade you sign refills it</strong>.
            </p>
          </div>

          <PricingPlans />

          <div className="pricing__split">
            <div className="pricing__panel">
              <span className="pricing__eyebrow mono">EVERY TRADE REFILLS YOUR CHAT</span>
              <ul className="pricing__ladder">
                {LADDER.map((r) => (
                  <li key={r.label}>
                    <span className="pricing__ladderlabel">{r.label}</span>
                    <span className="pricing__laddernum">{r.answers}</span>
                    <span className="pricing__laddernote">{r.note}</span>
                  </li>
                ))}
              </ul>
              <p className="pricing__fine">
                1 answer per {EARN_CENTS_PER_ANSWER}¢ of fee, granted when the receipt verifies on-chain. Earned answers never expire.
              </p>
            </div>
            <div className="pricing__panel">
              <span className="pricing__eyebrow mono">FREE AT EVERY TIER, FOREVER</span>
              <ul className="pricing__feats pricing__feats--wide">
                {ALWAYS_FREE.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="pricing__fine">
                Other platforms meter looking. <Link href="/compare">See the comparison</Link>.
              </p>
            </div>
          </div>

          <section className="deskprice" id="desk" aria-labelledby="desk-pricing-h">
            <div className="deskprice__head">
              <div className="deskprice__headtext">
                <span className="pricing__eyebrow mono">FOR AGENTS AND FIRMS</span>
                <h2 id="desk-pricing-h" className="pricing__h2 deskprice__h2">
                  The desk
                </h2>
                <p className="deskprice__sub">
                  Run an agent, or a firm’s trading, under rules you write. A default-deny policy judges every order before
                  anything is built, every step lands on a hash-chained blotter, and your wallet or your custody signs. The
                  sandbox is free, so you can wire a policy before you pay.
                </p>
              </div>
            </div>
            <DeskPlans tiers={DESK_TIERS} enterprise={DESK_ENTERPRISE} />
            <p className="pricing__fine">
              <Link href="/desk">What the desk is</Link>
              {' · '}
              <Link href="/docs/desk">The desk docs</Link>
              {' · '}
              <Link href="/docs/venues">The venues it can reach</Link>
            </p>
          </section>

          <div className="pricing__faq">
            {FAQ.map((f) => (
              <div className="pricing__faqitem" key={f.q}>
                <h3 className="pricing__faqq">{f.q}</h3>
                <p className="pricing__faqa">{f.a}</p>
              </div>
            ))}
          </div>

          <p className="pricing__enterprise">
            Embedding Pantessa for your community, or need white-label, team seats or an SLA?{' '}
            <a href="mailto:hello@pantessa.com?subject=Pantessa%20for%20teams">Talk to us</a>. Team terms are arranged by hand.
          </p>
        </section>

        <StayUpToDate />
      </main>
      <Footer />
    </>
  )
}
