import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'agents')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function AgentsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> AGENTS &amp; BUDGETS
      </p>
      <h1 className="docs__h1">Agents &amp; budgets</h1>
      <p className="docs__lead">
        Your spend controls have two sides. <strong>Approvals</strong> decide which{' '}
        <em>services</em>{' '}money may flow to — the per-service toggles that shape your grant&apos;s
        allowlist. <strong>Agents</strong> decide which <em>apps</em> may spend on your behalf —
        and on Yeetful, an agent <strong>is</strong> an API key.
      </p>

      <div className="docs__prose">
        <h2>An agent is an API key</h2>
        <p>
          Anything paying through the <code>yeetful</code> SDK authenticates with a{' '}
          <code>yf_…</code> key minted at{' '}
          <Link href="/dashboard/keys">yeetful.com/dashboard/keys</Link>. That key is the agent&apos;s
          identity: every receipt it syncs is attributed to it in the ledger, and the{' '}
          <Link href="/dashboard/agents">Agents tab</Link> shows each key with a spent-today meter
          built from exactly those rows. One app, one key — revoke the key and the agent is
          disconnected.
        </p>

        <h2>Per-day budgets — and who can change them</h2>
        <p>
          Each key takes an optional <strong>per-day USD budget</strong>, set on the{' '}
          <Link href="/dashboard/agents">Agents tab</Link>. Budgets are edited with{' '}
          <code>PATCH /api/keys/[id]</code>, which is <strong>SIWE-session-only</strong> — the
          same gate as minting. The Bearer key itself is deliberately not accepted there: an agent
          must never be able to raise its own budget with the key it holds.
        </p>

        <h2>The pre-flight: GET /api/agent/policy</h2>
        <p>
          The SDK&apos;s standing question — &quot;may I still pay, and how much?&quot; — has one
          endpoint. It is <strong>Bearer-only</strong> (the agent asks with its own key; there is
          no browser surface) and returns both sides of the policy: the key&apos;s budget and the
          owner&apos;s active grant.
        </p>
        <pre>
          <code>{`GET /api/agent/policy
Authorization: Bearer yf_…

{
  "agent": {
    "keyId": "cmq…",
    "label": "travel-agent",
    "perDayUsd": 5,            // null = no daily budget
    "spentTodayUsd": 1.23,
    "remainingTodayUsd": 3.77, // null when perDayUsd is null
    "overBudget": false
  },
  "grant": {                   // null if the owner has no active grant
    "id": "cmq…",
    "label": "Expense account",
    "allow": ["tripadvisor.x402.paysponge.com"],
    "perCallUsd": 0.05,
    "perDayUsd": 5,
    "totalUsd": null,
    "spentTodayUsd": 1.23,
    "spentTotalUsd": 9.41,
    "expiresAt": "2026-07-12T00:00:00.000Z",
    "signed": true
  }
}`}</code>
        </pre>

        <h2>The echo: budgets ride along on every receipt sync</h2>
        <p>
          The SDK doesn&apos;t poll. When it{' '}
          <Link href="/docs/ledger-sync">syncs a receipt</Link> with a Bearer key, the response
          carries a slim <code>agent</code>{' '}echo — the updated budget after that very row landed —
          so the agent&apos;s local picture stays fresh for free:
        </p>
        <pre>
          <code>{`POST /api/grants/[id]/ledger   →  201
{
  …ledger entry…,
  "agent": { "perDayUsd": 5, "spentTodayUsd": 1.24, "overBudget": false }
}`}</code>
        </pre>

        <h2>What the SDK does with it</h2>
        <p>
          <em>
            The snippet below is SDK <strong>0.4</strong> — merged, not yet on npm (which has
            0.3.1). Until it&apos;s published, budgets show on the dashboard but the SDK won&apos;t
            enforce them.
          </em>
        </p>
        <pre>
          <code>{`const pay = yeetful({ wallet, grant: { id: 'your-grant-id', /* … */ }, apiKey: process.env.YEETFUL_API_KEY })

pay.agentBudget() // { keyId, label, perDayUsd, spentTodayUsd, remainingTodayUsd, overBudget }

// Over budget — or a call whose quoted price exceeds remainingTodayUsd —
// throws GrantError('OVER_AGENT_BUDGET') BEFORE any payment is signed,
// and the denial receipt syncs, so the refusal shows in your audit feed.`}</code>
        </pre>
        <p>
          0.4 fetches the policy once at startup (a failed fetch degrades open — payments proceed
          under the grant alone), refreshes from the <code>agent</code> echo on every sync, and
          re-fetches on <code>flushLedger()</code> so mid-run dashboard edits get picked up.
        </p>

        <h2>Where enforcement actually lives</h2>
        <p>
          Budgets are <strong>advisory at the rails</strong>: the agent pays x402 challenges from
          its <em>own wallet</em>, so Yeetful cannot block a payment in flight. The SDK is the
          enforcement point — it reads the policy and refuses locally, the same trust model as the
          grant itself. That&apos;s the right tool for governing <em>your own</em> agents (runaway
          loops, bugs, prompt-injected tool calls). Hard, adversarial enforcement arrives with
          Coinbase Spend Permissions, where an on-chain allowance caps spend regardless of what
          the SDK does.
        </p>

        <h2>Approvals vs. agents, side by side</h2>
        <ul>
          <li>
            <strong>Approvals</strong> (<Link href="/dashboard">dashboard</Link>): per-service
            toggles. They re-derive your grant&apos;s <code>allow[]</code> — which hosts money may
            flow <em>to</em>. Off by default.
          </li>
          <li>
            <strong>Agents</strong> (<Link href="/dashboard/agents">dashboard/agents</Link>):
            per-key budgets. Which apps may spend <em>for you</em>, and how much per day.
          </li>
        </ul>
        <p>
          Both feed the same <Link href="/docs/ledger-sync">hosted ledger</Link>; together they
          answer &quot;who spent what, where, and was it allowed?&quot; for every call your agents
          make.
        </p>
        <p>
          Working with a team? <Link href="/docs/teams">Organizations</Link> put shared agent
          keys, approvals, and an org-level daily cap above these per-key budgets — one expense
          account for the whole company.
        </p>
      </div>
    </>
  )
}
