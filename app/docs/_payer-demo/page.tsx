import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The payer loop — one runnable script that is the whole thesis in ~30
// seconds: pay for data through the router (x402, receipted on-chain), then
// leave with a guarded plan for $0. The output below is a REAL run.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'payer-demo')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function PayerDemoDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> THE PAYER LOOP
      </p>
      <h1 className="docs__h1">Walk in with money, leave with a guarded plan</h1>
      <p className="docs__lead">
        An external agent needs exactly two things from a transaction layer: data it can pay for
        without an account, and plans it can trust without reading calldata. This demo does both
        in one script — an x402 payment through the routing engine, then a{' '}
        <Link href="/docs/jobs">dryRun job</Link> — against the same rails the chat uses.
      </p>

      <div className="docs__prose">
        <h2>Run it</h2>
        <pre>{`YF_API_KEY=yf_…  npx tsx scripts/x402-payer-demo.ts
# no key? .env.local PRIVATE_KEY → the script SIWE-mints one for you
# flags: --base http://localhost:3000   --ask "…"   --job "…"`}</pre>
        <p>
          Step ① hits <code>POST /api/route</code> — the routing engine as a service
          (Bearer-only). The engine shortlists, picks a paid endpoint, pays it over x402 (≤$0.05,
          gasless EIP-3009, settled on Base), and streams the receipts. Step ② hits{' '}
          <code>POST /api/jobs</code> with <code>dryRun: true</code> — the full compound plan,
          step 1 built and guard-checked against live venues, nothing created, $0.
        </p>

        <h2>A real run</h2>
        <pre>{`① POST /api/route — "What are the top crypto news headlines right now?"

  → selected Otto AI ($0.001)
  💸 paying…
  🧾 receipt: Otto AI — $0.001 — tx 0xca2bf8ea3cb46fb8… — ok
  🧾 receipt: ChatGPT — $0.001 — tx 0x6c3466fa2c4dc98c… — ok

  The top crypto news headlines right now are:
  1. South Korea to test tokenized government bonds with CBDC in 2027 …

② POST /api/jobs (dryRun) — "swap 5 usdc from base to arbitrum, then…"

  compiled: Bridge 5 USDC (base) → USDC (arbitrum) → Deposit 4 USDC to
            Hyperliquid → Long $12 of ETH on Hyperliquid → Arm stop-loss (5%)
    0. [sign] Bridge 5 USDC (base) → USDC (arbitrum)
    1. [wait] Solver settles the swap
    2. [sign] Deposit 4 USDC to Hyperliquid
    3. [wait] Hyperliquid credits the deposit
    4. [sign] Long $12 of ETH on Hyperliquid
    5. [auto] Arm stop-loss on ETH (5%)
  step 1 built + guarded against live venues ✓

∑ walked in with money, left with a guarded plan: paid $0.0020 for data, committed $0.`}</pre>
        <p>
          Both receipts are on-chain settlements — every paid call is auditable on{' '}
          <Link href="/activity">/activity</Link>. The plan committed nothing: signatures stay
          with the wallet, and each step is rebuilt and re-guarded when it&rsquo;s actually
          offered.
        </p>

        <h2>What the agent is trusting (and not)</h2>
        <ul>
          <li>
            <strong>Not trusting prices:</strong>{' '}x402 quotes are paid exactly as challenged;
            the engine refuses endpoints above its cap and your key&rsquo;s{' '}
            <Link href="/docs/agents">daily budget</Link> gates the total.
          </li>
          <li>
            <strong>Not trusting plans:</strong> the dryRun preview shows the same artifact +
            guard report a signature would see — including honest refusals when balances or
            venues say no.
          </li>
          <li>
            <strong>Trusting one thing:</strong> the <Link href="/docs/transactions">guard
            doctrine</Link> — models never write calldata, artifacts verify or die.
          </li>
        </ul>
      </div>
    </>
  )
}
