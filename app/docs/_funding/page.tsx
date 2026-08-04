import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'funding')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function FundingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> FUNDING (USDC ON BASE)
      </p>
      <h1 className="docs__h1">Funding (USDC on Base)</h1>
      <p className="docs__lead">
        Your agent pays per call in <strong>USDC on Base</strong>. Funding is just getting some USDC
        to the wallet your agent signs with — there&apos;s no deposit into Pantessa, and no custody.
        Your <Link href="/docs/expense-account">spend grant</Link> draws against that balance.
      </p>

      <div className="docs__prose">
        <h2>How much to keep</h2>
        <p>
          Less than you&apos;d think. x402 settles via an EIP-3009{' '}
          <code>TransferWithAuthorization</code>, which is <strong>gasless</strong> — there&apos;s no
          ETH to keep for gas. You only need enough USDC to cover the calls you&apos;ll make: a balance
          at or above your per-call cap is enough to start, and a few dollars covers a lot of typical
          calls (most are fractions of a cent).
        </p>

        <h2>Getting USDC onto Base</h2>
        <p>The common routes, in rough order of convenience:</p>
        <ul>
          <li>
            <strong>Withdraw from an exchange</strong> that supports the Base network — pick USDC,
            choose Base as the network, and send it to your wallet address.
          </li>
          <li>
            <strong>Bridge from Ethereum (or another chain)</strong> using Base&apos;s official bridge
            or any reputable bridge that supports USDC on Base.
          </li>
          <li>
            <strong>Already have USDC on Base elsewhere?</strong> Just send it to your wallet address.
            On the dashboard, <Link href="/dashboard">your account</Link> shows the address and a QR to
            scan from a phone wallet.
          </li>
        </ul>
        <p className="mono">
          Always confirm you&apos;re sending USDC on the <strong>Base</strong> network — funds sent on
          the wrong network won&apos;t arrive.
        </p>

        <h2>Testnet (Base Sepolia)</h2>
        <p>
          To try things without real money, use <strong>Base Sepolia</strong> and a Base Sepolia
          faucet for test USDC. Select Base Sepolia in your wallet (or the embedded-wallet flow), and
          point your SDK config at the <code>base-sepolia</code> network.
        </p>

        <h2>Supported networks</h2>
        <p>
          x402 settlement runs on <strong>Base mainnet</strong> and <strong>Base Sepolia</strong>
          {' '}(testnet). USDC is the settlement token on both.
        </p>

        <h2>If you run dry</h2>
        <p>
          A call whose quoted price exceeds your available balance simply doesn&apos;t settle — the
          payment fails rather than overdrawing, and the agent gets the error back. Top up the wallet
          and it resumes; nothing is queued or owed. The dashboard surfaces a low-balance nudge so you
          see it coming.
        </p>

        <p>
          Next: the <Link href="/docs/quickstart">quickstart</Link> makes your first paid call, and{' '}
          <Link href="/docs/embedded-wallet">create an account</Link> sets up a wallet with just an
          email.
        </p>
      </div>
    </>
  )
}
