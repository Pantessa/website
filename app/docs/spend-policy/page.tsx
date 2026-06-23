import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'spend-policy')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function SpendPolicyPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> THE SPEND-POLICY SWITCH
      </p>
      <h1 className="docs__h1">The spend-policy switch</h1>
      <p className="docs__lead">
        One master switch sits above every cap on your account. <strong>Off</strong>, your agent can
        reach any MCP with no limits — the no-friction way to try things. <strong>On</strong>, your{' '}
        <Link href="/docs/expense-account">spend grant</Link> takes over: only approved hosts, only
        within your per-call and per-day USDC budgets.
      </p>

      <div className="docs__prose">
        <h2>Why it&apos;s off by default</h2>
        <p>
          New accounts start with the policy <strong>off</strong>. The point is to never block a
          brand-new agent on its very first call: you can wire up the SDK, run a chat, and see real
          routing before you&apos;ve decided what to allow. Spend is still metered and receipted —
          it just isn&apos;t <em>refused</em>.
        </p>

        <h2>When to turn it on</h2>
        <p>
          Flip it <strong>on</strong> once you&apos;ve curated your account: turn on the agents you
          trust in <Link href="/dashboard/approvals">Approvals</Link>, set a daily budget you&apos;re
          comfortable with, and the switch starts enforcing both. From then on, anything outside the
          allowlist or over a cap is refused with a typed{' '}
          <Link href="/docs/expense-account">
            <code>GrantError</code>
          </Link>
          .
        </p>

        <h2>Toggling is non-destructive</h2>
        <p>
          The switch never touches your per-agent approvals. Turn the policy off to unblock a quick
          experiment, then back on, and your curated allowlist is exactly where you left it — it was
          dormant, not deleted. The switch flips a single flag; your configuration is preserved.
        </p>

        <h2>Where it&apos;s enforced</h2>
        <p>There are two payment paths, and the switch reaches them differently:</p>
        <ul>
          <li>
            <strong>Chats Yeetful runs</strong> — hard-enforced. The payment is refused server-side,
            before the call settles, and the denial is ledgered. Instant.
          </li>
          <li>
            <strong>External SDK agents</strong> — advisory. Your agent pays from its own wallet, so
            Yeetful can&apos;t intercept the transfer; instead the policy is published on{' '}
            <code>GET /api/agent/policy</code> and the <Link href="/docs/agents">SDK</Link> refuses
            locally on its next policy check. The hard, on-chain stop is a Coinbase Spend Permission
            (coming to the dashboard&apos;s &ldquo;Back on-chain&rdquo;).
          </li>
        </ul>

        <h2>Toggle it</h2>
        <p>
          The switch lives on your <Link href="/dashboard">dashboard Overview</Link>, above the
          budget meter. It&apos;s distinct from the{' '}
          <Link href="/docs/agents">freeze / kill switch</Link>: the spend policy decides{' '}
          <em>whether caps apply at all</em>; freeze is the emergency stop that refuses{' '}
          <em>every</em> payment regardless.
        </p>
      </div>
    </>
  )
}
