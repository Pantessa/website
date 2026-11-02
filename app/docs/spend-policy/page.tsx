import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'

// Spend policy — RETIRED 2026-10-30. The expense account's allowlist, caps,
// master switch, EIP-712 signing and on-chain backing no longer gate
// anything Pantessa runs. This page says so, and says what still guards the
// account (your own signature, the receipts, the kill switch). Trust-critical
// page — every claim here mirrors lib/spend-grant and lib/tx-guardrails.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'spend-policy')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function SpendPolicyPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span>{' '}SPEND POLICY
      </p>
      <h1 className="docs__h1">Spend policy: retired. Your signature is the consent.</h1>
      <p className="docs__lead">
        There is no expense account to configure any more — no allowlist to curate, no
        per-action or daily cap, no agent to approve before it may run. Anything that moves your
        money is signed by <strong>you</strong>; every paid call is receipted; and the kill switch
        still outranks everything.
      </p>

      <div className="docs__prose">
        <h2>What changed</h2>
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>Status</th>
              <th>What it means for you</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Allowlist &amp; agent approvals</td>
              <td>gone</td>
              <td>Every agent in your set can run. Nothing is refused for “not approved”.</td>
            </tr>
            <tr>
              <td>Per-action and daily caps</td>
              <td>gone</td>
              <td>No action is refused for its size. A $3 send and a $3,000 swap walk the same guard checks.</td>
            </tr>
            <tr>
              <td>Policy switch, grant signing, on-chain backing</td>
              <td>gone</td>
              <td>Nothing to turn on, sign or back before your first ask.</td>
            </tr>
            <tr>
              <td>Receipts</td>
              <td>stay</td>
              <td>
                Every paid call still lands on your <SpineLink href="/dashboard">dashboard</SpineLink> with its
                cost and settlement.
              </td>
            </tr>
            <tr>
              <td>Kill switch</td>
              <td>stays</td>
              <td>Freeze the account and everything is refused until you resume.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Why? The caps and approvals existed to bound what an agent could spend{' '}
          <em>without</em> you in the loop. In practice they walled the first ask — a $3 send
          refused until you found the right toggle on the dashboard — and they never protected
          the thing that matters, because nothing that moves your money ever leaves the server
          unsigned.
        </p>

        <h2>Your signature is the consent</h2>
        <p>
          Every transaction Pantessa builds is offered to <strong>your</strong> wallet to sign —
          built deterministically by the venue layer, re-verified byte for byte against what you
          asked for, priced on the card before you sign. If you don&apos;t sign, nothing moves.
          That is the control; a cap on top of it only ever got in the way.
        </p>

        <h2>Calls Pantessa pays for you</h2>
        <p>
          An x402 call paid from the house wallet — an inference engine, a data agent — is metered
          and receipted, never refused for policy. The receipt under each reply shows what was
          paid and to whom; the dashboard totals it.
        </p>

        <h2>Sales are not spend</h2>
        <p>
          Actions where your wallet <strong>receives</strong> value — an NFT sale&apos;s proceeds, a
          filled listing — were never gated and still aren&apos;t. Only the kill switch applies
          regardless of direction.
        </p>

        <h2>The kill switch outranks everything</h2>
        <p>
          Two reversible stops apply to every path, in both spend directions, for self-signed and
          agent-initiated actions alike:
        </p>
        <ul>
          <li>
            <strong>Pause an agent</strong> (<SpineLink href="/dashboard/agents">Agents tab</SpineLink>) —
            freezes one key; everything else keeps working.
          </li>
          <li>
            <strong>Freeze the account</strong> (<SpineLink href="/dashboard">Overview</SpineLink>) —
            refuses every payment and build under your account until you unfreeze.
          </li>
        </ul>

        <h2>When a refusal happens</h2>
        <p>
          A refused build names its reason — a frozen account, or a guard check the artifact
          failed — and the chat offers the way back (resume, ask again) rather than a dead end.
          Every refusal lands in your ledger next to the settlements.
        </p>

        <h2>Where enforcement lives</h2>
        <ul>
          <li>
            <strong>Chats and embeds Pantessa runs</strong> — the kill switch and the guard layer
            are enforced server-side at the build gate and again at any submit relay.
          </li>
          <li>
            <strong>External SDK agents</strong> paying from their own wallet — the open-core SDK
            still enforces whatever grant its operator gave it (an allowlist, caps) in-process.
            That is the operator&apos;s own configuration, not something Pantessa gates.
          </li>
        </ul>
      </div>
    </>
  )
}
