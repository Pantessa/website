import type { Metadata } from 'next'
import Link from 'next/link'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'host-buttons')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function HostButtonsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> SITE BUTTONS
      </p>
      <h1 className="docs__h1">Site buttons</h1>
      <p className="docs__lead">
        A money button any site can wear: <em>&ldquo;Buy $10 of AAPL on ours&rdquo;</em>. The{' '}
        <Link href="/links/embed">button generator</Link> mints an{' '}
        <Link href="/docs/links">intent link</Link> with your site as the return URL and hands
        you a copy-paste HTML snippet — <strong>no script, no iframe, no keys</strong>. Visitors
        tap it, sign with their own wallet on Pantessa, and a &ldquo;Return to your site&rdquo;
        button brings them back.
      </p>

      <div className="docs__prose">
        <h2>How it works</h2>
        <ol>
          <li>
            On <Link href="/links/embed">/links/embed</Link>, type the ask, add your https
            return URL, and (optionally) a button label.
          </li>
          <li>
            Mint. You get a live preview, the bare <code>/i/&lt;slug&gt;</code> URL, and the
            snippet — a plain <code>&lt;a&gt;</code> with inline styles that renders the same on
            any site, plus an optional trust badge.
          </li>
          <li>
            Paste it anywhere HTML goes: your dapp, a blog post, a newsletter, a docs page.
          </li>
        </ol>

        <h2>Why a plain link is the whole trick</h2>
        <p>
          The button <em>is</em> an intent link, so every runtime guarantee rides along free:
          the visitor faces an explicit <strong>Connect &amp; build</strong> consent step, the
          ask is rebuilt from scratch by deterministic guarded builders, their wallet is the
          only signer, and the return to your site happens only via a post-signature button —
          never automatically. Your return URL was validated and stored at mint; nothing on the
          page can redirect a visitor anywhere else.
        </p>

        <h2>Tracking &amp; earnings</h2>
        <p>
          The button&apos;s funnel (opens → connects → builds → signs → dollars) lives on{' '}
          <Link href={LINKS_STUDIO_HREF}>your links studio</Link>, and fee-bearing conversions
          accrue <Link href="/docs/creator-earnings">creator earnings</Link> like any other
          link.
        </p>

        <h2>Want the whole chat instead?</h2>
        <p>
          A button hands visitors to Pantessa and back. If you want the full experience{' '}
          <em>inside</em>{' '}your site — the chat mounted on your page, signing with the wallet
          your page already has connected — that&apos;s the five-line{' '}
          <Link href="/docs/embed">embed</Link>. Buttons for reach, embed for depth; they share
          the same guarded transaction layer.
        </p>
      </div>
    </>
  )
}
