import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import Footer from '@/components/Footer'

// Public developer quickstart — the "how an app adds this" page. Server-
// rendered, no data dependencies; copy follows the brand voice (dry, precise,
// one wink max) on the site's existing dark design system.

export const metadata: Metadata = {
  title: 'Developers — give your agent an expense account · Yeetful',
  description:
    'Spend-controlled x402 payments for AI agents: an allowlist + per-call/per-day budget enforced before any payment is signed, with a receipt for every decision.',
}

const SNIPPET = `import { yeetful } from 'yeetful/agent'

const pay = yeetful({
  wallet, // a viem WalletClient (small funded burner)
  grant: {
    id: 'your-grant-id', // from yeetful.com/dashboard
    allow: ['tripadvisor.x402.paysponge.com'],
    perCallUsd: 0.05,
    perDayUsd: 5,
  },
  apiKey: process.env.YEETFUL_API_KEY, // yf_… — receipts sync to your dashboard
})

// 402 challenge → grant check → USDC payment signed → 200 + receipt
const res = await pay(
  'https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo',
)`

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

export default function DevelopersPage() {
  return (
    <>
      <main className="x-main">
        <div className="svc">
          {/* ── Hero ── */}
          <span className="hero__eyebrow mono">FOR THE PEOPLE BUILDING AGENTS</span>
          <h1 className="hero__h1 hero__h1--sm">
            Give your agent an <em className="hero__em">expense account.</em>
          </h1>
          <p className="hero__sub">
            An allowlist plus per-call and per-day budgets, enforced before any x402 payment is
            signed. A receipt for every decision — settlements and refusals alike. Your agent
            pays for what it uses and can&apos;t spend what you didn&apos;t approve.
          </p>

          {/* ── Quickstart ── */}
          <div className="svc__section">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">Quickstart</h2>
            </div>
            <ol className="dev__steps">
              <li>
                <span className="mono dev__stepnum">01</span> Install the SDK:{' '}
                <code className="mono dev__code">npm install yeetful</code>
              </li>
              <li>
                <span className="mono dev__stepnum">02</span> On your{' '}
                <Link href="/dashboard" className="dev__link">
                  dashboard
                </Link>
                , approve the agents you trust and mint an API key. The secret shows once —
                that&apos;s the point.
              </li>
              <li>
                <span className="mono dev__stepnum">03</span> Wrap your agent&apos;s fetch:
              </li>
            </ol>
            <pre className="dev__snippet mono">{SNIPPET}</pre>
            <p className="dev__after mono">
              throws GrantError(&apos;NOT_ALLOWED&apos; | &apos;OVER_PER_CALL&apos; |
              &apos;BUDGET_EXCEEDED&apos; | &apos;EXPIRED&apos; | &apos;REVOKED&apos;) — denied
              before any network I/O.
            </p>
          </div>

          {/* ── API reference ── */}
          <div className="svc__section">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">Grants API</h2>
              <span className="svc__count mono">Bearer or session auth</span>
            </div>
            <p className="dev__note">
              Every route accepts your browser session (SIWE) or{' '}
              <code className="mono dev__code">Authorization: Bearer yf_…</code> — the key you
              minted. Keys authenticate as your wallet; grants stay owner-scoped either way.
            </p>
            <ul className="eps">
              {GRANT_ROUTES.map((r) => (
                <li key={`${r.method}-${r.path}`} className="ep">
                  <div className="ep__line">
                    <span className={`ep__method mono ep__method--${r.method.toLowerCase()}`}>
                      {r.method}
                    </span>
                    <span className="ep__path mono">{r.path}</span>
                  </div>
                  <p className="ep__desc">{r.what}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Ledger sync body ── */}
          <div className="svc__section">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">Receipt sync</h2>
              <span className="svc__count mono">POST /api/grants/:id/ledger</span>
            </div>
            <p className="dev__note">
              The SDK&apos;s <code className="mono dev__code">onReceipt</code> seam posts here
              automatically when you pass <code className="mono dev__code">apiKey</code>. Body
              fields, if you&apos;d rather wire it yourself:
            </p>
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
          </div>

          {/* ── Links ── */}
          <div className="svc__section">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">The rest of the stack</h2>
            </div>
            <div className="dev__links">
              <a
                className="dev__biglink"
                href="https://www.npmjs.com/package/yeetful"
                target="_blank"
                rel="noopener noreferrer"
              >
                yeetful on npm <ArrowUpRight width={14} height={14} />
                <span>x402 client/server helpers + the agent wrapper</span>
              </a>
              <a
                className="dev__biglink"
                href="https://github.com/Yeetful/example-agent"
                target="_blank"
                rel="noopener noreferrer"
              >
                example-agent <ArrowUpRight width={14} height={14} />
                <span>the whole integration in ~40 lines — free demo mode</span>
              </a>
              <a
                className="dev__biglink"
                href="https://github.com/Yeetful/demo"
                target="_blank"
                rel="noopener noreferrer"
              >
                travel-agent demo <ArrowUpRight width={14} height={14} />
                <span>a full agent that researches a trip and pays its own way</span>
              </a>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
