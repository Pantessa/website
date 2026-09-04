import type { Metadata } from 'next'
import Link from 'next/link'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'links')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function LinksDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> INTENT LINKS
      </p>
      <h1 className="docs__h1">Intent links</h1>
      <p className="docs__lead">
        An intent link is a short URL — <code>pantessa.com/i/&lt;slug&gt;</code> — that carries an
        ask as a plain sentence: <em>&ldquo;Buy $10 of AAPL&rdquo;</em>,{' '}
        <em>&ldquo;Stake 0.05 ETH with Lido&rdquo;</em>, <em>&ldquo;DCA $25 into ETH
        weekly&rdquo;</em>. Whoever opens it connects <strong>their own wallet</strong>, Pantessa
        scans, funds across chains, and builds the guarded path — and they sign, or nothing
        happens. You have an intent; we do the rest.
      </p>

      <div className="docs__prose">
        <h2>Mint one</h2>
        <p>
          Three ways, all landing on{' '}
          <Link href={LINKS_STUDIO_HREF}>the links studio (the app&apos;s LINKS tab)</Link>:
        </p>
        <ul>
          <li>
            <strong>Type the ask</strong>{' '}in the mint form — amounts included. The right MCPs
            attach themselves from the ask&apos;s shape (stocks pull Robinhood Chain, perps pull
            Hyperliquid), or pick up to four yourself.
          </li>
          <li>
            <strong>From the chat</strong> — hover any of your asks (or any signed receipt) and
            tap the link icon. The aha you just had becomes the link you share.
          </li>
          <li>
            <strong>From an agent</strong> — external agents mint through the hands MCP&apos;s{' '}
            <code>mint_intent_link</code> with their operator&apos;s <code>yf_</code> key; the
            operator (a human) owns the link, its funnel, and its earnings.
          </li>
        </ul>

        <h2>The consent contract</h2>
        <p>Every link, no exceptions:</p>
        <ul>
          <li>
            The link carries a <strong>sentence only</strong> — never calldata, artifacts, or
            addresses. Pantessa rebuilds the action from scratch with deterministic builders on
            the other side, so nothing a link contains can execute by itself.
          </li>
          <li>
            <strong>&ldquo;Connect &amp; build&rdquo; is the consent.</strong> Nothing runs
            until the visitor taps it; nothing moves until their wallet signs.
          </li>
          <li>
            <strong>Transfer-shaped asks never auto-run.</strong>{' '}&ldquo;Send X to
            0x…&rdquo; is the phishing shape — those land prefilled and wait for a deliberate
            press of send.
          </li>
          <li>
            <strong>Return URLs are validated at mint</strong> (public https only), stored
            server-side, and only ever offered as a button <em>after</em> a signature — never
            automatic, never read from the URL.
          </li>
        </ul>

        <h2>The funnel</h2>
        <p>
          Every link gets a live funnel on your dashboard: <strong>opens → connects → builds →
          signs → dollars moved</strong>. Dollar figures in the money columns are server-truth
          (guardrail-priced at signing) — the same accounting <Link href="/activity">/activity</Link>{' '}
          runs on. What your links earn is covered in{' '}
          <Link href="/docs/creator-earnings">Creator earnings</Link>.
        </p>

        <h2>A/B phrasings</h2>
        <p>
          One link can carry up to three alternate phrasings of its ask. Each visitor is served
          exactly one, and the funnel segments per phrasing — so you learn which wording
          converts, not just whether the link works. Every safety gate applies to the phrasing
          actually shown.
        </p>

        <h2>Limits (promos &amp; partners)</h2>
        <ul>
          <li>
            <strong>Expiry</strong> — the link dies at the clock, exactly like a revoked link.
          </li>
          <li>
            <strong>Sign caps</strong>{' '}— &ldquo;dies after 1000 signs&rdquo;, counted from
            server-truth signed transactions (client-side tricks can&apos;t burn or extend it).
          </li>
          <li>
            <strong>Wallet allowlists</strong> — reserve a link for specific wallets. The list
            never appears on the page; membership is checked server-side at connect.
          </li>
        </ul>

        <h2>Your public page</h2>
        <p>
          Claim a handle on the dashboard and every active link you hold appears on{' '}
          <code>/l/&lt;handle&gt;</code>{' '}— one shareable page of everything you&apos;ve
          published. Opt-in by design: a wallet address is never the key to a public page, and
          releasing the handle kills the page. Revoking any link 404s it instantly and takes it
          off this page, your own table, and the board — what it earned stays yours.
        </p>
      </div>
    </>
  )
}
