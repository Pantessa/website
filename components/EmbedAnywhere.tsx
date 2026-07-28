// Embed anywhere — the distribution story, told the way the rest of the
// landing tells things now: the install ASSEMBLES (EmbedAssemble types the
// five real lines and builds the widget in a host window beside them, one
// capability per line) instead of sitting next to a static screenshot. The
// docs landing keeps EmbedDemo, which shows the widget's behaviour rather
// than its install — different job, different page.
//
// Under it: the two live fork demos (proof-of-concept forks of open-source
// interfaces — labelled clearly as test cases: no partnership, no
// endorsement; protocol logos are Nate-directed, 2026-07-09, vendored from
// the fork repos) and the learning loop, which is a host's payoff.

import EmbedAssemble from '@/components/EmbedAssemble'
import { UniswapMark, CowMark } from '@/components/protocol-marks'

const DEMOS: { name: string; url: string; host: string; blurb: string; logo: React.ReactNode; logoClass: string }[] = [
  {
    name: 'Uniswap interface + Yeetful chat',
    url: 'https://uniswap-embed.yeetful.com/',
    host: 'uniswap-embed.yeetful.com',
    blurb:
      'A fork of the open-source Uniswap interface with the chat mounted in ~25 lines. It auto-connects the page’s wallet, answers with your address, and quotes WETH→USDC through the free MCP.',
    logo: <UniswapMark />,
    logoClass: 'embeda__demologo--uni',
  },
  {
    name: 'CoW Swap + Yeetful chat',
    url: 'https://cow-embed.yeetful.com/',
    host: 'cow-embed.yeetful.com',
    blurb:
      'A fork of the open-source CoW Swap interface. The widget streams the connected wallet into the chat; quotes and MEV-docs answers run through the CoW MCP.',
    logo: <CowMark />,
    logoClass: 'embeda__demologo--cow',
  },
]

export default function EmbedAnywhere() {
  return (
    <section className="embeda">
      <div className="embeda__head">
        <span className="embeda__eyebrow mono">EMBED ANYWHERE</span>
        <h2 className="embeda__h2">
          Embed the <span className="x-grad">whole agent</span> on your site. Five lines.
        </h2>
        <p className="embeda__sub">
          Not a support widget with a payments tab bolted on — the same chat that scans, funds,
          builds, guard-checks and receipts, mounted on your page. Watch each line buy something:
          a bubble, a set of dapps, and the wallet your visitors already connected.
        </p>
      </div>

      <EmbedAssemble />

      {/* real forks, running right now — the install claim, kept honest */}
      <div className="embeda__demos">
        {DEMOS.map((d) => (
          <a className="embeda__demo" href={d.url} target="_blank" rel="noreferrer" key={d.url}>
            <div className="embeda__demotop">
              <span className="embeda__demoid">
                <span className={`embeda__demologo ${d.logoClass}`}>{d.logo}</span>
                <span className="embeda__demoname">{d.name}</span>
              </span>
              <span className="embeda__demotag mono">LIVE DEMO</span>
            </div>
            <p className="embeda__demoblurb">{d.blurb}</p>
            <span className="embeda__demohost mono">{d.host} ↗</span>
          </a>
        ))}
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
