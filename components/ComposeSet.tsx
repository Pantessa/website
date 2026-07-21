// Compose-your-set — the recipes. Static server component: three curated
// combos (each maps to shipped capability) plus the bring-your-own card.
// The combo is the pitch: each set unlocks turns no single dapp can do.

import Link from 'next/link'

const RECIPES: {
  chips: string[]
  title: string
  ask: string
  /** The ask, plain, prefilled into /chat (never auto-sends). */
  prompt: string
  /** Free-fleet slugs toggled on when the visitor lands in /chat. */
  mcps: string
  unlocks: string
}[] = [
  {
    chips: ['Uniswap', 'Snapshot'],
    title: 'Trade + govern',
    ask: '“Swap 1 USDC to WETH, then vote FOR the treasury proposal.”',
    prompt: 'Swap 1 USDC to WETH, then vote FOR the treasury proposal',
    mcps: 'uniswap-free,snapshot-free',
    unlocks: 'One conversation quotes the swap, builds the tx, and signs the EIP-712 vote — two dapps, one turn.',
  },
  {
    chips: ['CoW Protocol', 'CoW docs'],
    title: 'Trade + explain',
    ask: '“Quote 100 USDC → WETH — and how does MEV protection work here?”',
    prompt: 'Quote 100 USDC to WETH — and how does MEV protection work here?',
    mcps: 'cow-free',
    unlocks: 'Live quotes next to answers pulled from the protocol’s own docs. Ship your docs with your MCP and the agent answers from the latest push.',
  },
  {
    chips: ['Hyperliquid', 'Uniswap'],
    title: 'Positions + trade',
    ask: '“How’s my ETH perp doing — and swap 500 USDC to ETH on Base.”',
    prompt: "How's my ETH perp doing — and swap 500 USDC to ETH on Base",
    mcps: 'hyperliquid-free,uniswap-free',
    unlocks: 'Positions and funding from one MCP, a built-to-sign swap from another — read-only is $0, you sign the rest.',
  },
]

export default function ComposeSet() {
  return (
    <section className="compose">
      <div className="compose__head">
        <span className="compose__eyebrow mono">COMPOSE YOUR SET</span>
        <h2 className="compose__h2">The <span className="x-grad">combo</span> is the point.</h2>
        <p className="compose__sub">
          Pick two or three MCPs — the free fleet, the directory, or bring your own. Each set
          unlocks turns no single dapp can do.
        </p>
      </div>
      <div className="compose__grid">
        {RECIPES.map((r) => (
          <article className="compose__card" key={r.title}>
            <div className="compose__chips">
              {r.chips.map((c, i) => (
                <span key={c} className="compose__chiprow">
                  {i > 0 && <span className="compose__plus mono">+</span>}
                  <span className="compose__chip mono">{c}</span>
                </span>
              ))}
            </div>
            <h3 className="compose__title">{r.title}</h3>
            <Link
              className="compose__ask compose__ask--link mono"
              href={`/chat?mcps=${r.mcps}&prompt=${encodeURIComponent(r.prompt)}`}
              title="Opens the chat with this ask prefilled — nothing sends until you do"
            >
              {r.ask}
              <span className="compose__try mono" aria-hidden="true">
                try it →
              </span>
            </Link>
            <p className="compose__unlocks">{r.unlocks}</p>
          </article>
        ))}
        <article className="compose__card compose__card--byo">
          <div className="compose__chips">
            <span className="compose__chip compose__chip--dashed mono">your MCP</span>
          </div>
          <h3 className="compose__title">Bring your own</h3>
          <p className="compose__unlocks">
            Any MCP that speaks tools can join a set. We grade routability — schemas, params,
            docs — and tell you exactly what to fix so agents can actually drive it.
          </p>
          <Link href="/servers/add" className="compose__link mono">
            Add your MCP →
          </Link>
        </article>
      </div>
    </section>
  )
}
