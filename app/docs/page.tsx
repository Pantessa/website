import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsStep, DocsSteps } from '@/components/docs'
import { DOCS_GROUPS, DOCS_PAGES, docsJsonLd, docsUrl, groupPages, type DocsGroupId } from '@/lib/docs'
import { SWAP_FEE_PCT } from '@/lib/fees'
import { MARKETS_HREF } from '@/lib/markets'
import { SITE_CARD } from '@/lib/og-defaults'

// The /docs landing (squad docs-clean, 2026-11-24). It says what Pantessa is
// today in the brand's own lines, walks the START HERE path as three steps,
// then gives one section per group (lib/docs DOCS_GROUPS, reading order) with
// that group's cards from the registry. BUILD is its cards and one line of
// links (npm, GitHub): the curl lives on /docs/jobs, the install on
// /docs/embed. Server-rendered so the copy is crawlable.
// The markets door reads MARKETS_HREF through a SpineLink (the harness pins
// both: no hand-typed /markets, no bare Link into the app from /docs).

const PAGE = DOCS_PAGES.find((p) => p.slug === '')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl('') },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(''), type: 'website' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

function GroupCards({ group }: { group: DocsGroupId }) {
  const pages = groupPages(group)
  if (pages.length === 0) return null
  return (
    <div className="docs__cards">
      {pages.map((p) => (
        <Link key={p.slug} href={`/docs/${p.slug}`} className="docs__card">
          <span className="docs__cardtitle">{p.title}</span>
          <span className="docs__carddesc">{p.description}</span>
        </Link>
      ))}
    </div>
  )
}

/** The START HERE path: look, connect, press and sign. */
function StartSteps() {
  return (
    <DocsSteps>
      <DocsStep title="Look at a chart, free">
        <p>
          Open <SpineLink href={MARKETS_HREF}>the markets</SpineLink> and pick a stock, a coin or a
          perp. Charts and prices are public: no account, no wallet. On{' '}
          <Link href="/docs/called-it">Called it</Link>{' '}you can see an X account’s calls pinned on
          the same chart. More in <Link href="/docs/markets">Markets</Link>.
        </p>
      </DocsStep>
      <DocsStep title="Connect a wallet when you want to act">
        <p>
          Press any action and the sign-in door opens. Connect the wallet you already use, or continue
          with Google or email to get a wallet that only you control. More in{' '}
          <Link href="/docs/embedded-wallet">Sign in</Link>.
        </p>
      </DocsStep>
      <DocsStep title="Press and sign">
        <p>
          Press a price, a button or a sentence. Pantessa builds the trade on the right venue, checks
          it, and shows you the card with its fee ({SWAP_FEE_PCT} on a normal swap). Your wallet
          signs it, and the signature is the confirmation. More in{' '}
          <Link href="/docs/first-five-minutes">Your first five minutes</Link>.
        </p>
      </DocsStep>
    </DocsSteps>
  )
}

/** BUILD's one line under its cards: where the code is. The curl lives on
 *  /docs/jobs and the install on /docs/embed. */
function BuildLinks() {
  return (
    <div className="docs__prose">
      <p>
        The code is open:{' '}
        <a href="https://www.npmjs.com/package/pantessa" target="_blank" rel="noopener noreferrer">
          pantessa on npm
        </a>{' '}
        and{' '}
        <a href="https://github.com/Pantessa" target="_blank" rel="noopener noreferrer">
          Pantessa on GitHub
        </a>
        .
      </p>
    </div>
  )
}

export default function DocsIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />

      {/* ── Hero: what Pantessa is today, in the brand's own lines ── */}
      <p className="splash__eyebrow mono">PANTESSA DOCS</p>
      <h1 className="splash__h1">The live market you can act on.</h1>
      <p className="splash__lead">
        You have an intent. We do the rest. Looking is free and needs no account. Acting needs a
        wallet: press a price and Pantessa builds the trade, checks it, and hands it to your own
        wallet to sign. <strong>Pantessa never holds your money.</strong>
      </p>
      <div className="splash__ctas">
        <Link href="/docs/first-five-minutes" className="btn btn--solid">
          Your first five minutes
        </Link>
        <SpineLink href={MARKETS_HREF} className="btn btn--ghost">
          Open the markets
        </SpineLink>
      </div>

      {/* ── One section per group, in reading order. The h2s sit inside
          .docs__prose so they take the docs heading style, get anchors, and
          feed the "On this page" column. ── */}
      {DOCS_GROUPS.map((g) => (
        <section key={g.id}>
          <div className="docs__prose">
            <h2>{g.title}</h2>
            <p>{g.reader}</p>
            {g.id === 'start' && <StartSteps />}
          </div>
          <GroupCards group={g.id} />
          {g.id === 'build' && <BuildLinks />}
        </section>
      ))}
    </>
  )
}
