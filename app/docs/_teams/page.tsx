import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'teams')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function TeamsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> TEAMS &amp; ORGANIZATIONS
      </p>
      <h1 className="docs__h1">Teams &amp; organizations</h1>
      <p className="docs__lead">
        An organization is a <strong>shared expense account</strong>: one roof for your team&apos;s
        agent keys, approvals, budgets, and ledger. Members come and go by wallet address, every
        receipt is attributed to the agent that paid, and a single org-level cap sits above each
        agent&apos;s own budget.
      </p>

      <div className="docs__prose">
        <h2>Members, roles, and the invite that isn&apos;t an email</h2>
        <p>
          Create an org from the dashboard&apos;s scope switcher and you become its{' '}
          <strong>owner</strong>. Adding a teammate is just adding their{' '}
          <strong>wallet address</strong> — that <em>is</em> the invite. There&apos;s no email, no
          pending state, no signup link: membership takes effect the next time that wallet signs
          in with SIWE.
        </p>
        <p>Three roles, checked server-side on every call:</p>
        <ul>
          <li>
            <strong>member</strong> — sees everything: members, agents, approvals, the ledger, the
            report.
          </li>
          <li>
            <strong>admin</strong> — manages the spending surface: mints and revokes org keys,
            toggles approvals, sets budgets, renames the org, invites members.
          </li>
          <li>
            <strong>owner</strong> — exactly one per org: changes roles, transfers ownership
            (atomic — the old owner steps down to admin in the same transaction), deletes the org.
          </li>
        </ul>
        <p>
          One rule has no exceptions: <strong>org management is SIWE-only</strong>. A{' '}
          <code>yf_…</code> Bearer key can never add members, change roles, or edit the org policy
          it spends under — the same trust split as{' '}
          <Link href="/docs/agents">an agent not being able to raise its own budget</Link>.
        </p>

        <h2>Org keys — the org&apos;s agents, not anyone&apos;s</h2>
        <p>
          Keys minted in org scope (admin+) belong to the <em>organization</em>: any admin can
          manage them, every receipt they sync is attributed to the org&apos;s ledger, and they
          draw on the <strong>org&apos;s</strong> grant and approvals — not their minter&apos;s
          personal ones. An org key can&apos;t even sync a receipt into its minter&apos;s personal
          account; attribution can&apos;t lie.
        </p>

        <h2>The two-level budget</h2>
        <p>
          Each agent key keeps its own per-day budget, and the org adds a level above it: a{' '}
          <strong>daily USD cap across all of the org&apos;s keys</strong>, set in Org settings
          (admin+). The SDK&apos;s pre-flight returns both levels — over <em>either</em> means stop
          paying:
        </p>
        <pre>
          <code>{`GET /api/agent/policy
Authorization: Bearer yf_…   // an ORG key

{
  "org": {
    "id": "cmq…",
    "name": "Acme Robotics",
    "perDayUsd": 25,           // the org cap; null = per-key budgets alone govern
    "spentTodayUsd": 7.43,     // summed across ALL the org's keys
    "remainingTodayUsd": 17.57,
    "overBudget": false
  },
  "agent": { … },              // this key's own budget, as on /docs/agents
  "grant": { … }               // the ORG's grant — its allowlist + caps
}`}</code>
        </pre>
        <p>
          Receipt syncs echo the same <code>org</code> block, so a busy agent learns it crossed
          the org cap on the very next settlement it reports.
        </p>
        <p>
          The honesty clause from <Link href="/docs/agents">Agents &amp; budgets</Link> applies
          doubly here: org caps are enforced by the <strong>SDK</strong>, which reads this policy
          and refuses locally. They&apos;re advisory at the rails — the agent pays from its own
          wallet, so Yeetful can&apos;t block it on-chain. Hard enforcement arrives with Coinbase
          Spend Permissions, where the on-chain allowance is the cap.
        </p>

        <h2>The expense report</h2>
        <p>
          <code>GET /api/orgs/[id]/report?from&amp;to</code> (any member) returns totals plus three
          breakdowns — <strong>by agent</strong>, <strong>by member</strong>, and{' '}
          <strong>by service</strong> — and the Organization page renders it with a CSV download.
          Attribution is key-based and honest: &quot;by agent&quot; is ground truth (every
          Bearer-synced row carries its key), &quot;by member&quot; maps each agent to the wallet
          that minted it, and rows synced without a key land in an <code>unattributed</code>{' '}
          bucket instead of being guessed.
        </p>

        <h2>Personal scope is untouched</h2>
        <p>
          Everything you had before orgs — your wallet&apos;s keys, grant, approvals, ledger — is
          the <strong>Personal</strong> scope in the dashboard switcher, and org rows never leak
          into it. The same APIs serve both: pass <code>?org=&lt;id&gt;</code> (or{' '}
          <code>orgId</code> in write bodies) and the server re-checks your membership on every
          single call.
        </p>

        <p>
          <strong>Next:</strong> give each connected app its own allowance on{' '}
          <Link href="/docs/agents">Agents &amp; budgets</Link>, or wire receipts into the
          dashboard with <Link href="/docs/ledger-sync">ledger sync</Link>.
        </p>
      </div>
    </>
  )
}
