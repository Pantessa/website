import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import EmbedDemo from '@/components/EmbedDemo'
import EmbedInstall from '@/components/EmbedInstall'
import { DOCS_PAGES, DOORS, docsJsonLd, docsUrl, doorPages } from '@/lib/docs'

// The /docs landing — told story-first: Yeetful is the non-custodial back
// office for autonomous money, and the docs open three doors for three
// readers — embed it (hosts), trust it (users), pay it (agent devs). The
// intent→build→receipt spine and the $0 jobs curl stay; the embed demo
// lives under the host door's teaser. Server-rendered so the copy is
// crawlable — EmbedDemo and EmbedInstall are the only client islands.

const PAGE = DOCS_PAGES.find((p) => p.slug === '')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl('') },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(''), type: 'website' },
}

// The three doors — the landing's primary navigation. Each leads with its
// reader and its first page.
const DOOR_CARDS = [
  {
    id: 'host' as const,
    kicker: 'EMBED IT · FOR HOSTS',
    title: 'The chat on your site, in five lines',
    lead: (
      <>
        Mount the full Yeetful chat on any page — guarded builds, receipts, and signing with the
        wallet <strong>already connected to your site</strong> (<code>wallet: &apos;auto&apos;</code>).
        A publishable <code>yfe_</code> key attributes every session to your dashboard: funnel,
        dead-ends, money moved.
      </>
    ),
    href: '/docs/embed',
    cta: 'Embed the chat',
  },
  {
    id: 'user' as const,
    kicker: 'TRUST IT · FOR USERS',
    title: 'Why you can sign what it builds',
    lead: (
      <>
        Non-custodial, checked, and receipted: the model never writes calldata, every artifact is
        re-checked fail-closed before your wallet sees it, and standing intents — jobs, recurring
        buys, Guardian — <strong>never sign for you</strong> beyond what you explicitly delegated.
      </>
    ),
    href: '/docs/trust',
    cta: 'The trust model',
  },
  {
    id: 'creator' as const,
    kicker: 'EARN WITH IT · FOR CREATORS',
    title: 'A link that carries an ask — and pays you on conversions',
    lead: (
      <>
        Mint <code>/i/&lt;slug&gt;</code> links that carry a plain-English ask. Whoever opens
        one connects <strong>their own wallet</strong>, Yeetful builds the guarded path, they
        sign — and you earn half of the 0.20% fee on every conversion your link produces, with
        a live funnel to prove it.
      </>
    ),
    href: '/docs/links',
    cta: 'Intent links',
  },
]

const STEPS = [
  {
    num: 'STEP 1 · INTENT',
    title: 'Say what should happen — once',
    lead: (
      <>
        &ldquo;Swap 20 USDC for ETH on Base.&rdquo; &ldquo;Buy $10 of AAPL every week.&rdquo;
        &ldquo;Bridge 5 USDC to Arbitrum, then deposit it to Hyperliquid, then long $12 of ETH,
        then protect it with a 5% stop.&rdquo; Money asks are claimed by{' '}
        <strong>deterministic parsers</strong>, not sampled from a model — the same sentence hits
        the same code path every time, and compound asks compile into{' '}
        <Link href="/docs/jobs">jobs</Link> the runner walks step by step.
      </>
    ),
    links: [
      { href: '/docs/jobs', label: 'Jobs & recurring buys' },
      { href: '/docs/transactions', label: 'How parsing works' },
    ],
  },
  {
    num: 'STEP 2 · GUARDED BUILD',
    title: 'Every artifact earns its signature',
    lead: (
      <>
        Per-venue builders — CoW, Uniswap v3/v4, NEAR Intents, Aave, Hyperliquid, Snapshot —
        derive each transaction from <strong>live venue state</strong>, and a fail-closed guard
        re-checks it before your wallet sees it. The model never writes calldata, amounts, or
        addresses. When a check fails you get the reason, not a guess.
      </>
    ),
    links: [
      { href: '/docs/transactions', label: 'Venues & guards' },
      { href: '/docs/guardian', label: 'Guardian: autonomy, no custody' },
    ],
  },
  {
    num: 'STEP 3 · SIGN & RECEIPT',
    title: 'Your wallet signs. Everything is receipted.',
    lead: (
      <>
        Nothing is custodial: the layer produces artifacts, <strong>only your signature moves
        money</strong>. Built, signed, or refused — every decision lands with its priced value
        on your <Link href="/dashboard">dashboard</Link> and traces live on{' '}
        <Link href="/activity">/activity</Link>. Autonomy you can audit beats autonomy you have
        to trust.
      </>
    ),
    links: [
      { href: '/docs/trust', label: 'The full trust model' },
      { href: '/activity', label: 'Watch it decide live' },
    ],
  },
]

const ELSEWHERE = [
  { href: 'https://www.npmjs.com/package/yeetful', label: 'yeetful on npm', sub: 'the embed helper plus x402 client/server helpers — MIT, TypeScript', ext: true },
  { href: 'https://github.com/Yeetful', label: 'Yeetful on GitHub', sub: 'the SDK, free MCPs, embed demos, and the rest — open source', ext: true },
  { href: 'https://uniswap-embed.yeetful.com/', label: 'Uniswap fork + the chat', sub: 'a live proof-of-concept: the embed mounted on a fork of the Uniswap interface', ext: true },
  { href: 'https://cow-embed.yeetful.com/', label: 'CoW Swap fork + the chat', sub: 'the same install on a fork of CoW Swap — the widget streams the connected wallet in', ext: true },
  { href: '/activity', label: 'Network activity', sub: 'every settled call on the network, anonymized and on-chain verifiable', ext: false },
]

export default function DocsIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />

      {/* ── Hero ── */}
      <p className="splash__eyebrow mono">BUILD ON YEETFUL</p>
      <h1 className="splash__h1">
        The non-custodial back office <em className="hero__em">for autonomous money.</em>
      </h1>
      <p className="splash__lead">
        Tell Yeetful what should happen — once. It compiles the sentence into deterministic,
        guard-checked transactions; <strong>your own wallet is the only thing that can
        sign</strong>; every build is priced, capped, receipted, and killable. These docs open
        three doors: <Link href="/docs/links">earn with it</Link> as a creator,{' '}
        <Link href="/docs/embed">embed it</Link> on your site, or{' '}
        <Link href="/docs/trust">trust it</Link> with your signature.
      </p>
      <div className="splash__ctas">
        <Link href="/docs/jobs" className="btn btn--solid">
          Run a job for $0
        </Link>
        <Link href="/docs/trust" className="btn btn--ghost">
          The trust model
        </Link>
      </div>

      {/* ── The three doors ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">Three doors, three readers</h2>
        </div>
        <div className="splash__steps">
          {DOOR_CARDS.map((d) => (
            <section key={d.id} className="splash__step">
              <p className="splash__stepnum mono">{d.kicker}</p>
              <h3 className="splash__steptitle">{d.title}</h3>
              <p className="splash__steplead">{d.lead}</p>
              <div className="splash__more">
                <Link href={d.href}>
                  {d.cta} <ArrowUpRight width={13} height={13} />
                </Link>
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* ── The layer, in three moves ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">Intent → guarded build → receipt</h2>
        </div>
        <div className="splash__steps">
          {STEPS.map((s) => (
            <section key={s.num} className="splash__step">
              <p className="splash__stepnum mono">{s.num}</p>
              <h3 className="splash__steptitle">{s.title}</h3>
              <p className="splash__steplead">{s.lead}</p>
              <div className="splash__more">
                {s.links.map((l) => (
                  <Link key={l.href} href={l.href}>
                    {l.label} <ArrowUpRight width={13} height={13} />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* ── Try it now: the $0 quickstart ── */}
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">TRY IT · $0</p>
          <p className="splash__npmlead">
            <code>dryRun</code> compiles a compound intent and builds step 1 against{' '}
            <strong>live venues</strong>{' '}— real quote, real guard report — without creating or
            costing anything. Mint a <code>yf_</code> key at{' '}
            <Link href="/dashboard/keys">/dashboard/keys</Link> and paste. The{' '}
            <Link href="/docs/jobs">Jobs page</Link> shows the real response.
          </p>
        </div>
        <pre className="splash__code mono">{`curl -s https://www.yeetful.com/api/jobs \\
  -H "authorization: Bearer $YF_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"ask": "swap 5 usdc from base to arbitrum, then deposit 4 usdc to hyperliquid", "dryRun": true}'`}</pre>
      </div>

      {/* ── The embed: the host door's teaser ── */}
      <div className="splash__embedgrid" id="embed">
        <div className="splash__embedcopy">
          <p className="splash__kicker mono">EMBED IT · 5 LINES</p>
          <h2 className="splash__pathtitle">The same rails, on your site</h2>
          <p className="splash__pathlead">
            Everything above ships as a chat you can mount on any page — routing, guarded
            builds, receipts, signing with the wallet already connected to your site. Copy the
            Claude Code prompt and Claude does the install end to end, or take the raw snippet
            and mount it yourself.
          </p>
          <EmbedInstall />
          <div className="splash__more">
            <Link href="/docs/embed">The full embed docs <ArrowUpRight width={13} height={13} /></Link>
            <Link href="/dashboard/keys">Mint an embed key <ArrowUpRight width={13} height={13} /></Link>
          </div>
        </div>
        <EmbedDemo />
      </div>

      {/* ── The SDK, demoted but reachable ── */}
      <div className="splash__npm">
        <div>
          <p className="splash__kicker mono">ONE PACKAGE</p>
          <p className="splash__npmlead">
            Everything ships in the <code>yeetful</code> npm package — <code>yeetful/embed</code>{' '}
            mounts the full chat on your site in five lines (see{' '}
            <Link href="/docs/embed">the embed docs</Link>), with agent-payment and MCP-earnings
            helpers included for the deep end. MIT, TypeScript.
          </p>
        </div>
        <pre className="splash__code mono">npm install yeetful</pre>
      </div>

      {/* ── Go deeper, door by door ── */}
      {DOORS.map((door) => {
        const pages = doorPages(door.id)
        if (pages.length === 0) return null
        return (
          <div className="svc__section" key={door.id}>
            <div className="svc__sectionhead">
              <h2 className="svc__h2">{door.label}</h2>
              <span className="svc__count mono">{door.reader.toUpperCase()}</span>
            </div>
            <div className="docs__cards">
              {pages.map((p) => (
                <Link key={p.slug} href={`/docs/${p.slug}`} className="docs__card">
                  <span className="docs__cardtitle">{p.title}</span>
                  <span className="docs__carddesc">{p.description}</span>
                </Link>
              ))}
            </div>
          </div>
        )
      })}

      {/* ── Elsewhere ── */}
      <div className="svc__section">
        <div className="svc__sectionhead">
          <h2 className="svc__h2">The rest of the stack</h2>
        </div>
        <div className="dev__links">
          {ELSEWHERE.map((l) => (
            <a
              key={l.href}
              className="dev__biglink"
              href={l.href}
              {...(l.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {l.label} <ArrowUpRight width={14} height={14} />
              <span>{l.sub}</span>
            </a>
          ))}
        </div>
      </div>
    </>
  )
}
