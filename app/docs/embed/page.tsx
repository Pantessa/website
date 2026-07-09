import type { Metadata } from 'next'
import Link from 'next/link'
import EmbedInstall from '@/components/EmbedInstall'
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
  &key=yfe_…                       # your PUBLIC embed key (dashboard → Overview)
  &address=0xYourUsersWallet       # optional wallet-address context
  &theme=dark                      # dark (default) | light
  &host=https%3A%2F%2Fyour.app     # URL-encoded parent origin (enables messaging)
  &page=https%3A%2F%2Fyour.app%2Fswap  # URL-encoded page URL (embed analytics)`}</code>
        </pre>
        <ul>
          <li>
            <strong><code>key</code></strong> — a <em>publishable</em> embed key (<code>yfe_…</code>),
            minted on the <Link href="/dashboard">dashboard</Link>. It&apos;s safe in page source
            (it can read nothing and spend nothing that isn&apos;t already yours): it attributes
            the embed to your account, lists the site under <em>Your embeds</em>, and bills
            house-model answers to <strong>your plan&apos;s YEET credits</strong>{' '}instead of each
            visitor&apos;s free tier. Keyless embeds still work — tracked anonymously by origin,
            metered per visitor.
          </li>
          <li>
            <strong><code>mcps</code></strong> — directory slugs resolved against{' '}
            <Link href="/servers">the catalog</Link>; unknown slugs are dropped, capped at 4.
            If none resolve, the chat falls back to its normal default set.
          </li>
          <li>
            <strong><code>address</code></strong> — context only: it feeds{' '}
            <code>$USER_ADDRESS</code> in the router (&quot;show <em>my</em>{' '}open orders&quot;)
            and shows as a small <code>context: 0x12…ab</code> indicator. It can{' '}
            <strong>never sign</strong> — signatures come from a connected wallet: the host
            page&apos;s wallet over the bridge below, or one connected inside the iframe.
          </li>
          <li>
            <strong><code>host</code></strong> — your page&apos;s origin. postMessage is
            exchanged <em>only</em>{' '}with this origin; without it the embed doesn&apos;t listen
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

        <h2>Wallet bridge (contract v1.1)</h2>
        <p>
          With <code>yeetful/embed</code> ≥ 0.9.0 the SDK can relay your page&apos;s EIP-1193
          provider into the iframe, so the embedded chat is <em>really</em>{' '}wallet-connected —
          swap orders, transactions, and paid-call payments all sign through the user&apos;s own
          wallet, <strong>prompting on your page</strong>, never inside the frame. JSON-RPC rides
          the same origin-pinned postMessage channel:
        </p>
        <pre>
          <code>{`// embed → your page (the SDK answers these)
{ source: 'yeetful-embed', v: 1, type: 'rpc', id: '…', method: 'eth_requestAccounts', params?: […] }

// your page → embed
{ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: '…', result: … }
{ source: 'yeetful-embed', v: 1, type: 'rpc:error',  id: '…', error: { code: 4200, message: '…' } }

// your page → embed: announce the provider (after 'ready', and on
// accountsChanged / chainChanged / disconnect). Empty accounts = bridge
// available but not connected — the embed shows a "Connect host wallet"
// button instead of prompting uninvited.
{ source: 'yeetful-embed', v: 1, type: 'wallet', accounts: ['0x…'], chainId: '0x2105' | null }`}</code>
        </pre>
        <p>
          The SDK side enforces a <strong>method allowlist</strong> — connection + signing (
          <code>eth_requestAccounts</code>, <code>personal_sign</code>,{' '}
          <code>eth_signTypedData_v4</code>, <code>eth_sendTransaction</code>,{' '}
          <code>wallet_switchEthereumChain</code>/<code>addEthereumChain</code>) plus read-only
          RPC (<code>eth_call</code>, gas/fee/balance/receipt lookups and the like); anything
          else is refused with error code <code>4200</code>. Security model: the bridge grants
          the iframe the <em>same dapp-level access your page already has</em> — nothing more.
          There are no keys in the frame and no blanket signing authority: every signature and
          transaction pops the user&apos;s own wallet for explicit approval, exactly as if your
          page had requested it.
        </p>

        <h2>Or use the SDK</h2>
        <p>
          The <code>yeetful</code> npm package ships an embed helper that builds the iframe,
          wires the origin checks, and keeps the address context in sync:
        </p>
        <pre>
          <code>{`import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  container: document.getElementById('chat')!,
  key: 'yfe_…',              // your public embed key (>= 0.10; optional)
  mcps: ['cow-free', 'snapshot-free'],
  wallet: 'auto',            // bridge the page's EIP-1193 provider (v1.1);
                             // or pass a provider / 'off' for address-only context
  mode: 'bubble',            // 'bubble' (floating launcher) | 'inline'
})`}</code>
        </pre>
        <p>
          SDK ≥ 0.10 also reports the page URL (<code>page=</code>) so your dashboard&apos;s{' '}
          <em>Your embeds</em> list shows exactly which pages run the chat.
        </p>

        <h2>Install with Claude</h2>
        <p>
          The fastest path: copy the Claude Code prompt below and paste it inside your app&apos;s
          repo. It installs the SDK, mounts the chat, patches your CSP if needed, and tells you
          how to verify. One paste, live chat. Sign in and the{' '}
          <Link href="/dashboard/keys">Keys page</Link>{' '}generates the same prompt with your
          embed key baked in, so usage attributes to your account.
        </p>
        <EmbedInstall />

        <h2>Notes</h2>
        <ul>
          <li>
            The route serves <code>Content-Security-Policy: frame-ancestors *</code> — any site
            may embed it. Scope what the chat can do with <code>mcps</code>, not the frame.
          </li>
          <li>
            Guests run in burner mode: Yeetful&apos;s house wallet pays free-tier calls, so the
            chat answers with zero setup. Paid MCPs and swap/vote signatures use the bridged
            host wallet (v1.1) or a wallet your visitor connects inside the frame.
          </li>
        </ul>
      </div>
    </>
  )
}
