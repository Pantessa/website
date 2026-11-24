import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { JobOfferLine } from '@/components/JobOfferDoor'
import { DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SWAP_FEE_PCT } from '@/lib/fees'
import { MARKETS_HREF } from '@/lib/markets'
import { SITE_CARD } from '@/lib/og-defaults'

// A stranger's first five minutes (squad docs-clean, 2026-11-24): look at a
// chart for free, press a price, connect when asked, sign, see the receipt.
// Then where to go next. Links to /markets and /t/* are SpineLinks (a pin
// requires it); the chat prefill links never send by themselves.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'first-five-minutes')!

/** Prefill deep link into /chat: the ask arrives in the composer, unsent. */
const ask = (prompt: string, mcps?: string) =>
  `/chat?${mcps ? `mcps=${mcps}&` : ''}prompt=${encodeURIComponent(prompt)}`

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function FirstFiveMinutesPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> YOUR FIRST FIVE MINUTES
      </p>
      <h1 className="docs__h1">Your first five minutes</h1>
      <p className="docs__lead">
        Look at any market for free. When you want to act, press the price and sign with your own wallet.
      </p>

      <DocsSummary>
        <li>Looking needs no wallet and no account.</li>
        <li>Every price and chip on a chart is a button that builds a trade.</li>
        <li>You see the venue, amounts and fee before you sign.</li>
        <li>Pantessa never holds your money. Your signature is the confirmation.</li>
        <li>
          A normal swap costs <span className="mono">{SWAP_FEE_PCT}</span>.
        </li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>The path</h2>
        <DocsSteps>
          <DocsStep title="Open a chart">
            <p>
              Start at <SpineLink href={MARKETS_HREF}>Markets</SpineLink>, or go straight to one market, like{' '}
              <SpineLink href="/t/AAPL">/t/AAPL</SpineLink> or <SpineLink href="/t/ETH">/t/ETH</SpineLink>. The chart is
              live. Nobody asks you to sign in.
            </p>
          </DocsStep>
          <DocsStep title="Press a price or a chip">
            <p>A chip reads like what it does: &ldquo;Buy $10 of AAPL&rdquo;. Pressing it is your ask.</p>
          </DocsStep>
          <DocsStep title="Connect a wallet when asked">
            <p>
              The door opens and your ask waits for you. Use a wallet you already have, or{' '}
              <Link href="/docs/embedded-wallet">sign in with Google or email</Link>.
            </p>
          </DocsStep>
          <DocsStep title="Read the sign card, then sign">
            <p>
              Pantessa builds the trade and shows the venue, amounts, chain and fee. Sign it in your wallet, or decline.
              Nothing moves until you sign.
            </p>
          </DocsStep>
          <DocsStep title="See what happened">
            <p>The receipt stays in the chat where you signed it.</p>
          </DocsStep>
        </DocsSteps>
        <p>
          Why it is safe to sign: <Link href="/docs/trust">the guardrails</Link>.
        </p>

        <h2>Ask in words</h2>
        <p>
          The chat takes the same asks as the chips. These links fill in the ask and wait; nothing sends until you press
          enter:{' '}
          <SpineLink href={ask('What is the current price and 24h change for ETH?', 'uniswap-free')}>
            &ldquo;What&apos;s the price of ETH?&rdquo;
          </SpineLink>
          ,{' '}
          <SpineLink href={ask('Swap $1 worth of ETH to USDC on Base', 'uniswap-free')}>
            &ldquo;Swap $1 of ETH to USDC&rdquo;
          </SpineLink>
          .
        </p>

        <h2>Where to go next</h2>
        <ul>
          <li>
            <strong>Watch and get alerts.</strong> Watchlists and alerts are free and unlimited. See{' '}
            <Link href="/docs/markets">Markets</Link>.
          </li>
          <li>
            <strong>See who called it.</strong> Type an X handle and see every call it made on a market, judged by the
            price. See <Link href="/docs/called-it">Called it</Link>.
          </li>
          <li>
            <strong>Protect a position.</strong> &ldquo;Stop-loss my ETH perp at -8%&rdquo; arms a{' '}
            <Link href="/docs/guardian">Guardian</Link> that checks it every minute.
          </li>
          <li>
            <strong>Tell it once.</strong> Say <JobOfferLine example="Fund Robinhood Chain with $50 from Base including gas, then buy $40 of AAPL" />{' '}
            and you get <Link href="/docs/jobs">a job</Link> that waits for the bridge, then offers the buy. The Jobs tab
            in the chat shows what is running.
          </li>
          <li>
            <strong>Share a trade.</strong> Make a link to a trade and earn on the swaps it brings. See{' '}
            <Link href="/docs/links">Links</Link>.
          </li>
        </ul>
      </div>

      <DocsNext
        links={[
          { href: '/docs/markets', title: 'Markets', desc: 'What a chart can do: trade, protect, watch, alert.' },
          { href: '/docs/called-it', title: 'Called it', desc: 'An X account’s calls on the chart, judged by the price.' },
          { href: '/docs/embedded-wallet', title: 'Sign in', desc: 'A wallet, Google or email.' },
        ]}
      />
    </>
  )
}
