import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl, readyPages } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === '')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl('') },
  openGraph: {
    title: PAGE.seoTitle,
    description: PAGE.description,
    url: docsUrl(''),
    type: 'website',
  },
}

export default function DocsIndexPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }}
      />
      <p className="docs__crumbs mono">DOCS</p>
      <h1 className="docs__h1">Give your agent an expense account</h1>
      <p className="docs__lead">
        Yeetful is spend-controlled <a href="https://www.x402.org">x402</a> for AI agents: an
        allowlist of hosts plus per-call and per-day USDC budgets, enforced locally{' '}
        <strong>before</strong> any payment is signed — with a receipt for every decision,
        settlements and refusals alike. No API keys to the services you call; pay per call in
        USDC on Base.
      </p>

      <div className="docs__prose">
        <h2>The five-line version</h2>
        <pre>
          <code>{`import { yeetful } from 'yeetful/agent'

const pay = yeetful({
  wallet, // a viem WalletClient (works with CDP wallets too)
  grant: { allow: ['tripadvisor.x402.paysponge.com'], perCallUsd: 0.05, perDayUsd: 2 },
})

const res = await pay('https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo')`}</code>
        </pre>
        <p>
          <code>pay()</code> is a drop-in <code>fetch</code>: free endpoints pass through
          (allowlist-checked, receipted at $0), 402 challenges are paid automatically — protocol
          v1 and v2 alike — and anything off-policy throws a typed <code>GrantError</code> before
          a single byte of payment is signed.
        </p>
      </div>

      <div className="docs__cards">
        {readyPages()
          .filter((p) => p.slug !== '')
          .map((p) => (
            <Link key={p.slug} href={`/docs/${p.slug}`} className="docs__card">
              <span className="docs__cardtitle">{p.title}</span>
              <span className="docs__carddesc">{p.description}</span>
            </Link>
          ))}
      </div>

      <div className="docs__prose">
        <h2>Elsewhere</h2>
        <ul>
          <li>
            <a href="https://www.npmjs.com/package/yeetful">yeetful on npm</a> — MIT, TypeScript,
            client + server helpers included
          </li>
          <li>
            <a href="https://github.com/Yeetful/example-agent">Yeetful/example-agent</a> — the
            smallest runnable integration (free demo mode by default)
          </li>
          <li>
            <Link href="/activity">Network activity</Link> — every settled call on the network,
            anonymized and on-chain verifiable
          </li>
        </ul>
      </div>
    </>
  )
}
