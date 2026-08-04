import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'embedded-wallet')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function EmbeddedWalletPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> CREATE AN ACCOUNT (EMAIL)
      </p>
      <h1 className="docs__h1">Create an account (email)</h1>
      <p className="docs__lead">
        Not everyone has a wallet extension. <strong>&ldquo;Create an account&rdquo;</strong> lets a
        newcomer sign up with just an email — Pantessa spins up a Coinbase{' '}
        <strong>non-custodial</strong> wallet they fully control, no extension, no seed phrase. Once
        it&apos;s connected it behaves <em>exactly</em> like MetaMask.
      </p>

      <div className="docs__prose">
        <h2>The flow</h2>
        <p>
          Enter an email → get a one-time code → you&apos;re in. Behind it is a Coinbase CDP embedded
          wallet (email/OTP auth). The same email always returns the same wallet, so the one button
          is both sign-up and sign-in: new email, we create the wallet; returning, we sign you back
          in. Day to day, a returning visitor with a live session is <strong>auto-reconnected</strong>{' '}
          — no code needed; you only re-enter one after an explicit sign-out or on a new device.
        </p>

        <h2>Why it just works everywhere else</h2>
        <p>
          The embedded wallet is wired in as a <strong>wagmi connector</strong>. So the moment
          it&apos;s connected, it&apos;s a normal connected account — SIWE sign-in, EIP-712
          x402 signing, and your spend grant all treat it identically to an
          extension wallet. None of that code is connector-aware; nothing special to handle.
        </p>

        <h2>EOA, on purpose</h2>
        <p>
          Accounts are created as plain <strong>EOAs</strong>, not smart accounts. x402 settles via an
          EIP-3009 signature, and a smart-account popup that fires <em>after</em> an <code>await</code>{' '}
          is no longer a user gesture — the browser blocks it, which would break the second signature
          in a paid turn. The EOA flow keeps every signature in-page.
        </p>

        <h2>Configuration</h2>
        <p>
          The &ldquo;Create an account&rdquo; CTA appears when{' '}
          <code>NEXT_PUBLIC_CDP_PROJECT_ID</code> is set and your domain is allow­listed in the CDP
          portal. Absent that, the option is simply hidden and the app falls back to extension/
          wallet-connect logins — nothing else changes.
        </p>

        <p>
          New here? Start with{' '}
          <Link href="/docs/first-five-minutes">your first five minutes</Link>.
        </p>
      </div>
    </>
  )
}
