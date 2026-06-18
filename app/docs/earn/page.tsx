import type { Metadata } from 'next'
import Link from 'next/link'
import CopyBlock from '@/components/CopyBlock'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'earn')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

const CLAUDE_PROMPT = `Add Yeetful earn-tracking to this MCP server using the yeetful SDK.

Goal: after each PAID request settles, report it to Yeetful so my earnings show
up on my dashboard. It must NEVER slow down, block, or break the response.

1) INSTALL THE SDK
   - npm i yeetful   (or the project's package manager)
   - import { reportUsage } from 'yeetful/server'
   reportUsage is fire-and-forget by design: it never throws, has a built-in
   timeout, and resolves false on any failure — so it can't slow or break the
   response. Don't hand-roll an HTTP call; use this.

2) WHERE TO CALL IT
   - Find the exact point where an x402 payment is verified and SETTLES (payment
     middleware/proxy, a per-route wrapper, or a payment hook). Call reportUsage
     right after a SUCCESSFUL settlement.
   - Do NOT await it on the hot path. On serverless/edge, hand the promise to the
     platform's background primitive, e.g. ctx.waitUntil(reportUsage({...}));
     otherwise just leave it un-awaited.

3) THE CALL
   reportUsage({
     apiKey: process.env.YEETFUL_API_KEY,    // required
     mcp: process.env.YEETFUL_MCP_SLUG,      // required — my server's slug on yeetful.com
     amountUsd,   // the call's price in US dollars as a NUMBER, e.g. 0.005
                  //   (your configured price — NOT on-chain atomic/USDC base units)
     payer,       // the paying agent's wallet address, if the settlement exposes it
     tool,        // the tool/route called — for MCP, the JSON-RPC params.name. If you
                  //   read the request body to get it, read a CLONE so the handler's
                  //   body isn't consumed.
     network: 'base',   // the chain you settled on (human name, not a CAIP-2 id)
     txHash,      // the settlement tx hash, if available
   })
   - Only call it when YEETFUL_API_KEY and YEETFUL_MCP_SLUG are both set; if either
     is missing, skip the report so the server still runs un-tracked.

4) CONFIG (read from env; put in .env, never commit)
   - YEETFUL_API_KEY  — mint at https://www.yeetful.com/dashboard/keys (the yf_…
                        secret is shown once)
   - YEETFUL_MCP_SLUG — copy from your dashboard's "My MCP servers", or the last
                        path segment of https://www.yeetful.com/servers/<slug>

FINISH BY: documenting both vars in .env.example, then running the project's
typecheck/build (and tests, if present) to confirm nothing broke.`

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

        <h3>Install the SDK and report</h3>
        <p>
          Add <code>yeetful</code> and call <code>reportUsage()</code>{' '}after settlement. It&apos;s
          fire-and-forget — never throws, built-in timeout — so don&apos;t await it on the hot path
          (on serverless, hand it to <code>waitUntil</code>).
        </p>
        <pre>
          <code>{`npm i yeetful

import { reportUsage } from 'yeetful/server'

// right after the x402 payment settles, in your handler:
reportUsage({
  apiKey: process.env.YEETFUL_API_KEY,
  mcp: process.env.YEETFUL_MCP_SLUG,
  amountUsd: 0.005,   // dollars, NOT on-chain atomic/USDC units
  payer,              // the paying agent's wallet, if known
  tool: 'list_proposals',
  network: 'base',
})
// on Vercel/serverless, keep it alive past the response:
//   ctx.waitUntil(reportUsage({ … }))`}</code>
        </pre>

        <h3>No SDK? The raw call</h3>
        <p>Same thing with zero dependencies — POST to the receipts endpoint and swallow errors.</p>
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

// …right after the payment settles:
reportEarning({ amountUsd: 0.005, payer, tool: 'list_proposals', network: 'base' })`}</code>
        </pre>

        <h2>Add it with Claude Code</h2>
        <p>
          Paste this into Claude Code from your MCP&apos;s repo — it wires the report into your
          settlement path for you.
        </p>
        <CopyBlock text={CLAUDE_PROMPT} label="Copy prompt" />

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
