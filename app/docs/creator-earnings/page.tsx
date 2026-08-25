import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'creator-earnings')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function CreatorEarningsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> CREATOR EARNINGS
      </p>
      <h1 className="docs__h1">Creator earnings</h1>
      <p className="docs__lead">
        When someone signs a conversion through your <Link href="/docs/links">intent link</Link>,
        you earn <strong>half of Pantessa&apos;s 0.20% fee</strong> — 10 basis points of the
        notional. A $100 stock buy through your link earns you $0.10; a creator whose audience
        moves $100k through their links has earned $100. No token, no points: a cut of real fees
        on real conversions.
      </p>

      <div className="docs__prose">
        <h2>What earns — and what never does</h2>
        <p>
          The rule is <strong>conversions, not movements</strong>. The fee exists only where
          Pantessa&apos;s routing chose a price for the signer — one asset becoming another
          through the guarded venue cascade:
        </p>
        <ul>
          <li>
            <strong>Earns:</strong> swaps and tokenized-stock buys/sells (CoW, Uniswap v3/v4,
            the LiFi stock venue) — including every run of a recurring buy.
          </li>
          <li>
            <strong>Never earns (and is never charged):</strong> NFT sales and transfers (a
            sale is an inflow), plain sends, bridges and funding legs, votes, staking, reads.
            These still show as dollars <em>moved</em> in your funnel — they just carry no fee
            for anyone.
          </li>
        </ul>
        <p>
          Sybil-proof by construction: earnings are a fraction of fees actually paid, so
          self-referral is just a self-discount — there is nothing to farm.
        </p>

        <h2>Server-truth accounting</h2>
        <p>
          Earnings compute from transactions that actually signed, priced by the guardrails at
          signing time and attributed to your link server-side. Client-side counters (opens,
          taps) affect nothing — the number on your dashboard is the number the system settles
          on, and the same source feeds <Link href="/activity">/activity</Link>.
        </p>

        <h2>Claims</h2>
        <p>
          Your dashboard shows <strong>earned · claimed · claimable</strong>. Claims open at{' '}
          <strong>$10</strong> and pay out as <strong>USDC on Base</strong>. The claim is a
          server-derived sweep of what you&apos;re owed — you never type an amount.
        </p>

        <h2>Capacity</h2>
        <p>
          Active links mirror the plan tiers: <strong>3</strong> on Builder ($0),{' '}
          <strong>25</strong> on Growth, <strong>unlimited</strong> on Scale — see{' '}
          <Link href="/pricing">pricing</Link>. The cap only gates <em>new</em>{' '}mints: links
          you&apos;ve shared keep working forever, revoking one frees a slot instantly, and a
          revoked link&apos;s funnel and earnings history are never destroyed.
        </p>

        <h2>Disclosure</h2>
        <p>
          Every creator-minted link page tells the visitor plainly: <em>&ldquo;The creator of
          this link earns half of Pantessa&apos;s 0.20% conversion fee. Sales, transfers, and
          bridges are always fee-free.&rdquo;</em>{' '}The visitor&apos;s price is identical with or
          without your link — your cut comes out of Pantessa&apos;s fee, not on top of it.
        </p>
      </div>
    </>
  )
}
