import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'privacy')!
const UPDATED = 'June 25, 2026'

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function PrivacyPage() {
  return (
    <>
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> PRIVACY POLICY
      </p>
      <h1 className="docs__h1">Privacy Policy</h1>
      <p className="docs__lead">
        Pantessa is non-custodial and collects as little as it can to run the Service. This policy
        explains what we collect, why, who we share it with, and what stays public on-chain.
      </p>

      <div className="docs__prose">
        <p>
          <strong>Last updated:</strong> {UPDATED}
        </p>
        <p>
          This Privacy Policy describes how <strong>Pantessa Inc.</strong>{' '}
          (&ldquo;Pantessa,&rdquo; &ldquo;we&rdquo;) handles information when you use the Pantessa
          website, dashboard, SDK, and APIs (the &ldquo;Service&rdquo;). By using the Service you
          agree to this policy. It works alongside our <Link href="/docs/terms">Terms of Service</Link>.
        </p>

        <h2>1. Information we collect</h2>
        <p>
          <strong>Wallet &amp; on-chain data.</strong> Your public wallet address, the Sign-In With
          Ethereum signatures you produce, and the on-chain payment records (amounts, counterparties,
          transaction hashes) generated when your agent pays for calls. Blockchain data is public and
          permanent by design.
        </p>
        <p>
          <strong>Sign-in &amp; account data.</strong> When you sign in or create an embedded wallet,
          authentication is handled by Coinbase Developer Platform (&ldquo;CDP&rdquo;). Depending on
          the method, we or CDP receive: your <strong>email address</strong> (email sign-in), or
          basic profile details from <strong>Google or X</strong> single sign-on (such as your name,
          email, and a provider account identifier). We never receive your Google, X, or wallet
          password, and the embedded wallet&rsquo;s private keys are held in CDP&rsquo;s secure
          infrastructure, not by us.
        </p>
        <p>
          <strong>Usage &amp; ledger data.</strong> Chats and messages you create, API key metadata
          (we store only a hash of each secret, never the secret itself), spend grants and approvals,
          organizations and members, and receipts for settled and refused calls.
        </p>
        <p>
          <strong>Technical data.</strong> Server and request logs, a secure httpOnly session cookie
          for signed-in sessions, and aggregate, privacy-preserving analytics about site usage.
        </p>

        <h2>2. Single sign-on (Google, X) and email</h2>
        <p>
          Social sign-in (&ldquo;SSO&rdquo;) and email sign-in are provided through Coinbase CDP&rsquo;s
          embedded-wallet authentication. When you choose &ldquo;Continue with Google&rdquo; or
          &ldquo;Continue with X,&rdquo; you authenticate with that provider, which returns a limited
          set of profile information (typically email, name, and an account identifier) used to
          create or sign you into your Pantessa embedded wallet. We use this only to authenticate you,
          create your account, and contact you about the Service. We do not post to your social
          accounts or access your contacts. Your use of Google or X is also governed by their own
          privacy policies, and your use of the embedded wallet by Coinbase&rsquo;s privacy policy.
          You can use a self-custodied wallet instead if you prefer not to use SSO or email.
        </p>

        <h2>3. How we use information</h2>
        <ul>
          <li>provide, operate, and secure the Service and your account;</li>
          <li>enforce spend controls and produce receipts and ledgers;</li>
          <li>route calls to third-party services you select or that the engine selects;</li>
          <li>prevent fraud, abuse, and security incidents, and comply with law;</li>
          <li>understand usage in aggregate and improve the Service;</li>
          <li>send you transactional or service-related messages.</li>
        </ul>

        <h2>4. How information is shared</h2>
        <p>We share information only as needed to run the Service:</p>
        <ul>
          <li>
            <strong>Service providers / processors</strong> — including Coinbase CDP
            (authentication, embedded wallets), our database and hosting providers, email delivery,
            inference/data providers, and analytics. They process data on our behalf under their
            terms.
          </li>
          <li>
            <strong>Third-party MCP services</strong> — when your agent or the routing engine calls a
            service, the request you send is transmitted to that service, which handles it under its
            own policies.
          </li>
          <li>
            <strong>Public blockchain</strong> — payment transactions are written to a public ledger
            and are visible to anyone and effectively permanent.
          </li>
          <li>
            <strong>Legal &amp; safety</strong> — when required by law or to protect rights, safety,
            and the integrity of the Service.
          </li>
          <li>
            <strong>Business transfers</strong> — in connection with a merger, acquisition, or sale
            of assets, subject to this policy.
          </li>
        </ul>
        <p>We do not sell your personal information.</p>

        <h2>5. On-chain data is public and permanent</h2>
        <p>
          Wallet addresses and transactions on the Base network are public and cannot be deleted or
          altered by us or anyone else. The public activity surface shows network payments in an
          anonymized, aggregate form (wallets truncated, refusals shown only in aggregate), but the
          underlying chain data remains public. Consider this before transacting.
        </p>

        <h2>6. Cookies and sessions</h2>
        <p>
          We use a strictly-necessary, httpOnly session cookie to keep you signed in after a
          Sign-In With Ethereum signature, and privacy-preserving analytics. We do not use
          third-party advertising cookies.
        </p>

        <h2>7. Data retention</h2>
        <p>
          We keep information for as long as your account is active or as needed to provide the
          Service, then for the period required to meet legal, security, and accounting obligations.
          On-chain records cannot be deleted.
        </p>

        <h2>8. Your choices and rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, export, or delete
          personal information, or to object to or restrict certain processing. You can disconnect
          your wallet, revoke API keys, delete chats, and request deletion of account data by
          contacting us. We will honor applicable requests, except where data must be retained by law
          or exists immutably on-chain.
        </p>

        <h2>9. Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect information (for
          example, storing only hashes of API key secrets and keeping sessions in httpOnly cookies).
          No method of transmission or storage is perfectly secure, and you are responsible for
          safeguarding your wallet and credentials.
        </p>

        <h2>10. Children</h2>
        <p>
          The Service is not directed to, and may not be used by, anyone under 18. We do not
          knowingly collect information from children.
        </p>

        <h2>11. International users</h2>
        <p>
          We and our providers may process information in countries other than yours, which may have
          different data-protection laws. Where required, we rely on appropriate safeguards for such
          transfers.
        </p>

        <h2>12. Changes</h2>
        <p>
          We may update this policy; we will revise the date above and, for material changes, provide
          additional notice where appropriate.
        </p>

        <h2>13. Contact</h2>
        <p>
          Privacy questions or requests: <strong>[privacy@yeetful.com]</strong>.
        </p>
      </div>

      <div className="docs__callout">
        <p>
          This page is a general template and not legal advice. Have qualified counsel review it,
          confirm the list of processors and any regional disclosures (e.g. GDPR/CCPA), and complete
          the bracketed details before relying on it.
        </p>
      </div>
    </>
  )
}
