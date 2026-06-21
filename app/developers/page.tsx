import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import Footer from '@/components/Footer'

// Public developer quickstart — the "how an app adds this" page. Server-
// rendered, no data dependencies; copy follows the brand voice (dry, precise,
// one wink max) on the site's existing dark design system.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeetful.com'
const TITLE = 'Developers — give your agent an expense account · Yeetful'
const DESCRIPTION =
  'Connect an agent in 3 steps: mint a key, wire the yeetful SDK, set its daily budget. Allowlist + caps enforced before any x402 payment is signed.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE}/developers` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE}/developers`, type: 'website' },
}

const SNIPPET = `import { yeetful } from 'yeetful/agent'

const pay = yeetful({
  wallet, // a viem WalletClient (small funded burner)
  grant: {
    id: 'your-grant-id', // from yeetful.com/dashboard/keys
    allow: ['tripadvisor.x402.paysponge.com'],
    perCallUsd: 0.05,
    perDayUsd: 5,
  },
  apiKey: process.env.YEETFUL_API_KEY, // yf_… — this key IS the agent
  ledgerUrl: 'https://www.yeetful.com', // receipts + denials land on your dashboard
})

// 402 challenge → grant check → USDC payment signed → 200 + receipt
const res = await pay(
  'https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo',
)`

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
          <div className="hero__ctas">
            <Link href="/dashboard/keys" className="btn btn--solid">
              Mint a key
            </Link>
            <a href="#connect" className="btn btn--ghost">
              Connect an agent
            </a>
          </div>

          {/* ── Connect an agent — the 3-step funnel the hero CTA lands on ── */}
          <div className="svc__section" id="connect">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">Connect an agent</h2>
              <span className="svc__count mono">3 steps</span>
            </div>
            <ol className="dev__steps">
              <li>
                <span className="mono dev__stepnum">01</span> Mint a key at{' '}
                <Link href="/dashboard/keys" className="dev__link">
                  /dashboard/keys
                </Link>
                . The key <em>is</em> the agent — its identity, its ledger attribution, and the
                thing you revoke. The <code className="mono dev__code">yf_…</code>{' '}secret shows
                once; that&apos;s the point.
              </li>
              <li>
                <span className="mono dev__stepnum">02</span>{' '}
                <code className="mono dev__code">npm install yeetful</code>, then wire it around
                your agent&apos;s paid calls — wallet, grant, key, and the ledger receipts land
                on:
              </li>
            </ol>
            <pre className="dev__snippet mono">{SNIPPET}</pre>
            <ol className="dev__steps" start={3}>
              <li>
                <span className="mono dev__stepnum">03</span> Set its budget at{' '}
                <Link href="/dashboard/agents" className="dev__link">
                  /dashboard/agents
                </Link>{' '}
                — a per-day USD cap with a spent-today meter — and toggle the services money may
                flow to under{' '}
                <Link href="/dashboard/approvals" className="dev__link">
                  approvals
                </Link>
                .
              </li>
            </ol>
            <p className="dev__after mono">
              throws GrantError(&apos;NOT_ALLOWED&apos; | &apos;OVER_PER_CALL&apos; |
              &apos;BUDGET_EXCEEDED&apos; | &apos;EXPIRED&apos; | &apos;REVOKED&apos;) — denied
              before any network I/O.
            </p>
            <div className="dev__links">
              <a className="dev__biglink" href="/switchboard">
                /switchboard <ArrowUpRight width={14} height={14} />
                <span>watch the router pick the best-priced MCP, live</span>
              </a>
              <a className="dev__biglink" href="/docs/quickstart">
                /docs/quickstart <ArrowUpRight width={14} height={14} />
                <span>install → grant → first paid call, ~20 lines</span>
              </a>
              <a className="dev__biglink" href="/docs/agents">
                /docs/agents <ArrowUpRight width={14} height={14} />
                <span>budgets, the policy endpoint, and the agent model</span>
              </a>
              <a className="dev__biglink" href="/docs/claude-code">
                /docs/claude-code <ArrowUpRight width={14} height={14} />
                <span>or paste one prompt and let Claude wire it</span>
              </a>
            </div>
          </div>

          {/* ── Policy endpoint callout ── */}
          <div className="svc__section">
            <div className="svc__sectionhead">
              <h2 className="svc__h2">The agent&apos;s standing orders</h2>
              <span className="svc__count mono">GET /api/agent/policy</span>
            </div>
            <p className="dev__note">
              One Bearer-only endpoint answers the SDK&apos;s pre-flight question — &quot;may I
              still pay, and how much?&quot; — with the key&apos;s budget and the owner&apos;s
              grant in a single response:
            </p>
            <pre className="dev__snippet mono">{POLICY_SNIPPET}</pre>
            <p className="dev__note">
              SDK 0.4 (merged, not yet on npm) fetches this at startup, refuses with{' '}
              <code className="mono dev__code">GrantError(&apos;OVER_AGENT_BUDGET&apos;)</code>{' '}
              once the key is over budget, and keeps the snapshot fresh from every receipt-sync
              response. Budgets are enforced by the SDK — the agent pays from its own wallet, so
              the rails can&apos;t block it; hard enforcement arrives with Coinbase Spend
              Permissions. See{' '}
              <Link href="/docs/agents" className="dev__link">
                Agents &amp; budgets
              </Link>
              .
            </p>
          </div>

          {/* What you can do */}
          <div className="explain__steps dev__caps">
            <div className="step">
              <span className="step__n mono">SPEND CONTROL</span>
              <h3 className="step__t">Budgets your agent can&apos;t exceed</h3>
              <p className="step__d">
                Allowlist + per-call and per-day caps, checked before any payment is signed.
                Runaway loops and injected tool calls hit the wall, not your wallet.
              </p>
            </div>
            <div className="step">
              <span className="step__n mono">RECEIPTS EVERYWHERE</span>
              <h3 className="step__t">Every decision, ledgered</h3>
              <p className="step__d">
                Settlements and refusals land in your dashboard — charts, budgets, and Basescan
                links per call. Headless agents sync via API key.
              </p>
            </div>
            <div className="step">
              <span className="step__n mono">SIGNED GRANTS</span>
              <h3 className="step__t">Terms your wallet attested</h3>
              <p className="step__d">
                EIP-712-sign your grant so the authorization is portable — the precursor to
                on-chain spend permissions. Change the terms, re-sign, done.
              </p>
            </div>
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
              <a className="dev__biglink" href="/docs">
                the docs <ArrowUpRight width={14} height={14} />
                <span>quickstart, spend grants, ledger sync, x402, Claude Code onboarding</span>
              </a>
              <a
                className="dev__biglink"
                href="https://github.com/Yeetful"
                target="_blank"
                rel="noopener noreferrer"
              >
                Yeetful on GitHub <ArrowUpRight width={14} height={14} />
                <span>the SDK, example agent, demos, and the rest — open source</span>
              </a>
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
