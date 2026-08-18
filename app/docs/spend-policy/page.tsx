import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// Spend policy — rewritten 2026-07-20 for the open-by-default model
// (website#467/#469/#474): agents ON, ['*'] allowlist, $200/$200 caps,
// self-signed cap exemption, inflows never gated. Trust-critical page —
// every claim here mirrors lib/spend-grant, lib/approvals, lib/tx-guardrails.

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
        <Link href="/docs">DOCS</Link> <span>/</span>{' '}SPEND POLICY &amp; CAPS
      </p>
      <h1 className="docs__h1">Spend policy: open by default, capped by default</h1>
      <p className="docs__lead">
        Your expense account draws one line: what may <strong>agents</strong> spend without you
        in the loop. It starts open — every service enabled, protected by $200 caps — and you
        curate it down, not up. What you sign yourself is consented by that signature; what you{' '}
        <em>receive</em> is never gated; and the kill switch outranks all of it.
      </p>

      <div className="docs__prose">
        <h2>The defaults</h2>
        <p>
          Your expense account is created on your first dashboard visit, already on and already
          protective:
        </p>
        <table>
          <thead>
            <tr>
              <th>Setting</th>
              <th>Default</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Allowlist</td>
              <td>
                everything (<code>*</code>)
              </td>
              <td>
                All directory services enabled out of the gate — newly listed MCPs work without
                a re-sync. The caps are the protection, not the list.
              </td>
            </tr>
            <tr>
              <td>Per-action cap</td>
              <td>$200</td>
              <td>An agent-initiated action above this is refused.</td>
            </tr>
            <tr>
              <td>Daily cap</td>
              <td>$200</td>
              <td>Agent-initiated spend past this in a UTC day is refused.</td>
            </tr>
            <tr>
              <td>Policy switch</td>
              <td>on</td>
              <td>The allowlist and caps are enforced from the first call.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Why open? The old model — everything off until approved — walled brand-new accounts at
          their very first ask. Open-with-caps means your first swap works <em>and</em>{' '}a
          runaway agent still can&apos;t drain anything: the caps bound what moves without you.
        </p>

        <h2>Curate down, not up</h2>
        <p>
          The first agent you toggle <strong>off</strong> in{' '}
          <Link href="/dashboard/approvals">Approvals</Link> starts curation: the open wildcard is
          replaced by a concrete list — every service you have <em>not</em> disabled. Two things
          always stay allowed on a curated list, because cutting them off breaks the product
          rather than protecting you:
        </p>
        <ul>
          <li>
            <strong>Pantessa&apos;s native venues</strong> (the Uniswap/LiFi/CoW/Aave/Hyperliquid/
            OpenSea build layers) — you sign every one of those transactions yourself.
          </li>
          <li>
            <strong>House inference</strong> — the model that answers your chat turns.
          </li>
        </ul>

        <h2>Your signature is the consent</h2>
        <p>
          The caps exist to bound what agents do <em>without</em> you. A transaction{' '}
          <strong>your own wallet signs</strong> — a swap you asked for and approved in your
          wallet — is not refused by the per-action or daily cap: the signature is the consent.
          The allowlist and the kill switches still apply to self-signed builds; only the caps
          step aside.
        </p>

        <h2>Sales are not spend</h2>
        <p>
          Actions where your wallet <strong>receives</strong>{' '}value — an NFT sale&apos;s
          proceeds, a filled listing — are never gated by caps or the allowlist. Those controls
          govern what may be paid out, and gating a $1,800 sale behind a $200 spend cap protects
          no one. Only the kill switches apply regardless of direction.
        </p>

        <h2>The master switch</h2>
        <p>
          One switch on your <Link href="/dashboard">dashboard Overview</Link> arms the whole
          policy. On (the default), the allowlist and caps are enforced and every refusal is
          ledgered. Off, agent spend is unrestricted — still metered and receipted, just not
          refused. Toggling it never touches your per-agent approvals: flip it off for an
          experiment and back on, and your curated list is exactly where you left it.
        </p>

        <h2>The kill switch outranks everything</h2>
        <p>
          Two reversible stops work even when the policy switch is off, in both spend directions,
          for self-signed and agent-initiated actions alike:
        </p>
        <ul>
          <li>
            <strong>Pause an agent</strong> (<Link href="/dashboard/agents">Agents tab</Link>) —
            freezes one key; everything else keeps working.
          </li>
          <li>
            <strong>Freeze the account</strong> (<Link href="/dashboard">Overview</Link>) —
            refuses every payment and build under your account until you unfreeze.
          </li>
        </ul>

        <h2>When a refusal happens</h2>
        <p>
          A blocked build tells you which rule refused it and what to change — over the
          per-action cap, over the daily budget, or a host outside your curated allowlist — and
          the chat offers the fix (allow this venue, retry the job) rather than a dead end. Every
          refusal lands in your ledger next to the settlements; an audit trail that only shows
          successes isn&apos;t one.
        </p>

        <h2>Where enforcement lives</h2>
        <ul>
          <li>
            <strong>Chats and embeds Pantessa runs</strong> — enforced server-side at the build
            gate and again at any submit relay. Instant and hard.
          </li>
          <li>
            <strong>External SDK agents</strong>{' '}paying from their own wallet — enforced by the
            SDK&apos;s grant in-process, refreshed from{' '}
            <code>GET /api/agent/policy</code>. Pantessa cannot intercept another wallet&apos;s
            transfer in flight; the hard on-chain stop for adversarial cases is what Coinbase
            Spend Permissions add.
          </li>
        </ul>
      </div>
    </>
  )
}
