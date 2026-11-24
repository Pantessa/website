import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsFacts, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { LINK_FEE_PCT } from '@/lib/fees'
import { UNPROVEN_ACTIVE_LINKS } from '@/lib/intent-links'

// /docs/links (squad docs-clean, lane write-earn, 2026-11-24). The links
// studio is reached by its ADDRESS (LINKS_STUDIO_HREF): its seat in the app's
// menu is admin-only since 2026-11-19 (components/AppSpine ADMIN_ONLY_TABS),
// but a signed-in wallet that opens the address gets its own studio
// (components/LinksWorkspace → LinksStudioView). The options below are the
// mint form's own fields (components/MintLinkForm), with the limits from
// lib/intent-links (parseExpiry, parseMaxSigns, parseAllowWallets).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'links')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

const studio = <SpineLink href={LINKS_STUDIO_HREF}>pantessa.com/chat?tab=links</SpineLink>

export default function LinksDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> INTENT LINKS
      </p>
      <h1 className="docs__h1">Intent links</h1>
      <p className="docs__lead">
        An intent link is a short web address that carries a trade as a plain sentence, such as
        &ldquo;Buy $10 of AAPL&rdquo;. Whoever opens it connects their own wallet and signs, and you get
        half of Pantessa&apos;s fee on the swap.
      </p>

      <DocsSummary>
        <li>
          A link looks like <code>pantessa.com/i/&lt;slug&gt;</code>. It carries a sentence, never a
          transaction.
        </li>
        <li>Nothing runs until the visitor presses the button, and nothing moves until their own wallet signs.</li>
        <li>
          On a link swap you get half of the {LINK_FEE_PCT} fee. See{' '}
          <Link href="/docs/creator-earnings">Creator earnings</Link>.
        </li>
        <li>Your links, their numbers and your earnings are at {studio}.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Make a link</h2>
        <DocsSteps>
          <DocsStep title="Sign in">
            <p>A link is minted in your name, so Pantessa needs to know who you are.</p>
          </DocsStep>
          <DocsStep title={<>Open {studio}</>}>
            <p>It opens on <strong>Your intent links</strong>. Keep the address: it is the way in.</p>
          </DocsStep>
          <DocsStep title="Type the trade as a sentence">
            <p>
              Put the amount in it: &ldquo;Buy $10 of AAPL&rdquo;, &ldquo;Swap 5 USDC from Base to
              Arbitrum&rdquo;. The apps it needs are picked from the sentence, or pick up to four yourself.{' '}
              <strong>Test it out</strong>{' '}runs it in a chat first.
            </p>
          </DocsStep>
          <DocsStep title="Mint it and share it">
            <p>
              Press <strong>Mint this link</strong>, copy its <code>pantessa.com/i/</code> address and post it
              wherever your audience is.
            </p>
          </DocsStep>
        </DocsSteps>

        <h2>What the visitor sees</h2>
        <ul>
          <li>
            Your sentence and one button, <strong>Connect &amp; build my path</strong>. Connecting runs the
            scan and the build for their wallet. Signing stays theirs.
          </li>
          <li>
            Pantessa builds the trade fresh from the sentence. The link holds no transaction, so nothing in it
            can run by itself.
          </li>
          <li>An ask that sends money to someone never runs by itself. It waits until the visitor presses send.</li>
          <li>The page tells the visitor that the link&apos;s creator earns half of Pantessa&apos;s fee.</li>
        </ul>

        <h2>Options</h2>
        <p>
          All optional. The last four sit under <strong>Fine print</strong>, below the mint button.
        </p>
        <DocsFacts
          rows={[
            ['Send it to someone', 'Puts the link in their Pantessa inbox. Type an 0x address or a @handle.'],
            [
              'Return URL',
              'An https address, checked when you mint. After the visitor signs, a Return button takes them there. Never before, never by itself.',
            ],
            ['Expires', 'A date and time, up to two years ahead. After it, the link says it has expired.'],
            ['Max signs', 'From 1 to 1,000,000. Only confirmed signatures count. At the cap, the link stops.'],
            [
              'Wallet allowlist',
              'Up to 500 wallet addresses, one per line. Other wallets are told the link is reserved. The list never appears on the page.',
            ],
          ]}
        />

        <h2>Your links and their numbers</h2>
        <p>Everything is at {studio}:</p>
        <ul>
          <li>
            <strong>Name your page.</strong>{' '}Claim a name and every live link you hold shows at{' '}
            <code>pantessa.com/l/&lt;name&gt;</code>. There is no public page until you name one.
          </li>
          <li>
            <strong>Your links.</strong>{' '}One row per link: opens, connects, built, signed, dollars moved
            and earned.
          </li>
          <li>
            <strong>Earnings.</strong>{' '}What you earned and what you can claim. See{' '}
            <Link href="/docs/creator-earnings">Creator earnings</Link>.
          </li>
        </ul>

        <h2>Limits and revoking</h2>
        <ul>
          <li>
            A wallet that has not traded yet can have {UNPROVEN_ACTIVE_LINKS} links at once, and revoking one
            frees a slot. Sign one trade through Pantessa and the limit is gone. Links you already shared keep
            working either way.
          </li>
          <li>
            Press <strong>revoke</strong>{' '}on a row and the link stops at once. Visitors are told its creator
            retired it. What it already earned stays yours.
          </li>
        </ul>

        <h2>Called it pages</h2>
        <p>
          A Called it page, <code>pantessa.com/x/&lt;handle&gt;/&lt;SYMBOL&gt;</code>, shows an X
          account&apos;s calls on a market&apos;s chart. You can share it too, but it does not pay you: only a
          link you mint does. See <Link href="/docs/called-it">Called it</Link>.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/creator-earnings', title: 'Creator earnings', desc: 'How and when the money reaches you.' },
          { href: '/docs/called-it', title: 'Called it', desc: 'Calls pinned on the chart, judged by the price.' },
          { href: '/docs/host-buttons', title: 'Site buttons', desc: 'Put a link on your website as a button.' },
        ]}
      />
    </>
  )
}
