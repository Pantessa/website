import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The user door's lead page: why a signature on a Pantessa artifact is safe
// to give. Trust-critical — plain statements, no jokes, every claim checked
// against the code that enforces it (lib/tx-guardrails, lib/spend-grant,
// lib/approvals, lib/fees).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'trust')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function TrustDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> TRUST: THE GUARDRAILS
      </p>
      <h1 className="docs__h1">Why you can sign what Pantessa builds</h1>
      <p className="docs__lead">
        Pantessa is non-custodial: it never holds your keys or your funds. It produces
        transaction artifacts — built deterministically, re-checked fail-closed, priced, and
        receipted — and <strong>your wallet is the only thing that can sign them</strong>. This
        page is the full trust model, claim by claim.
      </p>

      <div className="docs__prose">
        <h2>What non-custodial means here</h2>
        <ul>
          <li>
            <strong>No deposits.</strong> There is no Pantessa balance to fund. Your assets stay
            in your wallet until a transaction you signed moves them.
          </li>
          <li>
            <strong>No keys.</strong> Pantessa cannot spend on your behalf. Every transaction,
            order, and vote is offered to your wallet and moves only with your signature. Even
            the <Link href="/docs/embedded-wallet">email sign-up</Link> creates a Coinbase
            non-custodial wallet that you control, not Pantessa.
          </li>
          <li>
            <strong>One narrow exception, by explicit delegation:</strong>{' '}
            <Link href="/docs/guardian">Guardian</Link> uses a Hyperliquid agent key you
            authorize with one signature. That key can only reduce the position you told it to
            protect — it cannot withdraw, cannot open or grow positions, expires on its own, and
            can be revoked at any time.
          </li>
        </ul>

        <h2>The model never writes calldata</h2>
        <p>
          The language model that understands your ask never writes calldata, amounts, or
          addresses. Money asks are claimed by <strong>deterministic parsers</strong> — the same
          sentence hits the same code path every time — and handed to per-venue builders that
          derive the transaction from <strong>live venue state</strong>: real quotes, real pools,
          real balances, fetched at build time. The full venue-by-venue doctrine is on{' '}
          <Link href="/docs/transactions">Native venues &amp; guards</Link>.
        </p>

        <h2>Every build is re-checked, fail-closed</h2>
        <p>
          Before your wallet sees an artifact, an independent guard re-derives or decodes it and
          checks it against policy: pinned contract addresses and function selectors, exact
          amounts, verified recipients. Any mismatch kills the build. When a check fails you get
          the reason — &ldquo;wallet holds only 2.52 USDC on Arbitrum&rdquo; — never a guess, and
          never a transaction that hopes for the best.
        </p>

        <h2>Nothing stale ever reaches your wallet</h2>
        <p>
          Quotes and calldata expire. Pantessa treats that as a safety property: artifacts carry
          their validity window, multi-step chains advance automatically and re-quote steps at
          offer time, and anything past its deadline is <strong>rebuilt, not re-offered</strong>.
          You are never handed dead calldata that could settle at a stale price.
        </p>

        <h2>Priced, receipted, public</h2>
        <p>
          Every artifact carries its USD value, and every decision — built, signed, or refused —
          lands as a receipt on your <Link href="/dashboard">dashboard</Link>, with build
          decisions traced live on <Link href="/activity">/activity</Link>. When Pantessa charges
          a fee (0.20% on fee-bearing swap venues, below Uniswap&apos;s 0.25% interface fee), it
          appears in the artifact as its own labeled transfer step — never hidden inside
          slippage.
        </p>

        <h2>Caps protect the autonomous part</h2>
        <p>
          Your account&apos;s <Link href="/docs/spend-policy">spend policy</Link> draws one line:
          anything an agent initiates without you in the loop is capped at $200 per action and
          $200 per day by default, while anything <strong>you sign yourself</strong> is consented
          by that signature and is not walled by the caps. Money you <em>receive</em> — sale
          proceeds, filled listings — is never gated at all. You can curate the allowlist down
          from the dashboard whenever you want.
        </p>

        <h2>The kill switch outranks everything</h2>
        <p>
          Freeze your account from the <Link href="/dashboard">dashboard</Link> and every payment
          and build is refused — agent-initiated or not, inflow or outflow, policy on or off.
          Pause a single agent to stop just that key. Both are reversible; nothing is deleted.
        </p>

        <h2>Standing intents follow the same rules</h2>
        <p>
          The things Pantessa does <em>between</em> your visits never escape the model above:
        </p>
        <ul>
          <li>
            <strong><Link href="/docs/jobs">Jobs</Link></strong> — a compound intent compiles
            into steps, but each transaction is built fresh when it&apos;s offered and{' '}
            <strong>you sign every one</strong>. Settlement between steps is verified
            server-side, never assumed.
          </li>
          <li>
            <strong>Recurring buys (DCA)</strong> — &ldquo;buy $10 of AAPL every week&rdquo;
            creates a schedule, not an authorization. Each due period compiles a one-step job you
            sign; miss a week and it lapses rather than buying behind your back. See{' '}
            <Link href="/docs/jobs">Jobs</Link>.
          </li>
          <li>
            <strong><Link href="/docs/guardian">Guardian</Link></strong> — the only autonomous
            signer, under the delegated reduce-only key described above, re-guarded fail-closed
            at every trigger.
          </li>
        </ul>

        <h2>What you are trusting, exactly</h2>
        <p>
          Not prices — they are fetched live and re-checked. Not the model — it cannot write a
          transaction. Not Pantessa with your funds — it never has them. You are trusting one
          thing: that the guard doctrine holds — <strong>artifacts verify or die</strong> — and
          every build argues its case in public on <Link href="/activity">/activity</Link> so you
          can watch it hold.
        </p>
      </div>
    </>
  )
}
