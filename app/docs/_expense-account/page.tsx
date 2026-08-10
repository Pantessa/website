import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'expense-account')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function ExpenseAccountPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> THE EXPENSE ACCOUNT
      </p>
      <h1 className="docs__h1">The expense account</h1>
      <p className="docs__lead">
        A spend grant is policy, not custody: an allowlist of hosts plus USD caps, enforced
        in-process <strong>before</strong>{' '}any payment is signed. It&apos;s the guardrail against
        runaway loops, bugs, and prompt-injected tool calls — one grant authorizes many
        endpoints.
      </p>

      <div className="docs__prose">
        <h2>The grant</h2>
        <pre>
          <code>{`grant: {
  id: 'cmq…',                // optional: a pantessa.com grant this mirrors (enables ledger sync)
  allow: ['tripadvisor.x402.paysponge.com'], // exact hostnames this agent may pay
  perCallUsd: 0.05,          // max for any single call
  perDayUsd: 2,              // rolling UTC-day budget
  totalUsd: 25,              // optional lifetime cap for this client instance
  expiresAt: '2026-12-31',   // Date, ISO string, or unix ms — omit for no expiry
  status: 'active',          // 'revoked' refuses everything
}`}</code>
        </pre>
        <p>
          Checks run in order — status, expiry, allowlist before any network I/O; the price caps
          when the 402 challenge reveals what the call costs — and the first violation throws a
          typed <code>GrantError</code>:
        </p>
        <table>
          <thead>
            <tr>
              <th>
                <code>GrantError.code</code>
              </th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>NOT_ALLOWED</code>
              </td>
              <td>Host isn&apos;t on the allowlist (denied before any network I/O)</td>
            </tr>
            <tr>
              <td>
                <code>OVER_PER_CALL</code>
              </td>
              <td>The challenge priced this single call above <code>perCallUsd</code></td>
            </tr>
            <tr>
              <td>
                <code>BUDGET_EXCEEDED</code>
              </td>
              <td>Today&apos;s (or the lifetime) budget would be passed</td>
            </tr>
            <tr>
              <td>
                <code>EXPIRED</code>
              </td>
              <td>The grant&apos;s <code>expiresAt</code> is in the past</td>
            </tr>
            <tr>
              <td>
                <code>REVOKED</code>
              </td>
              <td>
                <code>status: &apos;revoked&apos;</code>
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Receipts — the audit trail</h2>
        <p>
          Every decision emits a <code>Receipt</code>, refusals included. That&apos;s deliberate:
          an audit trail that only shows successes isn&apos;t one.
        </p>
        <pre>
          <code>{`onReceipt: (r) => {
  // { host, amountUsd, ok, txHash?, note, ts }
  // note: 'settled' on success, or the GrantViolation code on a denial
}`}</code>
        </pre>
        <p>
          Settlement transaction hashes come from the x402 settle header and are verifiable on{' '}
          <a href="https://basescan.org" rel="noopener noreferrer" target="_blank">
            Basescan
          </a>
          . Live totals are always available on the client: <code>pay.spentTodayUsd()</code>,{' '}
          <code>pay.remainingTodayUsd()</code>, <code>pay.spentTotalUsd()</code>.
        </p>

        <h2>Local vs. hard enforcement</h2>
        <p>
          The SDK enforces the grant in-process — instant, free, and ideal for governing{' '}
          <em>your own</em> agents. It is not an adversarial guarantee: code that bypasses{' '}
          <code>pay()</code> bypasses the grant. For hard guarantees, back the grant with an
          on-chain Coinbase Spend Permission so the wallet contract caps spend no matter what the
          process does. The <Link href="/dashboard">pantessa.com dashboard</Link> is the control
          plane for both: approvals derive the allowlist, caps are EIP-712-signable, and every
          receipt lands in the <Link href="/docs/ledger-sync">hosted ledger</Link>. Whether these
          caps apply at all is the master <Link href="/docs/spend-policy">spend-policy switch</Link>.
        </p>
      </div>
    </>
  )
}
