// Compose-your-set — the recipes. Static server component: three curated
// combos (each maps to shipped capability) plus the bring-your-own card.
// The combo is the pitch: each set unlocks turns no single dapp can do.

import Link from 'next/link'

const RECIPES: {
  chips: string[]
  title: string
  ask: string
  unlocks: string
}[] = [
  {
    chips: ['Uniswap', 'Snapshot'],
    title: 'Trade + govern',
    ask: '“Swap 1 USDC to WETH, then vote FOR the treasury proposal.”',
    unlocks: 'One conversation quotes the swap, builds the tx, and signs the EIP-712 vote — two dapps, one turn.',
  },
  {
    chips: ['CoW Protocol', 'CoW docs'],
    title: 'Trade + explain',
    ask: '“Quote 100 USDC → WETH — and how does MEV protection work here?”',
    unlocks: 'Live quotes next to answers pulled from the protocol’s own docs. Ship your docs with your MCP and the agent answers from the latest push.',
  },
  {
    chips: ['Hyperliquid', 'Uniswap'],
    title: 'Positions + trade',
    ask: '“How’s my ETH perp doing — and swap 500 USDC to ETH on Base.”',
    unlocks: 'Positions and funding from one MCP, a built-to-sign swap from another — read-only is $0, you sign the rest.',
  },
]

export default function ComposeSet() {
  return (
    <section className="compose">
      <div className="compose__head">
        <span className="compose__eyebrow mono">COMPOSE YOUR SET</span>
        <h2 className="compose__h2">Pick two or three MCPs. Get <span className="x-grad">one agent.</span></h2>
        <p className="compose__sub">
          Combine our free first-party MCPs, anything in the directory, or bring your own. The
          combo is the point — each set unlocks turns no single dapp can do.
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
            <p className="compose__ask mono">{r.ask}</p>
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
