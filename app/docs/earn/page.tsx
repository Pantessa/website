import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'earn')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

const CLAUDE_PROMPT = `Add Yeetful earn-tracking to this MCP server.

After each PAID request settles, fire a non-blocking report to Yeetful so my
earnings show up on my dashboard. It must NOT slow down or block the response —
fire and forget, swallow all errors.

POST https://www.yeetful.com/api/mcp/receipts
  Headers: Authorization: Bearer \${YEETFUL_API_KEY}, content-type: application/json
  Body JSON: { mcp, amountUsd, payer?, tool?, network?, txHash? }
    mcp       = process.env.YEETFUL_MCP_SLUG   // my server's slug on yeetful.com
    amountUsd = the price of the call (number)
    payer     = the paying agent's wallet, if known
    tool      = the tool/route that was called
    network   = "base"

Read YEETFUL_API_KEY and YEETFUL_MCP_SLUG from env (put them in .env, don't commit):
  • API key — mint at https://www.yeetful.com/dashboard/keys (the yf_… secret shows once)
  • Slug — on your dashboard under "My MCP servers" (there's a copy button), or the
    last path segment of your https://www.yeetful.com/servers/<slug> URL

Put the call right after payment settlement, wrapped so a failed/slow report can
never affect the user's response (don't await it on the hot path; on serverless,
hand the promise to waitUntil).`

export default function EarnPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> TRACK MCP EARNINGS
      </p>
      <h1 className="docs__h1">Track MCP earnings</h1>
      <p className="docs__lead">
        The mirror of <Link href="/docs/ledger-sync">ledger sync</Link>: where agents report what
        they <strong>spend</strong>, your MCP reports what it <strong>earns</strong>. Add one
        async, non-blocking call after each paid request and your{' '}
        <Link href="/dashboard">dashboard</Link> shows total earned, last 30 days, calls served,
        and paying agents — per server.
      </p>

      <div className="docs__prose">
        <h2>1. Claim your MCP &amp; mint a key</h2>
        <p>
          Earnings are attributed to the wallet that <strong>claimed</strong> the server, so claim
          it first: open its page in the <Link href="/dashboard/servers">directory</Link> and sign
          in with the wallet its x402 <code>payTo</code> is set to. Then mint an API key at{' '}
          <Link href="/dashboard/keys">dashboard/keys</Link> (the <code>yf_…</code> secret shows
          once).
        </p>
        <pre>
          <code>{`# .env — never commit this
YEETFUL_API_KEY=yf_…
YEETFUL_MCP_SLUG=your-server-slug   # dashboard › My MCP servers (copy), or the /servers/<slug> URL`}</code>
        </pre>

        <h2>2. Report each paid call — non-blocking</h2>
        <p>
          The report is a record, not a payment, so it must never sit in the request&apos;s
          critical path. Fire it after settlement and <strong>don&apos;t await it</strong> (or hand
          it to <code>waitUntil</code> on serverless). It swallows its own errors.
        </p>

        <h3>The raw call — works today, zero dependencies</h3>
        <pre>
          <code>{`function reportEarning(fields) {
  // fire-and-forget: never throws, never blocks the response
  fetch('https://www.yeetful.com/api/mcp/receipts', {
    method: 'POST',
    headers: {
      authorization: \`Bearer \${process.env.YEETFUL_API_KEY}\`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mcp: process.env.YEETFUL_MCP_SLUG, ...fields }),
  }).catch(() => {}) // earnings telemetry — never affect the user
}

// …right after the payment settles, inside your handler:
reportEarning({ amountUsd: 0.01, payer, tool: 'list_proposals', network: 'base' })
// on Vercel/serverless, keep it alive past the response:
//   context.waitUntil(reportEarning({ … }))`}</code>
        </pre>

        <h3>
          Or with the <code>yeetful</code> SDK
        </h3>
        <p>
          If you already use the SDK&apos;s server helpers, <code>reportUsage()</code> is the typed
          version of the same call — fire-and-forget, never throws.
        </p>
        <pre>
          <code>{`import { reportUsage } from 'yeetful/server'

// after gate().settle():
reportUsage({
  apiKey: process.env.YEETFUL_API_KEY,
  mcp: process.env.YEETFUL_MCP_SLUG,
  amountUsd: 0.01,
  payer,            // the paying agent's wallet, if known
  tool: 'list_proposals',
})`}</code>
        </pre>

        <h2>Add it with Claude Code</h2>
        <p>
          Paste this into Claude Code from your MCP&apos;s repo — it wires the report into your
          settlement path for you.
        </p>
        <pre>
          <code>{CLAUDE_PROMPT}</code>
        </pre>

        <h2>What the dashboard shows</h2>
        <p>
          Your <Link href="/dashboard">Overview</Link> gains an <strong>Earn</strong> section beside
          Spend: total earned, earned in the last 30 days, calls served, paying agents, a 30-day
          trend, and a per-server breakdown. The servers you operate also appear on the{' '}
          <Link href="/dashboard/agents">Agents</Link> page as your payees.
        </p>
      </div>

      <div className="docs__callout">
        <p>
          Reported receipts are <strong>self-reported telemetry</strong>{' '}for rich, real-time
          analytics. The authoritative revenue number is on-chain — the USDC settled to your
          server&apos;s <code>payTo</code> address on Base.
        </p>
      </div>
    </>
  )
}
