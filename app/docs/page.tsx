import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { ArrowUpRight } from 'lucide-react'
import EmbedDemo from '@/components/EmbedDemo'
import EmbedInstall from '@/components/EmbedInstall'
import { DocsStep, DocsSteps } from '@/components/docs'
import { DOCS_GROUPS, DOCS_PAGES, docsJsonLd, docsUrl, groupPages, type DocsGroupId } from '@/lib/docs'
import { SWAP_FEE_PCT } from '@/lib/fees'
import { MARKETS_HREF } from '@/lib/markets'
import { SITE_CARD } from '@/lib/og-defaults'

// The /docs landing (squad docs-clean, 2026-11-24). It says what Pantessa is
// today in the brand's own lines, walks the START HERE path as three steps,
// then gives one section per group (lib/docs DOCS_GROUPS, reading order) with
// that group's cards from the registry. BUILD carries the one developer
// block (the $0 jobs dry run and the embed install). Server-rendered so the
// copy is crawlable: EmbedDemo and EmbedInstall are the only client islands.
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
          <Link href="/docs/embedded-wallet">Sign in and wallets</Link>.
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

/** BUILD's one developer block: the $0 jobs dry run and the embed install. */
function BuildBlock() {
  return (
    <>
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">TRY THE JOBS API · $0</p>
          <p className="splash__npmlead">
            A <code>dryRun</code> compiles a multi-step ask and builds step one against live venues,
            without creating or costing anything. Make a <code>yf_</code> key at{' '}
            <SpineLink href="/dashboard/keys">/dashboard/keys</SpineLink> and paste it in. The{' '}
            <Link href="/docs/jobs">Jobs API</Link> page explains the response.
          </p>
        </div>
        <pre className="splash__code mono">{`curl -s https://www.pantessa.com/api/jobs \\
  -H "authorization: Bearer $YF_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"ask": "swap 5 usdc from base to arbitrum, then deposit 5 usdc to hyperliquid", "dryRun": true}'`}</pre>
      </div>

      <div className="splash__embedgrid" id="embed">
        <div className="splash__embedcopy">
          <p className="splash__kicker mono">EMBED THE CHAT</p>
          <h3 className="splash__pathtitle">The Pantessa chat, on your site</h3>
          <p className="splash__pathlead">
            Mount the chat on any page with the <code>pantessa</code> npm package. It builds checked
            trades and signs with the wallet already connected to your site. Copy the Claude Code
            prompt and Claude does the install, or take the snippet and mount it yourself.
          </p>
          <EmbedInstall />
          <div className="splash__more">
            <Link href="/docs/embed">
              The embed docs <ArrowUpRight width={13} height={13} />
            </Link>
            <SpineLink href="/dashboard/keys">
              Make an embed key <ArrowUpRight width={13} height={13} />
            </SpineLink>
          </div>
        </div>
        <EmbedDemo />
      </div>

      <div className="docs__prose">
        <p>
          The code is open:{' '}
          <a href="https://www.npmjs.com/package/pantessa" target="_blank" rel="noopener noreferrer">
            pantessa on npm
          </a>{' '}
          (<code>npm install pantessa</code>) and{' '}
          <a href="https://github.com/Pantessa" target="_blank" rel="noopener noreferrer">
            Pantessa on GitHub
          </a>
          .
        </p>
      </div>
    </>
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
          Start here
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
          {g.id === 'build' && <BuildBlock />}
        </section>
      ))}
    </>
  )
}
