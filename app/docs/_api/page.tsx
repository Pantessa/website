import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The REST reference, migrated from the old /developers page so nothing is lost
// when that route folds into /docs. The policy endpoint's full sample response
// lives on /docs/agents; this page is the route + field catalogue.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'api')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

const GRANT_ROUTES = [
  { method: 'GET', path: '/api/grants', what: 'List your grants with spend totals' },
  { method: 'POST', path: '/api/grants', what: 'Create a grant (allowlist + caps + expiry)' },
  { method: 'GET', path: '/api/grants/:id', what: 'One grant + recent ledger + budget status' },
  { method: 'PATCH', path: '/api/grants/:id', what: 'Adjust caps/label, revoke or reactivate' },
  { method: 'DELETE', path: '/api/grants/:id', what: 'Delete a grant (ledger cascades)' },
  { method: 'GET', path: '/api/grants/:id/signature', what: 'EIP-712 payload to wallet-sign the terms' },
  { method: 'PUT', path: '/api/grants/:id/signature', what: 'Attach the signature (server-verified)' },
  { method: 'POST', path: '/api/grants/:id/ledger', what: 'Sync a receipt into the hosted ledger' },
]

const LEDGER_FIELDS = [
  { field: 'host', type: 'string', what: 'Hostname or full URL of the paid endpoint (required)' },
  { field: 'amountUsd', type: 'number', what: 'USD settled — 0 for denials (required)' },
  { field: 'ok', type: 'boolean', what: 'true = settled, false = denied/failed (default true)' },
  { field: 'txHash', type: 'string', what: 'Base settlement transaction, when settled' },
  { field: 'serviceName', type: 'string', what: 'Display name for the dashboard charts' },
  { field: 'note', type: 'string', what: '"settled", a violation code, or your own marker' },
]

const POLICY_SNIPPET = `GET /api/agent/policy
Authorization: Bearer yf_…

{
  "agent": {
    "keyId": "cmq…", "label": "travel-agent",
    "perDayUsd": 5, "spentTodayUsd": 1.23,
    "remainingTodayUsd": 3.77, "overBudget": false
  },
  "grant": { "allow": […], "perCallUsd": 0.05, … }
}`

export default function GrantsApiPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> GRANTS &amp; POLICY API
      </p>
      <h1 className="docs__h1">Grants &amp; policy API</h1>
      <p className="docs__lead">
        The REST surface behind the SDK. Every route accepts your browser session (SIWE) or{' '}
        <code>Authorization: Bearer yf_…</code> — the key you minted at{' '}
        <Link href="/dashboard/keys">dashboard/keys</Link>. Keys authenticate as your wallet; grants
        stay owner-scoped either way.
      </p>

      <div className="docs__prose">
        <h2>Grants</h2>
        <p>
          A grant is your agent&apos;s <Link href="/docs/expense-account">expense account</Link> —
          an allowlist plus per-call/per-day/lifetime caps. CRUD it here, sign the terms with your
          wallet (EIP-712), and sync receipts into the hosted ledger.
        </p>
      </div>

      <ul className="eps">
        {GRANT_ROUTES.map((r) => (
          <li key={`${r.method}-${r.path}`} className="ep">
            <div className="ep__line">
              <span className={`ep__method mono ep__method--${r.method.toLowerCase()}`}>{r.method}</span>
              <span className="ep__path mono">{r.path}</span>
            </div>
            <p className="ep__desc">{r.what}</p>
          </li>
        ))}
      </ul>

      <div className="docs__prose">
        <h2>The pre-flight: GET /api/agent/policy</h2>
        <p>
          One Bearer-only endpoint answers the SDK&apos;s standing question — &quot;may I still pay,
          and how much?&quot; — with the key&apos;s budget and the owner&apos;s grant in a single
          response. The SDK loads it at startup and refuses with{' '}
          <code>GrantError(&apos;OVER_AGENT_BUDGET&apos;)</code> once the key is over budget.
        </p>
        <pre>
          <code>{POLICY_SNIPPET}</code>
        </pre>
        <p>
          The full response shape, the kill-switch <code>halted</code>/<code>haltReason</code>{' '}
          fields, and how budgets are enforced live on{' '}
          <Link href="/docs/agents">Agents &amp; budgets</Link>.
        </p>

        <h2>Receipt sync body</h2>
        <p>
          The SDK&apos;s <code>onReceipt</code> seam POSTs to{' '}
          <code>/api/grants/:id/ledger</code> automatically when you pass <code>apiKey</code> (see{' '}
          <Link href="/docs/ledger-sync">ledger sync</Link>). The body fields, if you&apos;d rather
          wire it yourself:
        </p>
      </div>

      <ul className="eps">
        {LEDGER_FIELDS.map((f) => (
          <li key={f.field} className="ep">
            <div className="ep__line">
              <span className="ep__paramname mono">{f.field}</span>
              <span className="ep__paramtype mono">{f.type}</span>
            </div>
            <p className="ep__desc">{f.what}</p>
          </li>
        ))}
      </ul>
    </>
  )
}