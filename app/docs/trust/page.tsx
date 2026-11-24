import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsCrumbs, DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { CROSS_CHAIN_FEE_BPS, HL_BUILDER_FEE_TENTH_BPS, LINK_FEE_PCT, SWAP_FEE_PCT, feePctLabel } from '@/lib/fees'
import { GUARDIAN_DELEGATION_DAYS } from '@/lib/hl-guardian'
import { autoSellLive } from '@/lib/autopilot-live'

// The first page in SAFETY: why a trader can sign what Pantessa builds.
// Every safety sentence here was checked against the code that enforces it
// on 2026-11-24 (squad docs-clean, lane write-safety; the file:line list is
// in that lane's notes). Fees and durations are read from code constants.
// Absorbs the still-true parts of the retired /docs/spend-policy and
// /docs/transactions pages.
//
// Spot stops (fix-1, 2026-11-24): when automatic selling is switched on in
// this build (lib/autopilot-live autoSellLive, stamped at build time), the
// exceptions section says how a spot stop moves the token: a one-time spend
// permission the owner signs, capped at the amount they protect, pulled to
// Pantessa's spender only when the stop fires, sold, and the USDC sent to the
// owner (lib/spot-guard-exec: pull → [wrap] → approve → sell → owner). When
// it is off the page says nothing about it. `data-spot-autosell` on the
// section tells the harness which state it is reading.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'trust')!

const HL_FEE_PCT = feePctLabel(HL_BUILDER_FEE_TENTH_BPS / 10)
const CROSS_CHAIN_FEE_PCT = feePctLabel(CROSS_CHAIN_FEE_BPS)

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function TrustDocsPage() {
  const spotStops = autoSellLive()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <DocsCrumbs slug="trust" />
      <h1 className="docs__h1">Why you can sign it</h1>
      <p className="docs__lead">
        Pantessa builds the trade, checks it, and hands it to your wallet. Nothing happens until you sign.
      </p>

      <DocsSummary>
        <li>Pantessa never holds your money and cannot withdraw it.</li>
        <li>Code, not the AI, builds each trade from live venue data.</li>
        <li>A second check runs before your wallet sees it. If it fails, nothing is offered.</li>
        <li>The fee is shown before you sign.</li>
        <li>You sign. Your signature is the consent.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>What happens when you press a price</h2>
        <DocsSteps>
          <DocsStep title="You ask">
            <p>
              Press a price or a button on a chart, or type what you want in chat. Looking is free and needs no
              wallet. Acting needs one.
            </p>
          </DocsStep>
          <DocsStep title="Code builds it from live data">
            <p>
              Pantessa&apos;s code picks the venue and builds the transaction from live quotes, pools and balances,
              read at that moment. The AI can help work out what you asked for. It never writes the transaction.
            </p>
          </DocsStep>
          <DocsStep title="A second check runs">
            <p>
              A separate guard decodes the finished transaction and checks it: the contract is one Pantessa has
              pinned, the amount is the one you asked for, and what you swap for comes back to your own wallet. If any
              check fails, the build stops and you see the reason.
            </p>
          </DocsStep>
          <DocsStep title="You see the card">
            <p>
              The card shows the venue, the amount and the Pantessa fee. Quotes go stale, so a build past its
              deadline is built again with a fresh quote, never offered as it was.
            </p>
          </DocsStep>
          <DocsStep title="Your wallet signs">
            <p>
              Your wallet shows you the transaction and asks. If you sign, it goes to the venue. If you do not,
              nothing moves.
            </p>
          </DocsStep>
        </DocsSteps>

        <h2>{spotStops ? 'The exceptions: Hyperliquid and spot stops' : 'The one exception: Hyperliquid'}</h2>
        <p data-spot-autosell={spotStops ? '1' : '0'}>
          You sign every swap, bridge and transfer yourself. Hyperliquid orders may be signed by a Pantessa agent
          key instead. Many wallets cannot sign Hyperliquid&apos;s order format. For those wallets, and for every{' '}
          <Link href="/docs/guardian">Guardian</Link> stop, your wallet approves a Pantessa agent key once.
        </p>
        <ul>
          <li>Pantessa keeps that key encrypted.</li>
          <li>
            It places the orders you ask for, each one after your wallet signs a message for that order, and the
            protective closes you arm.
          </li>
          <li>Hyperliquid does not let an agent key withdraw. Your money stays in your Hyperliquid account.</li>
          <li>
            The approval lasts up to {GUARDIAN_DELEGATION_DAYS} days. You can remove it at any time in the
            Hyperliquid app.
          </li>
        </ul>
        {spotStops && (
          <p>
            A spot stop on a token in your wallet works through a one-time spend permission you sign, capped at the
            amount you choose to protect. When the stop fires, that amount moves to Pantessa&rsquo;s spender for the
            moment of the sale, is sold, and the USDC lands back in your wallet. Until it fires, nothing moves.
          </p>
        )}

        <h2>Fees</h2>
        <p>
          A swap&rsquo;s fee is named on the card before you sign. On a swap within one chain it is part of the
          transaction you sign. On a swap across chains it comes out of the quoted amount, so what the card says you
          receive is already after the fee.
        </p>
        <DocsFacts
          rows={[
            ['A normal swap', <span key="v" className="mono">{SWAP_FEE_PCT}</span>],
            ['A swap through a creator’s link', <span key="v"><span className="mono">{LINK_FEE_PCT}</span>, half to the link&apos;s creator</span>],
            ['A swap across chains', <span key="v" className="mono">{CROSS_CHAIN_FEE_PCT}</span>],
            ['A Hyperliquid perp order', <span key="v">up to <span className="mono">{HL_FEE_PCT}</span> of the fill, a rate you approve once</span>],
            ['Sends, staking, votes, Guardian closes', 'No Pantessa fee'],
          ]}
        />
        <p>
          The full fee table is on <Link href="/pricing">pricing</Link>.
        </p>

        <h2>No caps, and one switch</h2>
        <p>
          There are no spend caps or allowlists to set up. They were retired on 2026-10-30. You sign
          each trade, and that signature is the consent.
        </p>
        <p>
          To pause, sign in and press <strong>Freeze account</strong> on your{' '}
          <SpineLink href="/dashboard">dashboard</SpineLink>. While it is on, Pantessa refuses to build swaps within
          one chain, sends, Aave and Morpho moves and NFT trades for your wallet. It refuses Hyperliquid orders, and
          Guardian stops stand down. Press <strong>Resume account</strong> to undo it.
        </p>

      </div>

      <DocsNext
        links={[
          { href: '/docs/guardian', desc: 'A stop or take-profit that watches your Hyperliquid position.' },
          { href: '/docs/venues', desc: 'Every venue, chain and contract, read from the code.' },
          { href: '/docs/first-five-minutes', desc: 'Look, connect a wallet, press and sign.' },
        ]}
      />
    </>
  )
}
