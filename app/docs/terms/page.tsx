import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'terms')!
const UPDATED = 'June 25, 2026'

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function TermsPage() {
  return (
    <>
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> TERMS OF SERVICE
      </p>
      <h1 className="docs__h1">Terms of Service</h1>
      <p className="docs__lead">
        These terms govern your use of Pantessa. Pantessa is a <strong>non-custodial</strong> control
        plane and routing engine for agent payments — you connect or create your own wallet, and you
        pay third-party services directly. Please read these terms carefully; by using Pantessa you
        agree to them.
      </p>

      <div className="docs__prose">
        <p>
          <strong>Last updated:</strong> {UPDATED}
        </p>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and{' '}
          <strong>Pantessa Inc.</strong>{' '}(&ldquo;Pantessa,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us&rdquo;), governing your access to and use of the Pantessa website, dashboard,
          SDK, APIs, and related services (together, the &ldquo;Service&rdquo;). If you use the
          Service on behalf of an organization, you represent that you are authorized to bind that
          organization, and &ldquo;you&rdquo; includes that organization.
        </p>

        <h2>1. What Pantessa is (and is not)</h2>
        <p>
          Pantessa lets AI agents pay for inference and data per call in USDC on the Base network
          using the <a href="https://www.x402.org">x402</a> standard, and provides spend controls
          (allowlists, per-call and per-day budgets, a freeze switch), receipts, and a routing
          engine that selects third-party MCP services on your behalf.
        </p>
        <p>
          Pantessa is <strong>non-custodial</strong>. We do not take custody of your funds, private
          keys, or crypto-assets. Payments settle directly from your wallet to third-party services
          on a public blockchain. Pantessa is not a bank, money transmitter, exchange, broker,
          custodian, or investment adviser, and the Service is not a financial product.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old and able to form a binding contract. You may not use the
          Service if you are barred from doing so under applicable law, or if you are located in, or
          a resident of, a jurisdiction subject to comprehensive sanctions, or if you are on any
          government restricted-party or sanctions list. You are responsible for complying with the
          laws that apply to you, including those governing crypto-assets, taxes, and AI use.
        </p>

        <h2>3. Accounts and sign-in</h2>
        <p>
          You can access the Service by connecting a self-custodied wallet (verified with a Sign-In
          With Ethereum signature), or by creating an embedded wallet through Coinbase Developer
          Platform (&ldquo;CDP&rdquo;) using email, Google, or X. Authentication and the embedded
          wallet are provided by Coinbase and governed by Coinbase&rsquo;s terms; see our{' '}
          <Link href="/docs/privacy">Privacy Policy</Link> for what we receive.
        </p>
        <p>
          You are responsible for safeguarding your wallet, private keys, recovery methods, API
          keys, and any social or email accounts used to sign in. Activity under your wallet or keys
          is your responsibility. We cannot recover lost keys, reverse signed transactions, or
          restore access to a wallet we never held.
        </p>

        <h2>4. Acceptable use</h2>
        <p>You agree not to, and not to help anyone else:</p>
        <ul>
          <li>use the Service for unlawful, fraudulent, infringing, or harmful purposes;</li>
          <li>
            launder money, evade sanctions, finance illegal activity, or transact in goods or
            services you are not legally permitted to;
          </li>
          <li>
            attempt to circumvent spend controls, rate limits, allowlists, authentication, or other
            security or access controls;
          </li>
          <li>
            probe, scrape, overload, or disrupt the Service or its infrastructure, or introduce
            malware or automated abuse;
          </li>
          <li>
            infringe intellectual-property or privacy rights, or violate the terms of any
            third-party service you reach through Pantessa;
          </li>
          <li>
            use the Service to generate or distribute unlawful content, or to build a competing
            service by copying ours.
          </li>
        </ul>
        <p>
          We may suspend or terminate access that we reasonably believe violates these Terms or
          creates risk or legal exposure, with or without notice.
        </p>

        <h2>5. Payments, crypto-assets, and third-party pricing</h2>
        <p>
          Calls are paid in USDC on Base. You fund and control your own wallet. Per-call prices are
          set by the third-party MCP services you choose or that the routing engine selects, not by
          Pantessa, and may change at any time. Blockchain transactions are{' '}
          <strong>irreversible</strong>; once signed and settled, a payment cannot be undone by us.
          You are responsible for network fees, for keeping sufficient balance, and for any taxes
          arising from your use.
        </p>
        <p>
          Spend controls are enforced on a best-effort basis for the payments Pantessa executes or
          observes; they are not a guarantee against loss, and on externally-signed transactions
          they are advisory. You remain responsible for what your agents and keys authorize.
        </p>

        <h2>6. Third-party services</h2>
        <p>
          The Service connects you to independent third parties — MCP/x402 services, inference and
          data providers, wallet and authentication providers (including Coinbase CDP), and public
          blockchains. We do not control and are not responsible for third-party services, their
          availability, pricing, content, or how they handle your data or requests. Your use of them
          is governed by their terms and policies.
        </p>

        <h2>7. No professional advice</h2>
        <p>
          The Service and its content do not constitute financial, investment, trading, legal,
          accounting, or tax advice. Outputs from AI models and third-party data may be inaccurate
          or incomplete. You are solely responsible for decisions you make using the Service.
        </p>

        <h2>8. Assumption of risk</h2>
        <p>
          Crypto-assets and blockchain technology carry significant risk, including price
          volatility, smart-contract and protocol bugs, network congestion or failure, irreversible
          transactions, loss of keys, and changing or uncertain regulation. By using the Service you
          acknowledge and accept these risks and agree that we are not liable for losses arising
          from them.
        </p>

        <h2>9. Intellectual property</h2>
        <p>
          The Service, including its software, design, and content (excluding your content and
          open-source components), is owned by Pantessa or its licensors and protected by law. We
          grant you a limited, non-exclusive, non-transferable, revocable right to use the Service
          under these Terms. Our SDK and other components released under an open-source license are
          governed by that license. You retain ownership of content you submit, and grant us a
          license to host, process, and display it as needed to operate and improve the Service.
        </p>

        <h2>10. Beta and changes to the Service</h2>
        <p>
          The Service is offered on an evolving basis and may include experimental features. We may
          add, change, suspend, or discontinue any part of the Service at any time. We may update
          these Terms; material changes will be reflected by updating the date above and, where
          appropriate, by additional notice. Your continued use after changes take effect means you
          accept the updated Terms.
        </p>

        <h2>11. Disclaimers</h2>
        <p>
          The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available,&rdquo;</strong>{' '}
          without warranties of any kind, whether express, implied, or statutory, including implied
          warranties of merchantability, fitness for a particular purpose, title, and
          non-infringement. We do not warrant that the Service will be uninterrupted, secure,
          error-free, or that any result will be accurate or reliable.
        </p>

        <h2>12. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Pantessa and its affiliates, officers, and agents
          will not be liable for any indirect, incidental, special, consequential, exemplary, or
          punitive damages, or for any loss of profits, data, goodwill, or crypto-assets, arising
          out of or relating to the Service. To the maximum extent permitted by law, our total
          aggregate liability for all claims relating to the Service will not exceed the greater of
          the amount of fees you paid to Pantessa (as distinct from third-party services) in the
          three months before the claim, or <strong>USD $100</strong>. Some jurisdictions do not
          allow certain limitations, so some of the above may not apply to you.
        </p>

        <h2>13. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Pantessa and its affiliates from any claims,
          losses, and expenses (including reasonable legal fees) arising from your use of the
          Service, your content, or your violation of these Terms or applicable law.
        </p>

        <h2>14. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate your access as
          described in these Terms. Provisions that by their nature should survive termination
          (including sections 5–13 and 15) will survive.
        </p>

        <h2>15. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of <strong>[governing jurisdiction]</strong>,
          without regard to conflict-of-laws rules, and the courts located in{' '}
          <strong>[venue]</strong> will have exclusive jurisdiction, except where applicable law
          provides otherwise. If any provision is found unenforceable, the rest remains in effect.
        </p>

        <h2>16. Contact</h2>
        <p>
          Questions about these Terms: <strong>[legal@yeetful.com]</strong>.
        </p>
      </div>

      <div className="docs__callout">
        <p>
          This page is a general template and not legal advice. Have qualified counsel review and
          complete the remaining bracketed details (jurisdiction, venue, contact) before relying on
          it.
        </p>
      </div>
    </>
  )
}
