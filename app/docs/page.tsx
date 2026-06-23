import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import CopyBlock from '@/components/CopyBlock'
import { DOCS_PAGES, docsJsonLd, docsUrl, readyPages } from '@/lib/docs'
import { PAYER_CLAUDE_PROMPT, PAYEE_CLAUDE_PROMPT } from '@/lib/prompts'

// The /docs landing — the grand entry to Yeetful. It absorbs what /developers
// was: one beautiful page a builder lands on. The two Claude copy-paste prompts
// (payer + payee) are the headline integration; the npm SDK snippets sit beside
// them; deep-doc cards explain the rest. Server-rendered so the copy is
// crawlable (CopyBlock is the only client island).

const PAGE = DOCS_PAGES.find((p) => p.slug === '')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl('') },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(''), type: 'website' },
}

const PAYER_SNIPPET = `import { yeetful } from 'yeetful/agent'

const pay = yeetful({
  wallet, // a viem WalletClient (CDP wallets work too)
  grant: { allow: ['api.example.x402.app'], perCallUsd: 0.05, perDayUsd: 2 },
})

// 402 → grant check → USDC paid → 200, with a receipt
const res = await pay('https://api.example.x402.app/search?q=tokyo')`

const PAYEE_SNIPPET = `import { reportUsage } from 'yeetful/server'

// right after the x402 payment settles, in your handler:
reportUsage({
  apiKey: process.env.YEETFUL_API_KEY,
  mcp: process.env.YEETFUL_MCP_SLUG,
  amountUsd: 0.005, tool: 'search', network: 'base',
}) // fire-and-forget — never blocks the response`

// The "go deeper" grid: every ready doc except this landing.
const DEEPER = readyPages().filter((p) => p.slug !== '')

const ELSEWHERE = [
  { href: 'https://www.npmjs.com/package/yeetful', label: 'yeetful on npm', sub: 'x402 client/server helpers + the agent expense-account wrapper', ext: true },
  { href: 'https://github.com/Yeetful', label: 'Yeetful on GitHub', sub: 'the SDK, example agent, demos, and the rest — open source', ext: true },
  { href: 'https://github.com/Yeetful/example-agent', label: 'example-agent', sub: 'the whole integration in ~40 lines — free demo mode', ext: true },
  { href: 'https://github.com/Yeetful/demo', label: 'travel-agent demo', sub: 'a full agent that researches a trip and pays its own way', ext: true },
  { href: '/activity', label: 'Network activity', sub: 'every settled call on the network, anonymized and on-chain verifiable', ext: false },
]

export default function DocsIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />

      {/* ── Hero ── */}
      <p className="splash__eyebrow mono">BUILD ON YEETFUL</p>
      <h1 className="splash__h1">
        Spend-controlled x402, <em className="hero__em">two ways.</em>
      </h1>
      <p className="splash__lead">
        Yeetful is spend-controlled <a href="https://www.x402.org">x402</a> for AI agents — two
        sides of one network. Agents <strong>pay</strong> per call against an allowlist and budgets
        you set; MCPs <strong>earn</strong> per call and watch it on a dashboard. USDC on Base, no
        API keys, a receipt for every decision.
      </p>
      <div className="splash__ctas">
        <Link href="/dashboard/keys" className="btn btn--solid">
          Mint a key
        </Link>
        <Link href="/dashboard/servers" className="btn btn--ghost">
          Browse the network
        </Link>
      </div>

      {/* ── The two integration paths ── */}
      <div className="splash__paths">
        {/* PAYER */}
        <section className="splash__path">
          <p className="splash__kicker mono">PAY · FOR AGENT BUILDERS</p>
          <h2 className="splash__pathtitle">Give your agent an expense account</h2>
          <p className="splash__pathlead">
            An allowlist plus per-call and per-day budgets, enforced <strong>before</strong> any
            payment is signed. Runaway loops hit the wall, not your wallet.
          </p>
          <p className="splash__copycap mono">Paste into Claude Code — it wires the SDK in:</p>
          <CopyBlock text={PAYER_CLAUDE_PROMPT} label="Copy payer prompt" />
          <p className="splash__copycap mono">…or by hand, ~20 lines:</p>
          <pre className="splash__code mono">{PAYER_SNIPPET}</pre>
          <div className="splash__more">
            <Link href="/docs/claude-code">The payer walkthrough <ArrowUpRight width={13} height={13} /></Link>
            <Link href="/docs/quickstart">Quickstart <ArrowUpRight width={13} height={13} /></Link>
          </div>
        </section>

        {/* PAYEE */}
        <section className="splash__path">
          <p className="splash__kicker mono">EARN · FOR MCP OPERATORS</p>
          <h2 className="splash__pathtitle">Earn from your MCP</h2>
          <p className="splash__pathlead">
            Report each paid call after it settles — one async, non-blocking line. Your dashboard
            shows total earned, calls served, and paying agents, per server.
          </p>
          <p className="splash__copycap mono">Paste into Claude Code — it wires the report in:</p>
          <CopyBlock text={PAYEE_CLAUDE_PROMPT} label="Copy payee prompt" />
          <p className="splash__copycap mono">…or by hand, one call:</p>
          <pre className="splash__code mono">{PAYEE_SNIPPET}</pre>
          <div className="splash__more">
            <Link href="/docs/earn">The payee walkthrough <ArrowUpRight width={13} height={13} /></Link>
            <Link href="/docs/launchpad">Claim &amp; launch <ArrowUpRight width={13} height={13} /></Link>
          </div>
        </section>
      </div>

      {/* ── npm SDK callout ── */}
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">ONE PACKAGE</p>
          <p className="splash__npmlead">
            Both sides ship in the <code>yeetful</code> npm package — x402 client &amp; server
            helpers plus the agent expense-account wrapper. MIT, TypeScript.
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