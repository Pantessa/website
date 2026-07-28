// Embed anywhere — the distribution story. The animated EmbedDemo (shared
// with the docs landing: bubble → panel → ask → $0 receipt on a CSS loop,
// "Try it live" swaps in the real /embed) next to the real 5-line install
// (SDK 0.9, wallet:'auto' = the HOST page's wallet signs), plus the two live
// fork demos. The demos are proof-of-concept forks of open-source interfaces
// — label them clearly as test cases: no partnership, no endorsement.
// Protocol logos on the demo cards are Nate-directed (2026-07-09) — the
// official marks vendored from the fork repos, colored per each brand.

import Link from 'next/link'
import EmbedDemo from '@/components/EmbedDemo'
import { UniswapMark, CowMark } from '@/components/protocol-marks'

const SNIPPET = `import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  mode: 'bubble',
  mcps: ['uniswap-free', 'snapshot-free'],
  wallet: 'auto', // the host page's wallet signs
})`

const DEMOS: { name: string; url: string; host: string; blurb: string; logo: React.ReactNode; logoClass: string }[] = [
  {
    name: 'Uniswap interface + Yeetful chat',
    url: 'https://uniswap-embed.yeetful.com/',
    host: 'uniswap-embed.yeetful.com',
    blurb: 'A fork of the open-source Uniswap interface with the chat mounted in ~25 lines. It auto-connects the page’s wallet, answers with your address, and quotes WETH→USDC through the free MCP.',
    logo: <UniswapMark />,
    logoClass: 'embeda__demologo--uni',
  },
  {
    name: 'CoW Swap + Yeetful chat',
    url: 'https://cow-embed.yeetful.com/',
    host: 'cow-embed.yeetful.com',
    blurb: 'A fork of the open-source CoW Swap interface. The widget streams the connected wallet into the chat; quotes and MEV-docs answers run through the CoW MCP.',
    logo: <CowMark />,
    logoClass: 'embeda__demologo--cow',
  },
]

export default function EmbedAnywhere() {
  return (
    <section className="embeda">
      <div className="embeda__head">
        <span className="embeda__eyebrow mono">EMBED ANYWHERE</span>
        <h2 className="embeda__h2">Embed the <span className="x-grad">whole agent</span> on your site. Five lines.</h2>
        <p className="embeda__sub">
          <code className="embeda__code">yeetful/embed</code> mounts the full chat — receipts,
          guardrails, signing — as a bubble or inline. With <code className="embeda__code">wallet:
          &lsquo;auto&rsquo;</code>, it uses the wallet already connected to the host page:
          signatures pop in the user&rsquo;s own wallet, and we never hold keys.
        </p>
      </div>

      <div className="embeda__grid">
        <div className="embeda__left">
          <div className="embeda__snippet">
            <div className="embeda__snipbar mono">
              <span>npm i yeetful</span>
              <span className="embeda__snipver">v0.9</span>
            </div>
            <pre className="embeda__pre mono">
              <code>{SNIPPET}</code>
            </pre>
            <Link href="/docs/embed" className="embeda__docs mono">
              Read the embed docs →
            </Link>
          </div>

          <div className="embeda__demos">
            {DEMOS.map((d) => (
              <a className="embeda__demo" href={d.url} target="_blank" rel="noreferrer" key={d.url}>
                <div className="embeda__demotop">
                  <span className="embeda__demoid">
                    <span className={`embeda__demologo ${d.logoClass}`}>{d.logo}</span>
                    <span className="embeda__demoname">{d.name}</span>
                  </span>
                  <span className="embeda__demohost mono">{d.host} ↗</span>
                </div>
                <p className="embeda__demoblurb">{d.blurb}</p>
                <span className="embeda__demotag mono">LIVE DEMO</span>
              </a>
            ))}
          </div>
        </div>

        <EmbedDemo />
      </div>

      {/* The loop TxPipeline used to carry (retired 2026-07-28 when the
          machine absorbed the pipeline): usage feeds the host's analytics,
          analytics feed upgrade prompts, upgrades feed more signed txs. It
          belongs to hosts, so it lives in the host section now. */}
      <div className="loopband">
        <div className="loopband__copy">
          <span className="loopband__eyebrow mono">
            IT LEARNS FROM YOUR USERS <b aria-hidden>⟲</b>
          </span>
          <h3 className="loopband__h3">
            Every dead end becomes an upgrade prompt for your MCP.
          </h3>
          <p className="loopband__sub">
            The chat records the asks it couldn&rsquo;t answer on your site — not the ones it
            aced. Those are the tools you&rsquo;re missing, ranked by how many people wanted them.
          </p>
        </div>
        <div className="loopband__demo mono" aria-hidden>
          <span className="loopband__dead">dead end · &ldquo;what&rsquo;s my balance on Base?&rdquo;</span>
          <span className="loopband__arrow">↓</span>
          <span className="loopband__fix">
            suggested: add a <b>balances</b> tool to your MCP
          </span>
          <span className="loopband__meta">asked 41× this week · 0 answered</span>
        </div>
      </div>

      <p className="embeda__disclaimer">
        Both demos are proof-of-concept forks of open-source interfaces, built to show the
        install. They are test cases only — not partnerships, and not affiliated with or
        endorsed by Uniswap Labs or CoW DAO. Logos identify the forked interfaces.
      </p>
      <p className="embeda__next mono">
        On the roadmap: the same agent in Discord · Telegram · X
      </p>
    </section>
  )
}
