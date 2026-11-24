import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { SITE_CARD } from '@/lib/og-defaults'
import {
  CREATOR_FEE_SPLIT,
  CROSS_CHAIN_FEE_BPS,
  CROSS_CHAIN_NET_FEE_BPS,
  LINK_FEE_PCT,
  LINK_SWAP_FEE_BPS,
  SWAP_FEE_BPS,
  SWAP_FEE_PCT,
  feePctLabel,
} from '@/lib/fees'

// /docs/creator-earnings (squad docs-clean, lane write-earn, 2026-11-24).
// Every rate is read from lib/fees, never typed. The $10 claim floor is
// MIN_CLAIM_USD in app/api/intent-links/claims/route.ts (not exported), and
// "usually within a day" is that route's own payout note. Perp trades are
// stated as NOT paying creators (company rule); no recurring buys.

const creatorBps = (keptBps: number) => keptBps * CREATOR_FEE_SPLIT
const per100 = (keptBps: number) => `$${(creatorBps(keptBps) / 100).toFixed(2)}`
const LINK_CREATOR_PCT = feePctLabel(creatorBps(LINK_SWAP_FEE_BPS))
const MIN_CLAIM = '$10'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'creator-earnings')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
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
        When someone swaps through a <Link href="/docs/links">link you made</Link>, you get half of
        Pantessa&apos;s fee. A link swap carries a {LINK_FEE_PCT} fee, so you get{' '}
        {per100(LINK_SWAP_FEE_BPS)} for every $100 swapped.
      </p>

      <DocsSummary>
        <li>You get half of Pantessa&apos;s fee: {LINK_CREATOR_PCT} of a link swap.</li>
        <li>On a Uniswap swap with a stablecoin side, your half is paid to you inside the same transaction.</li>
        <li>Everything else goes to your balance. You can claim it from {MIN_CLAIM}, paid as USDC on Base.</li>
        <li>A wallet your link brings in pays you on its later swaps too, for life.</li>
        <li>Perp trades do not pay creators yet.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>How the money reaches you</h2>
        <DocsSteps>
          <DocsStep title="Someone signs a swap through your link">
            <p>
              They sign with their own wallet. The fee is in the transaction before they sign, and your half
              comes out of Pantessa&apos;s fee, not on top of it.
            </p>
          </DocsStep>
          <DocsStep title="On Uniswap with a stablecoin side, you are paid in the swap">
            <p>
              The same transaction sends your half to your wallet, in that stablecoin, on that chain. A buy
              that spends USDC pays you from what it spends. A sale into a stablecoin pays you from what it
              gets back. On Robinhood Chain&apos;s Uniswap v4 pools, only the sale pays you this way.
            </p>
          </DocsStep>
          <DocsStep title="Any other swap adds to your balance">
            <p>CoW orders, cross-chain swaps and pairs with no stablecoin side are counted in your balance instead.</p>
          </DocsStep>
          <DocsStep title={`Claim from ${MIN_CLAIM}`}>
            <p>
              Sign in and open <SpineLink href={LINKS_STUDIO_HREF}>pantessa.com/chat?tab=links</SpineLink>.
              It shows what you have earned, what you can claim, what was paid in the swap and what you
              have claimed. Press <strong>Claim USDC</strong>{' '}once you can claim {MIN_CLAIM} or more.
              You never type an amount: the claim takes your whole balance.
            </p>
            <p>The payout is USDC on Base, sent by hand. It usually arrives within a day.</p>
          </DocsStep>
        </DocsSteps>

        <h2>What you earn per $100</h2>
        <DocsFacts
          rows={[
            [
              'A link swap on Uniswap or CoW, tokenized stocks included',
              <>
                The visitor pays {LINK_FEE_PCT}. You get {LINK_CREATOR_PCT}:{' '}
                <strong className="mono">{per100(LINK_SWAP_FEE_BPS)}</strong>.
              </>,
            ],
            [
              'A cross-chain swap (NEAR Intents)',
              <>
                The visitor pays {feePctLabel(CROSS_CHAIN_FEE_BPS)}, the same as without a link. The venue keeps
                half, so you get {feePctLabel(creatorBps(CROSS_CHAIN_NET_FEE_BPS))}:{' '}
                <strong className="mono">{per100(CROSS_CHAIN_NET_FEE_BPS)}</strong>.
              </>,
            ],
            [
              'A later swap by a wallet your link brought in',
              <>
                Half of whatever fee that swap paid. A normal {SWAP_FEE_PCT} swap gets you{' '}
                <strong className="mono">{per100(SWAP_FEE_BPS)}</strong>.
              </>,
            ],
            ['A perp trade', 'Nothing yet.'],
            [
              'NFT sales, sends, bridges, staking, lending, votes',
              'Nothing. Pantessa charges no fee on these, so there is nothing to share.',
            ],
          ]}
        />

        <h2>Wallets you bring in</h2>
        <p>
          The first link a wallet signs a trade through makes that wallet yours, for life. After that, its swaps
          pay you half of Pantessa&apos;s fee even when they do not come through a link. A second link never
          takes the wallet over, and your own wallet never counts as one you brought in.
        </p>

        <h2>What the visitor is told</h2>
        <p>
          Your link&apos;s page tells the visitor that its creator earns half of Pantessa&apos;s fee on the
          trades it produces and on later trades from the wallets it brings. The fee itself is in the
          transaction they sign. <Link href="/docs/terms">The terms</Link> hold the full fee disclosure.
        </p>

        <h2>How it is counted</h2>
        <ul>
          <li>
            Only transactions that were signed and confirmed count. Opens and taps change nothing in your
            balance.
          </li>
          <li>The fee rate is read from the signed transaction itself, so your figure uses the rate the visitor paid.</li>
          <li>A swap so small that its fee rounds to zero carries no fee and earns nothing.</li>
          <li>The payment inside a swap never goes to the wallet that traded, so a swap you make on your own link pays you nothing there.</li>
          <li>Revoking a link stops it at once. What it already earned stays in your balance.</li>
        </ul>
      </div>

      <DocsNext
        links={[
          { href: '/docs/links', title: 'Intent links', desc: 'Make a link to a trade and share it.' },
          { href: '/docs/called-it', title: 'Called it', desc: 'Calls pinned on the chart, judged by the price.' },
          { href: '/docs/community', title: 'Community and rooms', desc: 'Post ideas and trades with proof.' },
        ]}
      />
    </>
  )
}
