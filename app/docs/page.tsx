import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import EmbedDemo from '@/components/EmbedDemo'
import EmbedInstall from '@/components/EmbedInstall'
import { DOCS_PAGES, docsJsonLd, docsUrl, guidePages } from '@/lib/docs'

// The /docs landing — the grand entry to Yeetful, told embed-first: combine
// MCPs (pick from the catalog or bring your own) into one agent, then drop
// that agent on your own site. The animated EmbedDemo + the shared
// EmbedInstall component are the headline; the SDK paths are demoted to
// compact links. Server-rendered so the copy is crawlable — EmbedDemo and
// EmbedInstall are the only client islands.

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
    num: 'STEP 1 · COMPOSE',
    title: 'Combine MCPs into one agent',
    lead: (
      <>
        Pick a few MCPs from <Link href="/servers">the catalog</Link> — swaps, DAO votes, order
        books, live market data — and they become <strong>one agent</strong>. A single ask can
        cross servers: &ldquo;swap 20 USDC for WETH, then vote on the treasury proposal&rdquo;
        routes each step to the right MCP, builds the transactions with guardrails, and hands
        your user a receipt for every hop.
      </>
    ),
    links: [
      { href: '/servers', label: 'Browse MCPs' },
      { href: '/docs/router', label: 'How routing works' },
    ],
  },
  {
    num: 'STEP 2 · BRING YOUR OWN',
    title: 'Add your own MCP',
    lead: (
      <>
        Point us at your MCP&rsquo;s URL and its tools are discovered on the spot — no listing
        process, no gatekeeping. Your server joins the working set next to the catalog MCPs, so
        the agent your users talk to speaks <strong>your protocol</strong>{' '}too. Star the
        &ldquo;start here&rdquo; tools and the router leads with them.
      </>
    ),
    links: [
      { href: '/servers/add', label: 'Add your MCP' },
      { href: '/docs/earn', label: 'Track its usage' },
    ],
  },
  {
    num: 'STEP 3 · EMBED',
    title: 'Put it on your site',
    lead: (
      <>
        Five lines mount the chat on any page — bubble or inline. <code>wallet: &apos;auto&apos;</code>{' '}
        bridges the wallet already connected to your site, so signatures pop in{' '}
        <strong>your user&rsquo;s own wallet</strong> and Yeetful never holds keys. A publishable{' '}
        <code>yfe_</code> key attributes usage to your account and unlocks embed analytics: every
        ask, every built transaction, every dead-end worth fixing.
      </>
    ),
    links: [
      { href: '/docs/embed', label: 'The embed contract' },
      { href: '/dashboard/keys', label: 'Mint an embed key' },
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
        Ship your own agent. <em className="hero__em">Embed it anywhere.</em>
      </h1>
      <p className="splash__lead">
        Combine MCPs — swaps, DAO votes, live data, <strong>your own server</strong> — into one
        agent, and drop it on your site with five lines. Your users ask in plain English; the
        agent routes across your set, builds transactions with guardrails and receipts, and signs
        with <strong>their own wallet</strong>. No API keys to hide, nothing custodial.
      </p>
      <div className="splash__ctas">
        <Link href="#embed" className="btn btn--solid">
          Embed the chat
        </Link>
        <Link href="/servers" className="btn btn--ghost">
          Browse MCPs
        </Link>
      </div>

      {/* ── The embed: demo + the one install ── */}
      <div className="splash__embedgrid" id="embed">
        <div className="splash__embedcopy">
          <p className="splash__kicker mono">THE 2-MINUTE INSTALL</p>
          <h2 className="splash__pathtitle">Watch it land on a page</h2>
          <p className="splash__pathlead">
            This is the whole product from your user&rsquo;s side: a bubble on your page that
            opens into the full chat — routing, transaction building, receipts, signing. Copy the
            Claude Code prompt, paste it into your app&rsquo;s repo, and Claude does the install
            end to end. Or take the raw snippet and mount it yourself.
          </p>
          <EmbedInstall />
          <div className="splash__more">
            <Link href="/docs/embed">The full embed docs <ArrowUpRight width={13} height={13} /></Link>
            <Link href="/dashboard/keys">Mint an embed key <ArrowUpRight width={13} height={13} /></Link>
          </div>
        </div>
        <EmbedDemo />
      </div>

      {/* ── How it comes together ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">How it comes together</h2>
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
