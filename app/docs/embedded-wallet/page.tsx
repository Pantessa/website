import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsCallout, DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'

// Signing in, for a trader (squad docs-clean, 2026-11-24). Three ways in:
// a wallet, Google, email (components/CreateAccountButton). Worded as what
// the sign-in door offers. The developer notes (wagmi, CDP env) are gone.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'embedded-wallet')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function EmbeddedWalletPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> SIGN IN
      </p>
      <h1 className="docs__h1">Sign in: a wallet, Google or email</h1>
      <p className="docs__lead">
        You need a wallet to sign a trade, not to look. Bring your own, or continue with Google or email and get a wallet
        only you control.
      </p>

      <DocsSummary>
        <li>Charts and markets need no sign-in at all.</li>
        <li>The sign-in door offers three ways in: a wallet, Google, or email.</li>
        <li>Google or email gives you a Coinbase embedded wallet: no extension, no seed phrase.</li>
        <li>Pantessa never holds your money or your keys.</li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>The three ways in</h2>
        <ul>
          <li>
            <strong>A wallet you already have.</strong> MetaMask, Coinbase Wallet, Phantom, Rainbow, or any wallet through WalletConnect. Connect it and sign
            with it.
          </li>
          <li>
            <strong>Continue with Google.</strong> Pantessa sets up a Coinbase embedded wallet for you.
          </li>
          <li>
            <strong>Continue with email.</strong> The same embedded wallet, unlocked with a code sent to your inbox.
          </li>
        </ul>
        <p>
          The embedded wallet is non-custodial: you control it, not Pantessa. Once connected it signs like any other
          wallet.
        </p>

        <h2>Sign in with email</h2>
        <DocsSteps>
          <DocsStep title="Press Sign in, or press any price">
            <p>The door opens. On a chart, your ask waits while you sign in.</p>
          </DocsStep>
          <DocsStep title="Choose Continue with email and type your address" />
          <DocsStep title="Enter the 6-digit code">
            <p>It comes to your inbox.</p>
          </DocsStep>
          <DocsStep title="You are in">
            <p>Press a price or a chip and sign the trade.</p>
          </DocsStep>
        </DocsSteps>
        <p>Continue with Google works the same way, without the code.</p>

        <h2>Coming back</h2>
        <p>
          With a live session, Pantessa reconnects you by itself. After you sign out, or on a new device, you sign in
          again.
        </p>

        <DocsCallout kind="warn" title="Opened from X or another app?">
          <p>
            Inside the X app, open pantessa.com in Safari or Chrome. Your wallet lives there. An app&rsquo;s built-in
            browser often cannot open a wallet app, and Google sign-in does not work inside one.
          </p>
        </DocsCallout>

        <p>
          At sign-up you agree to the <Link href="/docs/terms">Terms</Link> and the{' '}
          <Link href="/docs/privacy">Privacy policy</Link>.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/first-five-minutes', title: 'Your first five minutes', desc: 'Look, press, sign.' },
          { href: '/docs/markets', title: 'Markets', desc: 'What a chart can do.' },
          { href: '/docs/trust', title: 'Trust', desc: 'Why you can sign what Pantessa builds.' },
        ]}
      />
    </>
  )
}
