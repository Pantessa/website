import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'embed')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function EmbedDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> EMBED THE CHAT
      </p>
      <h1 className="docs__h1">Embed the chat</h1>
      <p className="docs__lead">
        Drop the full Yeetful chat into your own site as an iframe — scoped to the MCPs you
        pick, with transaction building, guardrails, receipts, and wallet signing intact.
        Visitors chat immediately as guests (no sign-in); signing a swap or vote connects a
        wallet inside the frame.
      </p>

      <div className="docs__prose">
        <h2>The iframe URL</h2>
        <pre>
          <code>{`https://www.yeetful.com/embed
  ?mcps=cow-free,snapshot-free     # comma-separated directory slugs (max 4)
  &address=0xYourUsersWallet       # optional wallet-address context
  &theme=dark                      # dark (default) | light
  &host=https%3A%2F%2Fyour.app     # URL-encoded parent origin (enables messaging)`}</code>
        </pre>
        <ul>
          <li>
            <strong><code>mcps</code></strong> — directory slugs resolved against{' '}
            <Link href="/servers">the catalog</Link>; unknown slugs are dropped, capped at 4.
            If none resolve, the chat falls back to its normal default set.
          </li>
          <li>
            <strong><code>address</code></strong> — context only: it feeds{' '}
            <code>$USER_ADDRESS</code> in the router (&quot;show <em>my</em> open orders&quot;)
            and shows as a small <code>context: 0x12…ab</code> indicator. It can{' '}
            <strong>never sign</strong> — signatures always come from a wallet connected inside
            the iframe.
          </li>
          <li>
            <strong><code>host</code></strong> — your page&apos;s origin. postMessage is
            exchanged <em>only</em> with this origin; without it the embed doesn&apos;t listen
            at all and only posts <code>ready</code>/<code>resize</code> (nothing sensitive)
            with a <code>*</code> target.
          </li>
        </ul>

        <h2>postMessage API (contract v1)</h2>
        <p>
          Every payload is an object tagged{' '}
          <code>{`{ source: 'yeetful-embed', v: 1, type: … }`}</code>.
        </p>
        <p>Embed → your page:</p>
        <pre>
          <code>{`{ source: 'yeetful-embed', v: 1, type: 'ready' }                          // mounted
{ source: 'yeetful-embed', v: 1, type: 'resize', height: 620 }            // content height changed
{ source: 'yeetful-embed', v: 1, type: 'event', name: 'order-signed',     // notable moments
  data: { orderUid: '0x…', explorerUrl: 'https://explorer.cow.fi/…' } }`}</code>
        </pre>
        <p>Your page → embed (send to the iframe&apos;s contentWindow, targeting the Yeetful origin):</p>
        <pre>
          <code>{`{ source: 'yeetful-embed', v: 1, type: 'address', address: '0x…' | null } // update wallet context
{ source: 'yeetful-embed', v: 1, type: 'theme', theme: 'dark' | 'light' }
{ source: 'yeetful-embed', v: 1, type: 'prompt', text: 'quote 100 USDC…',  // host CTA → chat:
  send: true }                                                             // submit (or prefill w/ send:false)`}</code>
        </pre>

        <h2>Or use the SDK</h2>
        <p>
          The <code>yeetful</code> npm package ships an embed helper that builds the iframe,
          wires the origin checks, and keeps the address context in sync:
        </p>
        <pre>
          <code>{`import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  container: document.getElementById('chat')!,
  mcps: ['cow-free', 'snapshot-free'],
  address: connectedAddress, // optional; update later via the returned handle
  mode: 'bubble',            // 'bubble' (floating launcher) | 'inline'
})`}</code>
        </pre>

        <h2>Notes</h2>
        <ul>
          <li>
            The route serves <code>Content-Security-Policy: frame-ancestors *</code> — any site
            may embed it. Scope what the chat can do with <code>mcps</code>, not the frame.
          </li>
          <li>
            Guests run in burner mode: Yeetful&apos;s house wallet pays free-tier calls, so the
            chat answers with zero setup. Paid MCPs and swap/vote signatures use the wallet your
            visitor connects inside the frame.
          </li>
        </ul>
      </div>
    </>
  )
}
