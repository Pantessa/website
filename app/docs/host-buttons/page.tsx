import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { DocsNext, DocsStep, DocsSteps, DocsSummary } from '@/components/docs'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'

// /docs/host-buttons (squad docs-clean, lane write-earn, 2026-11-24). The
// generator is app/links/embed/generator.tsx (mint needs a session: a 401
// answers "Sign in with your wallet"); the return params are the ones
// components/IntentRuntime appends to the stored return URL (returnHref).

const PAGE = DOCS_PAGES.find((p) => p.slug === 'host-buttons')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
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
        Put a button on your website that carries a trade. Your visitor signs with their own wallet on
        Pantessa, then a button brings them back to your site.
      </p>

      <DocsSummary>
        <li>The button is a plain HTML link. No script, no iframe, no keys.</li>
        <li>
          It opens an <Link href="/docs/links">intent link</Link>. Nothing runs until the visitor presses the
          button there and their own wallet signs.
        </li>
        <li>After they sign, a Return button takes them to your site. Never before, never by itself.</li>
        <li>
          Swaps through the button pay you like any link. See{' '}
          <Link href="/docs/creator-earnings">Creator earnings</Link>.
        </li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Make a button</h2>
        <DocsSteps>
          <DocsStep title="Sign in">
            <p>The link behind the button is minted in your name. Without a sign-in the generator asks you to sign in first.</p>
          </DocsStep>
          <DocsStep title={<>Open <Link href="/links/embed">pantessa.com/links/embed</Link></>} />
          <DocsStep title="Fill in the form">
            <p>
              <strong>The ask</strong>, such as &ldquo;Buy $10 of AAPL&rdquo;. Your <strong>return URL</strong>, an
              https page on your site. A <strong>button label</strong>{' '}if you want one.
            </p>
          </DocsStep>
          <DocsStep title="Mint and copy the snippet">
            <p>
              You get a preview, the link&apos;s <code>/i/&lt;slug&gt;</code> address and the snippet. The trust
              badge is on by default and adds one line under the button:{' '}
              <span className="mono">NON-CUSTODIAL · THEIR WALLET SIGNS · PANTESSA</span>.
            </p>
          </DocsStep>
          <DocsStep title="Paste it into any page that takes HTML">
            <p>A blog post, a newsletter, your app. The snippet is one link with its styles inline.</p>
          </DocsStep>
        </DocsSteps>

        <h2>What comes back to your site</h2>
        <p>
          Your return URL is checked and stored when you mint. Nothing on the link can send the visitor anywhere
          else. After they sign, the <strong>Return to yoursite.com</strong>{' '}button (named after your site) opens your URL with two query parameters
          added:
        </p>
        <pre>
          <code>https://yoursite.com/thanks?yeetful=signed&amp;ilink=&lt;slug&gt;</code>
        </pre>
        <p>
          <code>yeetful=signed</code> says the visitor came back from a signature, and <code>ilink</code>{' '}is the
          link&apos;s slug. If your URL already has a query, they are added after an <code>&amp;</code>. Anyone can
          type this address, so treat it as a sign that someone came back, not as proof of a trade.
        </p>

        <h2>Tracking and earnings</h2>
        <p>
          The button is a link like any other. Its opens, signs and earnings are at{' '}
          <SpineLink href={LINKS_STUDIO_HREF}>pantessa.com/chat?tab=links</SpineLink>{' '}once you are signed in.
        </p>

        <h2>More than a button</h2>
        <p>
          To put Pantessa inside your own page instead of sending visitors out, see{' '}
          <Link href="/docs/embed">Embed</Link>.
        </p>
      </div>

      <DocsNext
        links={[
          { href: '/docs/links', title: 'Intent links', desc: 'What a link carries and what the visitor sees.' },
          { href: '/docs/creator-earnings', title: 'Creator earnings', desc: 'How and when the money reaches you.' },
          { href: '/docs/embed', title: 'Embed', desc: 'Pantessa inside your own page.' },
        ]}
      />
    </>
  )
}
