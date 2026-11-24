import type { Metadata } from 'next'
import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import EmbedInstall from '@/components/EmbedInstall'
import { DocsSummary, DocsSteps, DocsStep, DocsCallout, DocsNext } from '@/components/docs'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { ROBINHOOD_DESK } from '@/lib/live-examples'
import { SITE_CARD } from '@/lib/og-defaults'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'embed')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
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
        Put the Pantessa chat on your own site with one package and a few lines. Your visitors ask
        in plain words, Pantessa builds the trade, and their own wallet signs it on your page.
      </p>

      <DocsSummary>
        <li>
          Install with <code>npm install pantessa viem</code> and call <code>mountPantessaChat</code>.
        </li>
        <li>
          The <code>yfe_</code> embed key is publishable. It is safe in page source and it is optional.
        </li>
        <li>
          With <code>wallet: &apos;auto&apos;</code>, the wallet already connected to your page signs.
          No keys ever enter the frame.
        </li>
        <li>
          Any site may frame it. You choose what the chat can do with <code>mcps</code> (up to 4).
        </li>
        <li>
          Your dashboard shows money moved, the funnel, and the asks that hit a dead end.
        </li>
      </DocsSummary>

      <div className="docs__prose">
        <h2>Install</h2>
        <DocsSteps>
          <DocsStep title="Get an embed key (optional)">
            <p>
              Mint a <code>yfe_</code> key on the{' '}
              <SpineLink href="/dashboard/keys">API Keys page</SpineLink>. It attributes the embed to
              your account and lists the site under <em>Your embeds</em>. Without one, the embed still
              works and is tracked by origin.
            </p>
          </DocsStep>
          <DocsStep title="Install the package">
            <pre>
              <code>npm install pantessa viem</code>
            </pre>
          </DocsStep>
          <DocsStep title="Mount the chat">
            <pre>
              <code>{`import { mountPantessaChat } from 'pantessa/embed'

mountPantessaChat({
  key: 'yfe_…',             // optional: your public embed key
  mcps: ['uniswap-free', 'snapshot-free'],
  wallet: 'auto',           // the host page's wallet signs
  mode: 'bubble',           // floating launcher; 'inline' fills a container
})`}</code>
            </pre>
            <p>
              For <code>mode: &apos;inline&apos;</code>, also pass{' '}
              <code>container: document.getElementById(&apos;chat&apos;)</code>.
            </p>
          </DocsStep>
          <DocsStep title="Check your dashboard">
            <p>
              Open <SpineLink href="/dashboard/embeds">/dashboard/embeds</SpineLink> after your first
              visitor turn. It lists your sites and pages and what moved through them.
            </p>
          </DocsStep>
        </DocsSteps>

        <h2>Or install with Claude</h2>
        <p>
          Copy this prompt and paste it into Claude Code inside your app&apos;s repo. It installs the
          SDK, mounts the chat, patches your Content-Security-Policy if needed, and tells you how to
          check it. Signed in, the <SpineLink href="/dashboard/keys">API Keys page</SpineLink> gives you
          the same prompt with your embed key filled in.
        </p>
        <EmbedInstall />

        <h2>A complete host app</h2>
        <p>
          <a href={ROBINHOOD_DESK.url} target="_blank" rel="noopener noreferrer">
            {ROBINHOOD_DESK.url.replace('https://', '')}
          </a>{' '}
          is a live portfolio desk for tokenized stocks on Robinhood Chain. Its source is{' '}
          <a href={ROBINHOOD_DESK.source} target="_blank" rel="noopener noreferrer">
            agent-examples/agents/robinhood-desk
          </a>
          . It reads holdings and prices from the chain. Every button is a <code>sendPrompt</code>{' '}
          into the embed. The visitor&apos;s wallet signs on the host page through the bridge, and the
          activity log is built from <code>turn</code> events. It ships with a CSP and a jsdom test of
          the wire.
        </p>

        <h2>Use the handle</h2>
        <p>
          <code>mountPantessaChat</code> returns a handle:
        </p>
        <ul>
          <li>
            <code>sendPrompt(text, {'{ submit?: boolean }'})</code>: any button on your page becomes an
            ask. It submits by default; <code>submit: false</code> only prefills.
          </li>
          <li>
            <code>setAddress(address)</code> and <code>setTheme(&apos;dark&apos; | &apos;light&apos;)</code>.
          </li>
          <li>
            <code>open()</code> and <code>close()</code> in bubble mode, and <code>destroy()</code>.
          </li>
        </ul>
        <DocsCallout kind="tip" title="Wallets picked after mount">
          <p>
            <code>wallet</code> is read once, at mount. Visitors often pick a wallet after the chat is
            on screen. Pass a small EIP-1193 facade that forwards to whichever wallet is selected and
            emits <code>accountsChanged</code> and <code>chainChanged</code> itself. Do not remount the
            iframe: a remount drops the conversation. The host app above does this.
          </p>
        </DocsCallout>

        <h2>What your dashboard shows</h2>
        <p>
          Every embed session reports its turns.{' '}
          <SpineLink href="/dashboard/embeds">/dashboard/embeds</SpineLink> turns them into three things:
        </p>
        <ul>
          <li>
            <strong>Money moved</strong>: signed, guardrail-priced USD through your embed.
          </li>
          <li>
            <strong>The funnel</strong>: sessions, then transactions built, then transactions signed,
            per site and per page.
          </li>
          <li>
            <strong>Dead-end sessions</strong>: visitors who never got a build, with their exact asks,
            and a prompt that hands the list to Claude to find the missing tool.
          </li>
        </ul>

        <h2>Deep links, no iframe</h2>
        <p>
          Any link can open the Pantessa chat with your MCP set active and an ask typed in. The ask is
          prefilled, never sent: the visitor presses send.
        </p>
        <pre>
          <code>{`https://www.pantessa.com/chat
  ?mcps=robinhood-free              # same slugs as the embed
  &prompt=Buy%20%242%20of%20AAPL    # prefilled`}</code>
        </pre>

        <h2>Reference: the iframe URL</h2>
        <p>The SDK builds this URL for you. You can also write the iframe by hand:</p>
        <pre>
          <code>{`https://www.pantessa.com/embed
  ?mcps=cow-free,snapshot-free         # directory slugs, max 4
  &key=yfe_…                           # public embed key
  &address=0xYourUsersWallet           # optional address context
  &theme=dark                          # dark (default) | light
  &host=https%3A%2F%2Fyour.app         # your origin, URL-encoded
  &page=https%3A%2F%2Fyour.app%2Fswap  # page URL, for analytics`}</code>
        </pre>
        <ul>
          <li>
            <code>key</code>: a publishable <code>yfe_</code>{' '}key. It can read and spend nothing that
            is not already yours. Each visitor gets a few free house-model answers a day. Past those,
            answers draw on your account&apos;s pool, which refills from the trades your visitors sign.
            To run them on your own AI key instead, opt in under{' '}
            <SpineLink href="/dashboard/plan#ai-key">Your AI key</SpineLink>.
          </li>
          <li>
            <code>mcps</code>: slugs from <Link href="/servers">the catalog</Link>. Unknown slugs are
            dropped and the list is capped at 4. If none resolve, the chat uses its default set.
          </li>
          <li>
            <code>address</code>: context only. It fills <code>$USER_ADDRESS</code>{' '}(&quot;show my open
            orders&quot;) and shows as a small indicator. It can never sign.
          </li>
          <li>
            <code>host</code>: your page&apos;s origin. The embed exchanges messages only with this
            origin. Without it, the embed listens to nothing and only posts <code>ready</code> and{' '}
            <code>resize</code>.
          </li>
          <li>
            <code>page</code>: the page URL. The SDK sends it, so <em>Your embeds</em> shows which
            pages run the chat.
          </li>
        </ul>

        <h2>Reference: postMessage (v1)</h2>
        <p>
          Every message is an object tagged <code>{`{ source: 'yeetful-embed', v: 1, type }`}</code>.
          The <code>yeetful-embed</code> tag is a frozen wire name.
        </p>
        <p>From the embed to your page:</p>
        <pre>
          <code>{`{ source: 'yeetful-embed', v: 1, type: 'ready' }
{ source: 'yeetful-embed', v: 1, type: 'resize', height: 620 }
{ source: 'yeetful-embed', v: 1, type: 'event', name: 'turn',
  data: { outcome: 'tx-built', artifact: 'tx-chain', valueUsd: 10 } }
{ source: 'yeetful-embed', v: 1, type: 'event', name: 'order-signed',
  data: { artifact: 'cow-order', valueUsd: 50, txUrl: 'https://explorer.cow.fi/…' } }`}</code>
        </pre>
        <p>
          <code>turn</code> fires once per chat turn with{' '}
          <code>{`{ outcome, artifact?, valueUsd?, txUrl?, chainId?, jobId? }`}</code>.
        </p>
        <ul>
          <li>
            <code>outcome</code>: <code>answered</code>, <code>tx-built</code>, <code>signed</code>,{' '}
            <code>settled</code>, <code>clarify</code>, <code>refused</code>,{' '}
            <code>credit-gate</code> or <code>error</code>.
          </li>
          <li>
            <code>artifact</code> on <code>tx-built</code>: <code>tx</code>, <code>tx-chain</code>,{' '}
            <code>job</code>, <code>cow-order</code>, <code>hl-order</code> or <code>vote</code>.
          </li>
          <li>
            <code>signed</code> carries <code>txUrl</code> and <code>chainId</code> when there is a
            receipt. <code>valueUsd</code> is the guardrail-priced amount.
          </li>
        </ul>
        <p>From your page to the embed (post to the iframe, targeting the Pantessa origin):</p>
        <pre>
          <code>{`{ source: 'yeetful-embed', v: 1, type: 'address', address: '0x…' | null }
{ source: 'yeetful-embed', v: 1, type: 'theme', theme: 'dark' | 'light' }
{ source: 'yeetful-embed', v: 1, type: 'prompt', text: 'quote 100 USDC…',
  send: true }   // send: false only prefills`}</code>
        </pre>

        <h2>Reference: wallet bridge (v1.1)</h2>
        <p>
          With <code>wallet: &apos;auto&apos;</code>{' '}or a provider you pass, the SDK relays your page&apos;s
          EIP-1193 provider into the iframe over the same origin-pinned channel. Every signature and
          transaction opens the visitor&apos;s own wallet on your page.
        </p>
        <pre>
          <code>{`// embed → your page (the SDK answers)
{ source: 'yeetful-embed', v: 1, type: 'rpc', id: '…', method: 'eth_requestAccounts', params?: […] }

// your page → embed
{ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: '…', result: … }
{ source: 'yeetful-embed', v: 1, type: 'rpc:error', id: '…',
  error: { code: 4200, message: '…' } }

// your page → embed: announce the provider after 'ready' and on
// accountsChanged / chainChanged / disconnect. Empty accounts means
// "bridge available, not connected": the embed shows a connect button.
{ source: 'yeetful-embed', v: 1, type: 'wallet', accounts: ['0x…'], chainId: '0x2105' | null }`}</code>
        </pre>
        <ul>
          <li>
            Allowed: <code>eth_requestAccounts</code>, <code>personal_sign</code>,{' '}
            <code>eth_signTypedData_v4</code>, <code>eth_sendTransaction</code>,{' '}
            <code>wallet_switchEthereumChain</code>, <code>wallet_addEthereumChain</code>, and
            read-only calls such as <code>eth_call</code>, balances, gas and receipts.
          </li>
          <li>
            Anything else is refused with error code <code>4200</code>.
          </li>
          <li>
            The bridge gives the iframe the same access your page already has, nothing more. There are
            no keys in the frame.
          </li>
        </ul>

        <h2>Notes</h2>
        <ul>
          <li>
            The route serves <code>Content-Security-Policy: frame-ancestors *</code>, so any site may
            embed it. Limit what the chat can do with <code>mcps</code>, not the frame.
          </li>
          <li>
            Guests chat at once, with no sign-in: Pantessa&apos;s house wallet pays free-tier calls.
            Paid MCPs, swaps and votes are signed by the bridged host wallet or a wallet the visitor
            connects inside the frame.
          </li>
        </ul>
      </div>

      <DocsNext
        links={[
          { href: '/docs/host-buttons', title: 'Site buttons', desc: 'A money button any page can wear, no chat needed.' },
          { href: '/docs/jobs', title: 'Jobs API', desc: 'Send one compound ask, get a guarded step plan back.' },
          { href: '/docs/trust', title: 'Trust', desc: 'How a build is guarded and priced before anyone signs.' },
        ]}
      />
    </>
  )
}
