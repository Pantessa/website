import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'x402')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function X402Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> X402 V1 + V2
      </p>
      <h1 className="docs__h1">x402, v1 and v2</h1>
      <p className="docs__lead">
        x402 is HTTP <code>402 Payment Required</code>, reborn: the server quotes a price, the
        client signs a USDC authorization, a facilitator settles on-chain. The SDK speaks both
        protocol versions and picks per-challenge — you never branch on it.
      </p>

      <div className="docs__prose">
        <h2>The flow</h2>
        <ol>
          <li>
            Your agent calls an endpoint; the server answers <code>402</code> with a discovery
            document: accepted networks, asset, recipient, price.
          </li>
          <li>
            The SDK checks your <Link href="/docs/expense-account">grant</Link> against the
            quoted price, then signs an EIP-3009 <code>TransferWithAuthorization</code> — gasless
            for the payer.
          </li>
          <li>
            The request retries with the payment header; the server&apos;s facilitator settles
            on-chain and responds <code>200</code> plus a settlement header with the tx hash.
          </li>
        </ol>

        <h2>v1 vs v2 — what the SDK absorbs</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>x402 v1</th>
              <th>x402 v2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Price field</td>
              <td>
                <code>maxAmountRequired</code>
              </td>
              <td>
                <code>amount</code>
              </td>
            </tr>
            <tr>
              <td>Network id</td>
              <td>
                <code>&quot;base&quot;</code>
              </td>
              <td>
                CAIP-2 — <code>&quot;eip155:8453&quot;</code>
              </td>
            </tr>
            <tr>
              <td>Payment header</td>
              <td>
                <code>X-PAYMENT</code> (flat payload)
              </td>
              <td>
                <code>PAYMENT-SIGNATURE</code> (envelope echoing the accepted requirement)
              </td>
            </tr>
            <tr>
              <td>Settle header</td>
              <td>
                <code>X-PAYMENT-RESPONSE</code>
              </td>
              <td>
                <code>PAYMENT-RESPONSE</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Real gateways are mid-migration — TripAdvisor&apos;s moved to v2 while others still
          serve v1 — so a single agent routinely meets both in one session. Selection also skips
          requirements the client can&apos;t sign (non-EVM networks such as <code>solana:…</code>,
          entries with no parseable amount): an unpayable challenge is a clean{' '}
          <code>PaymentError</code>, receipted as <code>payment-failed</code>, never a crash.
        </p>

        <h2>Networks</h2>
        <p>
          USDC on Base is the default everywhere on Pantessa; the client also resolves Base
          Sepolia, Ethereum, Optimism, Arbitrum, and Polygon, plus any <code>eip155:*</code> id a
          v2 challenge presents. Restrict with <code>allowedNetworks</code> if your agent should
          only ever pay on specific chains.
        </p>

        <h2>Using the primitives directly</h2>
        <p>
          The agent wrapper sits on a plain x402 toolkit you can use without grants:{' '}
          <code>createPaymentClient({'{ wallet }'})</code> from <code>yeetful/client</code> for
          auto-paying fetch, and <code>withPayment()</code> from <code>yeetful/next</code> (or{' '}
          <code>gate()</code> / the Express middleware) to charge for your own routes — that&apos;s
          how you <em>sell</em> to agents rather than buy.
        </p>
        <p>
          The first thing worth paying: Pantessa&apos;s own{' '}
          <Link href="/docs/paid-doors">paid MCP doors</Link> — the same tools as the free doors
          with no rate limit and no API key, starting at $0.02 a call.
        </p>
      </div>
    </>
  )
}
