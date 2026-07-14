import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import EmbedDemo from '@/components/EmbedDemo'
import EmbedInstall from '@/components/EmbedInstall'
import { DOCS_PAGES, docsJsonLd, docsUrl, guidePages } from '@/lib/docs'

// The /docs landing — the grand entry to Yeetful, told transaction-layer
// first: one intent in, a guarded artifact out, a receipt behind it. Jobs +
// Guardian + the venue table lead; the embed is the icing (kept — with its
// animated demo — but below the layer story). Server-rendered so the copy is
// crawlable — EmbedDemo and EmbedInstall are the only client islands.

const PAGE = DOCS_PAGES.find((p) => p.slug === '')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl('') },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(''), type: 'website' },
}

// The "go deeper" grid: every ready guide except this landing (legal pages live
// in their own sidebar group, not here).
const DEEPER = guidePages().filter((p) => p.slug !== '')

const STEPS = [
  {
    num: 'STEP 1 · INTENT',
    title: 'Say what should happen',
    lead: (
      <>
        &ldquo;Swap 20 USDC for ETH on Base.&rdquo; &ldquo;Bridge 5 USDC to Arbitrum, then
        deposit it to Hyperliquid, then long $12 of ETH, then protect it with a 5% stop.&rdquo;
        Money asks are claimed by <strong>deterministic parsers</strong>, not sampled from a
        model — the same sentence hits the same code path every time, and compound asks compile
        into <Link href="/docs/jobs">jobs</Link> the runner walks step by step.
      </>
    ),
    links: [
      { href: '/docs/jobs', label: 'The Jobs API' },
      { href: '/docs/transactions', label: 'How parsing works' },
    ],
  },
  {
    num: 'STEP 2 · GUARDED BUILD',
    title: 'Every artifact earns its signature',
    lead: (
      <>
        Per-venue builders — CoW, Uniswap v3/v4, NEAR Intents, Aave, Hyperliquid, Snapshot —
        derive each transaction from <strong>live venue state</strong>, and a fail-closed guard
        re-checks it before your wallet sees it. The model never writes calldata, amounts, or
        addresses. When a check fails you get the reason, not a guess.
      </>
    ),
    links: [
      { href: '/docs/transactions', label: 'Venues & guards' },
      { href: '/docs/guardian', label: 'Guardian: autonomy, no custody' },
    ],
  },
  {
    num: 'STEP 3 · SIGN & RECEIPT',
    title: 'Your wallet signs. Everything is receipted.',
    lead: (
      <>
        Nothing is custodial: the layer produces artifacts, <strong>only your signature moves
        money</strong>. Built, signed, or refused — every decision lands with its priced value
        on your <Link href="/dashboard">dashboard</Link> and traces live on{' '}
        <Link href="/activity">/activity</Link>. Autonomy you can audit beats autonomy you have
        to trust.
      </>
    ),
    links: [
      { href: '/docs/guardian', label: 'The Guardian receipts' },
      { href: '/activity', label: 'Watch it decide live' },
    ],
  },
]

const ELSEWHERE = [
  { href: 'https://www.npmjs.com/package/yeetful', label: 'yeetful on npm', sub: 'the embed helper plus x402 client/server helpers — MIT, TypeScript', ext: true },
  { href: 'https://github.com/Yeetful', label: 'Yeetful on GitHub', sub: 'the SDK, free MCPs, embed demos, and the rest — open source', ext: true },
  { href: 'https://uniswap-embed.yeetful.com/', label: 'Uniswap fork + the chat', sub: 'a live proof-of-concept: the embed mounted on a fork of the Uniswap interface', ext: true },
  { href: 'https://cow-embed.yeetful.com/', label: 'CoW Swap fork + the chat', sub: 'the same install on a fork of CoW Swap — the widget streams the connected wallet in', ext: true },
  { href: '/activity', label: 'Network activity', sub: 'every settled call on the network, anonymized and on-chain verifiable', ext: false },
]

export default function DocsIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />

      {/* ── Hero ── */}
      <p className="splash__eyebrow mono">BUILD ON YEETFUL</p>
      <h1 className="splash__h1">
        One intent in. <em className="hero__em">A guarded transaction out.</em>
      </h1>
      <p className="splash__lead">
        Yeetful is the transaction layer for agents: plain-English intents compile into
        deterministic, guard-checked artifacts your users sign with{' '}
        <strong>their own wallet</strong>{' '}— from the <Link href="/docs/jobs">Jobs API</Link>, the
        chat, or an embed on your site. The model never writes calldata. Every decision gets a
        receipt. Nothing is custodial.
      </p>
      <div className="splash__ctas">
        <Link href="/docs/jobs" className="btn btn--solid">
          Run a job for $0
        </Link>
        <Link href="/docs/transactions" className="btn btn--ghost">
          Venues &amp; guards
        </Link>
      </div>

      {/* ── The layer, in three moves ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">Intent → guarded build → receipt</h2>
        </div>
        <div className="splash__steps">
          {STEPS.map((s) => (
            <section key={s.num} className="splash__step">
              <p className="splash__stepnum mono">{s.num}</p>
              <h3 className="splash__steptitle">{s.title}</h3>
              <p className="splash__steplead">{s.lead}</p>
              <div className="splash__more">
                {s.links.map((l) => (
                  <Link key={l.href} href={l.href}>
                    {l.label} <ArrowUpRight width={13} height={13} />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* ── Try it now: the $0 quickstart ── */}
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">TRY IT · $0</p>
          <p className="splash__npmlead">
            <code>dryRun</code> compiles a compound intent and builds step 1 against{' '}
            <strong>live venues</strong>{' '}— real quote, real guard report — without creating or
            costing anything. Mint a <code>yf_</code> key at{' '}
            <Link href="/dashboard/keys">/dashboard/keys</Link> and paste. The{' '}
            <Link href="/docs/jobs">Jobs page</Link> shows the real response.
          </p>
        </div>
        <pre className="splash__code mono">{`curl -s https://www.yeetful.com/api/jobs \\
  -H "authorization: Bearer $YF_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"ask": "swap 5 usdc from base to arbitrum, then deposit 4 usdc to hyperliquid", "dryRun": true}'`}</pre>
      </div>

      {/* ── The embed: the icing ── */}
      <div className="splash__embedgrid" id="embed">
        <div className="splash__embedcopy">
          <p className="splash__kicker mono">THE ICING · 5 LINES</p>
          <h2 className="splash__pathtitle">The same rails, on your site</h2>
          <p className="splash__pathlead">
            Everything above ships as a chat you can mount on any page — routing, guarded
            builds, receipts, signing with the wallet already connected to your site. Copy the
            Claude Code prompt and Claude does the install end to end, or take the raw snippet
            and mount it yourself.
          </p>
          <EmbedInstall />
          <div className="splash__more">
            <Link href="/docs/embed">The full embed docs <ArrowUpRight width={13} height={13} /></Link>
            <Link href="/dashboard/keys">Mint an embed key <ArrowUpRight width={13} height={13} /></Link>
          </div>
        </div>
        <EmbedDemo />
      </div>

      {/* ── The SDK, demoted but reachable ── */}
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">ONE PACKAGE</p>
          <p className="splash__npmlead">
            Everything ships in the <code>yeetful</code> npm package: <code>yeetful/embed</code>{' '}
            mounts the chat, and the x402 client &amp; server helpers cover agents that{' '}
            <Link href="/docs/claude-code">pay per call</Link> and MCPs that{' '}
            <Link href="/docs/earn">track their earnings</Link>. MIT, TypeScript.
          </p>
        </div>
        <pre className="splash__code mono">npm install yeetful</pre>
      </div>

      {/* ── Go deeper ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">Everything you can do</h2>
          <span className="svc__count mono">{DEEPER.length} guides</span>
        </div>
        <div className="docs__cards">
          {DEEPER.map((p) => (
            <Link key={p.slug} href={`/docs/${p.slug}`} className="docs__card">
              <span className="docs__cardtitle">{p.title}</span>
              <span className="docs__carddesc">{p.description}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Elsewhere ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">The rest of the stack</h2>
        </div>
        <div className="dev__links">
          {ELSEWHERE.map((l) => (
            <a
              key={l.href}
              className="dev__biglink"
              href={l.href}
              {...(l.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {l.label} <ArrowUpRight width={14} height={14} />
              <span>{l.sub}</span>
            </a>
          ))}
        </div>
      </div>
    </>
  )
}
