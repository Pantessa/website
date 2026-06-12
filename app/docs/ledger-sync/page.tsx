import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'ledger-sync')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function LedgerSyncPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> DASHBOARD LEDGER SYNC
      </p>
      <h1 className="docs__h1">Dashboard ledger sync</h1>
      <p className="docs__lead">
        With an API key and a hosted grant id, every receipt your agent emits — settlements{' '}
        <strong>and</strong> denials — POSTs to your yeetful.com ledger. Budgets, charts, and the
        audit feed on the <Link href="/dashboard">dashboard</Link> then include headless agents,
        not just chat.
      </p>

      <div className="docs__prose">
        <h2>1. Mint a key, copy your grant id</h2>
        <p>
          Sign in at <Link href="/dashboard/keys">yeetful.com/dashboard/keys</Link> and mint a
          key. The <code>yf_…</code> secret is shown <strong>once</strong>. The same page shows
          your expense account&apos;s grant id (<code>YEETFUL_GRANT_ID</code>) with a one-click
          copy.
        </p>
        <pre>
          <code>{`# .env — never commit this file
YEETFUL_API_KEY=yf_…
YEETFUL_GRANT_ID=cmq…`}</code>
        </pre>

        <h2>2. Pass both to yeetful()</h2>
        <pre>
          <code>{`const pay = yeetful({
  wallet,
  grant: {
    id: process.env.YEETFUL_GRANT_ID, // the hosted grant this mirrors
    allow: ['tripadvisor.x402.paysponge.com'],
    perCallUsd: 0.05,
    perDayUsd: 2,
  },
  apiKey: process.env.YEETFUL_API_KEY,
})

// … paid calls …

await pay.flushLedger() // drain pending syncs before a short-lived script exits`}</code>
        </pre>
        <p>
          Sync is an ordered, best-effort chain: it never blocks and never fails a payment. A
          denial syncs too, as <code>ok: false</code> with the violation code — the dashboard&apos;s
          &quot;blocked by policy&quot; numbers come from exactly these rows.
        </p>

        <h2>Gotchas we hit so you don&apos;t</h2>
        <ul>
          <li>
            <strong>Use the canonical origin.</strong> <code>fetch</code> silently drops the{' '}
            <code>Authorization</code> header when it follows a cross-origin redirect (e.g. apex →
            www). If every sync logs a 401 with a valid key, point <code>ledgerUrl</code> at the
            origin that doesn&apos;t redirect. Since 0.3.2 the failure log names the redirect
            origin outright.
          </li>
          <li>
            <strong>Paste the full secret, not the prefix.</strong> Keys are <code>yf_</code> +
            64 hex characters; the key list shows only a display prefix (<code>yf_ab12cd34</code>)
            — the full secret exists only in the mint-time reveal.
          </li>
          <li>
            <strong>Key and grant must share a wallet.</strong> The ledger route is owner-scoped:
            a key from one wallet posting to another wallet&apos;s grant gets a 404 by design.
          </li>
          <li>
            <strong>Enforcement stays local.</strong> The hosted grant id is the sync{' '}
            <em>target</em> — the allowlist and caps your agent enforces are the ones in code.
            Dashboard approval toggles gate chat payments on yeetful.com, not your SDK calls.
          </li>
        </ul>

        <h2>What lands on the dashboard</h2>
        <p>
          Each receipt becomes a ledger row: host, service, amount, settlement tx hash (linked to
          Basescan), and the decision. The <Link href="/activity">public network feed</Link>{' '}
          shows the anonymized settled side; your dashboard shows everything, including refusals.
        </p>
      </div>
    </>
  )
}
