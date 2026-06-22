import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'router')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function RouterDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> ROUTER
      </p>
      <h1 className="docs__h1">Router: the routing engine</h1>
      <p className="docs__lead">
        Router is Yeetful&apos;s routing engine. You ask for something in plain English; it
        weighs every MCP route that can answer, picks the <strong>cheapest proven route under your
        cap</strong>, sends the call, and your agent pays for it per call in USDC on Base —{' '}
        <strong>one key, no per-provider accounts</strong>. See it move on the{' '}
        <Link href="/">home page</Link>.
      </p>

      <div className="docs__prose">
        <h2>The front door: one ask, plain English</h2>
        <p>
          You never name an endpoint or fill a parameter. Send a request the way you&apos;d say it —{' '}
          <em>&quot;live ETH price&quot;</em>, <em>&quot;scrape this pricing page&quot;</em>,{' '}
          <em>&quot;cheapest flight SFO→JFK&quot;</em> — from the{' '}
          <Link href="/chat">Yeetful chat</Link> or through the{' '}
          <code>yeetful</code> SDK. Router does the rest.
        </p>

        <h2>How it weighs routes</h2>
        <p>
          A directory service exposes many x402 endpoints. Router only considers the ones it
          can actually construct a valid, bounded call for — an endpoint is <strong>plannable</strong>{' '}
          when it has a published parameter schema, an exact (non-<code>upto</code>) price, and that
          price sits at or under the <strong>$0.05 auto-call ceiling</strong>. From the plannable set
          it ranks on the two levers that matter:
        </p>
        <ul>
          <li>
            <strong>Price.</strong> Cheaper wins. Among endpoints that fit your need, the lower
            per-call price is preferred — so routing is structurally a hunt for best execution.
          </li>
          <li>
            <strong>Proven.</strong> A route that has actually settled before (real receipts in the
            ledger) is trusted over an untested one. This keeps a route that&apos;s a fraction of a
            cent cheaper but has never answered from winning on price alone.
          </li>
        </ul>

        <h2>The pick: cheapest proven route under your cap</h2>
        <p>
          Router&apos;s choice is the <strong>cheapest route with a settlement history</strong>,
          falling back to the cheapest overall only when nothing in that category has been proven yet
          (a cold-start guard, so new routes still get a chance). You can preview exactly this on the{' '}
          <Link href="/">home page</Link> — pick a need and watch the candidate
          routes rank, with the winner marked <code>PICK</code>.
        </p>

        <h2>Over the cap? Dropped, not paid</h2>
        <p>
          Your <Link href="/docs/expense-account">expense account</Link> sets the budget — an
          allowlist plus per-call, per-day, and lifetime USD caps. If the best route for a request
          is still priced over your cap, Router <strong>drops the call</strong>: it is refused
          before any payment is signed, $0 is spent, and the denial is recorded. The guardrail saves
          money by <em>not</em> spending it. For chats Yeetful runs, this is a server-side hard
          refusal; for SDK agents paying their own wallet it is enforced in the SDK.
        </p>

        <h2>Every routed call is a receipt</h2>
        <p>
          Each settlement writes a row to your{' '}
          <Link href="/docs/ledger-sync">hosted ledger</Link> — the service, the amount, and the
          on-chain <code>txHash</code>. Routed spend is <strong>witnessed on Base</strong>, not
          self-reported: the public <Link href="/activity">activity feed</Link> and the
          &quot;proof, in the open&quot; strip on the home page link every settled call straight
          to Basescan.
        </p>

        <h2>Preview the lever — no spend</h2>
        <p>
          A read-only endpoint exposes the ranking over the live catalog without paying or running
          any inference, so you can see how a category&apos;s routes stack up:
        </p>
        <pre>
          <code>{`GET /api/route/preview   →  200
{
  "cap": 0.05,
  "categories": [
    {
      "category": "Data",
      "candidates": [
        { "service": "Yeetful · Snapshot", "price": 0.004, "proven": 18 },
        { "service": "CoinGecko",          "price": 0.01,  "proven": 0  }
      ],
      "pick": "yeetful-snapshot",   // cheapest PROVEN route
      "pickProven": true,
      "saved": 0.0455               // vs the priciest fitting route
    }
  ]
}`}</code>
        </pre>

        <h2>What the engine is, exactly</h2>
        <p>
          Under the hood the router is <code>lib/endpoint-planner.ts</code> plus a single planning
          inference call in the chat orchestrator, executing through Yeetful&apos;s version-aware
          x402 client. The price/proven ranking above is deterministic; matching your exact words to
          the right endpoint and filling its parameters is the planning model&apos;s job, and the
          request is built so a missing-required or unresolved path token <em>refuses</em> rather
          than pays for a guaranteed error.
        </p>
        <p>
          Want to point your own agent at it?{' '}
          <Link href="/docs/quickstart">Start with the quickstart</Link>, or give every connected
          app a <Link href="/docs/agents">daily budget</Link> so routing stays inside the lines.
        </p>
      </div>
    </>
  )
}
