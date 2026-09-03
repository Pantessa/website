import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'terms')!
const UPDATED = 'September 3, 2026'

// ── Counsel-owned values. Everything else on this page states how the product
// actually works and is kept in step with the code. These four are legal or
// operational decisions, not facts about the software, so they live here as
// one-line edits rather than buried in prose.
const LEGAL_ENTITY = 'Yeetful, Inc.'
const CONTACT = 'legal@yeetful.com'
const GOVERNING_LAW = '[governing jurisdiction — TO BE COMPLETED]'
const VENUE = '[venue — TO BE COMPLETED]'

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
        These terms govern your use of Pantessa. Pantessa is{' '}
        <strong>non-custodial</strong>: you connect or create your own wallet, you keep your own
        keys, and every transaction settles from your wallet with your own signature. Please read
        these terms carefully; by using Pantessa you agree to them.
      </p>

      <div className="docs__prose">
        <p>
          <strong>Last updated:</strong> {UPDATED}
        </p>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and{' '}
          <strong>{LEGAL_ENTITY}</strong>, doing business as Pantessa (&ldquo;Pantessa,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;), governing your access to and use of the Pantessa
          website, chat interface, dashboard, embeddable widget, SDK, APIs, and related services
          (together, the &ldquo;Service&rdquo;). If you use the Service on behalf of an
          organization, you represent that you are authorized to bind that organization, and
          &ldquo;you&rdquo; includes that organization.
        </p>

        <h2>1. What Pantessa is (and is not)</h2>
        <p>
          Pantessa turns a request written in plain language into a specific blockchain transaction
          that you review and sign. Depending on what you ask for and which integrations you enable,
          the Service can prepare transactions that swap tokens, place limit orders, bridge assets
          between networks, stake, supply or borrow on lending protocols, buy, sell or transfer
          NFTs, trade tokenized equities and perpetual futures on third-party venues, vote in
          governance, and pay third-party services per call using the{' '}
          <a href="https://www.x402.org">x402</a> standard. It also provides spend controls
          (allowlists, per-call and per-day budgets, a freeze switch), receipts, and a routing
          engine that selects third-party services on your behalf.
        </p>
        <p>
          Pantessa is <strong>non-custodial</strong>. We do not take custody of your funds, private
          keys, or crypto-assets, and we cannot move your assets. Transactions settle directly from
          your wallet on a public blockchain. Pantessa is not a bank, money transmitter, exchange,
          broker-dealer, custodian, or investment adviser, and the Service is not a financial
          product. We do not match orders, operate a trading venue, hold an order book, set the
          price of any asset, or offer yield on assets you hold.
        </p>
        <p>
          We prepare transactions; the venues, protocols, and networks that execute them are
          independent third parties. Where the Service names a venue (for example a decentralized
          exchange, lending protocol, or marketplace), that venue is not affiliated with us and its
          own terms apply.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 18 years old and able to form a binding contract. You may not use the
          Service if you are barred from doing so under applicable law, or if you are located in, or
          a resident of, a jurisdiction subject to comprehensive sanctions, or if you are on any
          government restricted-party or sanctions list. You are responsible for complying with the
          laws that apply to you, including those governing crypto-assets, securities, taxes, and AI
          use.
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
          Some parts of the Service run on wallet connection alone, without a sign-in signature. In
          those flows your transaction signature is the proof of ownership. Signing in additionally
          lets you keep history across devices and reach account surfaces such as the dashboard.
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
            impersonate any person or business, or use the Service to imitate a third party&rsquo;s
            brand, product, or interface;
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

        <h2>5. Our fees</h2>
        <p>
          Pantessa charges a <strong>transaction fee of 0.20%</strong> on swaps it routes. The fee
          is shown to you before you sign and is included as a visible leg of the transaction you
          sign; it is paid on-chain to our treasury address. Transactions that originate from a
          shared intent link carry a <strong>0.50%</strong> rate instead, of which half is paid to
          the person who created that link. Fee rates may change; the rate that applies is the one
          quoted to you at the time you sign.
        </p>
        <p>
          Some features are offered under paid subscription plans, billed in advance through Stripe.
          Plan prices are shown on our <Link href="/pricing">pricing page</Link>. Subscriptions renew
          automatically until cancelled, and cancelling stops future renewals rather than refunding
          the current period, except where required by law.
        </p>
        <p>
          Our fees are separate from, and in addition to, network (gas) fees, venue and protocol
          fees, bridge and solver fees, per-call prices set by third-party services, and any fees
          charged by a fiat on-ramp provider. Those amounts are not set by us and are not ours.
        </p>

        <h2>6. Buying crypto with fiat (on-ramp)</h2>
        <p>
          If your wallet does not hold enough to complete what you asked for, the Service may offer
          you the option to buy crypto with a card, bank transfer, or other payment method. That
          purchase is made through an independent third-party on-ramp provider.
        </p>
        <p>
          <strong>We are not the seller of the crypto and we never handle your fiat.</strong> The
          on-ramp provider is the merchant of record for that purchase. It sets its own prices,
          fees, limits, and supported countries, performs its own identity verification, and its own
          terms and privacy policy govern the transaction. The assets are delivered directly from
          that provider to the wallet address you connected. Pantessa takes no fee on funding, never
          receives the funds, and cannot cancel, refund, or reverse an on-ramp purchase.
        </p>
        <p>
          Before an on-ramp session is created we ask your wallet to sign a message naming the
          destination address and amount, so that funding can only ever be directed to a wallet you
          control. Disputes about a fiat purchase must be raised with the on-ramp provider or your
          payment provider.
        </p>

        <h2>7. Automated and delegated execution</h2>
        <p>
          Some features act between your visits. Multi-step jobs, recurring buys, and protective
          orders such as stop-losses can only work if something is able to act while you are away.
          These features are <strong>off unless you explicitly enable them</strong>, and each one
          tells you what it will do before you authorize it.
        </p>
        <p>
          Where a feature acts without a fresh signature from you at the moment of execution, it
          does so under a limited authorization you granted in advance — for example a spend
          permission with a capped amount and period, or a venue-level agent key that can trade but
          can never withdraw. Those authorizations are narrow by design, are subject to the spend
          controls on your account, and you can revoke them at any time from the dashboard or at the
          venue.
        </p>
        <p>
          You remain responsible for what you authorize. Automated features depend on networks,
          venues, price feeds, and scheduling that can fail, lag, or behave unexpectedly. A
          protective order may not execute at your chosen level, or at all. We do not guarantee that
          any automated action will run, run on time, or achieve any particular price or outcome,
          and you should not rely on one as your only risk control.
        </p>

        <h2>8. Shared links, public pages, and creator earnings</h2>
        <p>
          You can turn a request into a shareable link and publish a public page under a handle you
          claim. Content you publish this way — including the request text, your handle, branding
          you upload, and resulting activity — is public, and you are responsible for it and for
          your right to use any brand assets you supply. We may remove or revoke links, handles, or
          pages that are unlawful, deceptive, infringing, or that imitate another business.
        </p>
        <p>
          Where a link you created earns a share of our fee, that share accrues as described in the
          Service and is payable subject to any minimum threshold and verification we apply.
          Earnings from self-dealing, artificial volume, or testing activity may be withheld. Links
          are revocable and earning is not guaranteed.
        </p>

        <h2>9. Developer, API, and embedding terms</h2>
        <p>
          If you use our API keys, SDK, or embeddable widget, you must keep secret keys secret, use
          publishable keys only on sites you control, and stay within the limits of your plan. You
          are responsible for what your integration does on behalf of your own users, for disclosing
          to them that transactions are prepared by Pantessa and signed with their own wallet, and
          for your own compliance with applicable law. We may rate-limit, suspend, or revoke keys
          that are abused, that create risk, or that exceed plan limits.
        </p>

        <h2>10. Third-party services</h2>
        <p>
          The Service connects you to independent third parties — decentralized exchanges, lending
          and staking protocols, bridges and solvers, marketplaces, trading venues, tokenized-asset
          issuers, MCP and x402 services, inference and data providers, wallet and authentication
          providers (including Coinbase CDP), fiat on-ramp and payment providers, and public
          blockchains. We do not control and are not responsible for third-party services, their
          availability, solvency, pricing, content, or how they handle your data or requests. Your
          use of them is governed by their terms and policies.
        </p>

        <h2>11. No professional advice</h2>
        <p>
          The Service and its content do not constitute financial, investment, trading, legal,
          accounting, or tax advice, and nothing in the Service is a recommendation to buy, sell, or
          hold any asset. Prompts, suggestions, and example requests shown in the interface are
          illustrations of what the Service can do, not advice to do it. Outputs from AI models and
          third-party data may be inaccurate or incomplete. You are solely responsible for decisions
          you make using the Service.
        </p>

        <h2>12. Assumption of risk</h2>
        <p>
          Crypto-assets and blockchain technology carry significant risk, including price
          volatility, smart-contract and protocol bugs, bridge and solver failure, network
          congestion or failure, irreversible transactions, loss of keys, slippage and failed or
          stale quotes, total loss of value, and changing or uncertain regulation.
        </p>
        <p>
          Additional risks apply to some assets the Service can reach. Tokenized equities and
          similar instruments are issued by third parties, may not carry the rights of holding the
          underlying security, may trade at prices that differ from it, may be illiquid, and depend
          on the issuer and the network they live on. Leveraged and perpetual futures positions can
          be liquidated, and losses can exceed the amount you put in. NFTs and similar assets can be
          illiquid and can lose all value. By using the Service you acknowledge and accept these
          risks and agree that we are not liable for losses arising from them.
        </p>

        <h2>13. Intellectual property</h2>
        <p>
          The Service, including its software, design, and content (excluding your content and
          open-source components), is owned by Pantessa or its licensors and protected by law. We
          grant you a limited, non-exclusive, non-transferable, revocable right to use the Service
          under these Terms. Our SDK and other components released under an open-source license are
          governed by that license. You retain ownership of content you submit, and grant us a
          license to host, process, and display it as needed to operate and improve the Service.
        </p>

        <h2>14. Beta and changes to the Service</h2>
        <p>
          The Service is offered on an evolving basis and may include experimental features. We may
          add, change, suspend, or discontinue any part of the Service at any time. We may update
          these Terms; material changes will be reflected by updating the date above and, where
          appropriate, by additional notice. Your continued use after changes take effect means you
          accept the updated Terms.
        </p>

        <h2>15. Disclaimers</h2>
        <p>
          The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available,&rdquo;</strong>{' '}
          without warranties of any kind, whether express, implied, or statutory, including implied
          warranties of merchantability, fitness for a particular purpose, title, and
          non-infringement. We do not warrant that the Service will be uninterrupted, secure,
          error-free, or that any result, quote, route, or automated action will be accurate,
          timely, or reliable.
        </p>

        <h2>16. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Pantessa and its affiliates, officers, and agents
          will not be liable for any indirect, incidental, special, consequential, exemplary, or
          punitive damages, or for any loss of profits, data, goodwill, or crypto-assets, arising
          out of or relating to the Service. To the maximum extent permitted by law, our total
          aggregate liability for all claims relating to the Service will not exceed the greater of
          the amount of fees you paid to Pantessa (as distinct from third-party services, venues,
          networks, and on-ramp providers) in the three months before the claim, or{' '}
          <strong>USD $100</strong>. Some jurisdictions do not allow certain limitations, so some of
          the above may not apply to you.
        </p>

        <h2>17. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Pantessa and its affiliates from any claims,
          losses, and expenses (including reasonable legal fees) arising from your use of the
          Service, your content, or your violation of these Terms or applicable law.
        </p>

        <h2>18. Termination</h2>
        <p>
          You may stop using the Service at any time, disconnect your wallet, and revoke any
          authorization you granted. We may suspend or terminate your access as described in these
          Terms. Provisions that by their nature should survive termination (including sections
          5&ndash;17 and 19) will survive.
        </p>

        <h2>19. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of <strong>{GOVERNING_LAW}</strong>, without regard
          to conflict-of-laws rules, and the courts located in <strong>{VENUE}</strong> will have
          exclusive jurisdiction, except where applicable law provides otherwise. If any provision is
          found unenforceable, the rest remains in effect.
        </p>

        <h2>20. Contact</h2>
        <p>
          Questions about these Terms: <strong>{CONTACT}</strong>.
        </p>
      </div>

      <div className="docs__callout">
        <p>
          This page describes how the Service actually works, but it is not legal advice. Qualified
          counsel should review it and complete the governing-law and venue details before you rely
          on it.
        </p>
      </div>
    </>
  )
}
