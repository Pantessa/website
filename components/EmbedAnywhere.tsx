// Embed anywhere — the distribution story. The real 5-line install (SDK 0.9,
// wallet:'auto' = the HOST page's wallet signs), plus the two live fork
// demos. The demos are proof-of-concept forks of open-source interfaces —
// label them clearly as test cases: no partnership, no endorsement.

import Link from 'next/link'

const SNIPPET = `import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  mode: 'bubble',
  mcps: ['uniswap-free', 'snapshot-free'],
  wallet: 'auto', // the host page's wallet signs
})`

const DEMOS: { name: string; url: string; host: string; blurb: string }[] = [
  {
    name: 'Uniswap interface + Yeetful chat',
    url: 'https://uniswap-embed.yeetful.com/',
    host: 'uniswap-embed.yeetful.com',
    blurb: 'A fork of the open-source Uniswap interface with the chat mounted in ~25 lines. It auto-connects the page’s wallet, answers with your address, and quotes WETH→USDC through the free MCP.',
  },
  {
    name: 'CoW Swap + Yeetful chat',
    url: 'https://cow-embed.yeetful.com/',
    host: 'cow-embed.yeetful.com',
    blurb: 'A fork of the open-source CoW Swap interface. The widget streams the connected wallet into the chat; quotes and MEV-docs answers run through the CoW MCP.',
  },
]

export default function EmbedAnywhere() {
  return (
    <section className="embeda">
      <div className="embeda__head">
        <span className="embeda__eyebrow mono">EMBED ANYWHERE</span>
        <h2 className="embeda__h2">Five lines. Any site. <span className="x-grad">Mega apps</span> in minutes.</h2>
        <p className="embeda__sub">
          <code className="embeda__code">yeetful/embed</code> mounts the full chat — receipts,
          guardrails, signing — as a bubble or inline. With <code className="embeda__code">wallet:
          &lsquo;auto&rsquo;</code>, it uses the wallet already connected to the host page:
          signatures pop in the user&rsquo;s own wallet, and we never hold keys.
        </p>
      </div>

      <div className="embeda__grid">
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
                <span className="embeda__demoname">{d.name}</span>
                <span className="embeda__demohost mono">{d.host} ↗</span>
              </div>
              <p className="embeda__demoblurb">{d.blurb}</p>
              <span className="embeda__demotag mono">LIVE DEMO</span>
            </a>
          ))}
          <p className="embeda__disclaimer">
            Both demos are proof-of-concept forks of open-source interfaces, built to show the
            install. They are test cases only — not partnerships, and not affiliated with or
            endorsed by Uniswap Labs or CoW DAO.
          </p>
          <p className="embeda__next mono">
            On the roadmap: the same agent in Discord · Telegram · X
          </p>
        </div>
      </div>
    </section>
  )
}
