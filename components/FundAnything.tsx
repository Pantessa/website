// The universal funding plan — the onboarding story, shown as one real turn.
// "Buy $2 of AAPL" with an empty Robinhood Chain wallet: the agent scans
// every chain, sizes the move (gas included), bridges, waits for settlement,
// and finishes the buy — one job, every step guard-checked, the user's own
// wallet signs everything. Left: a stylized CSS still of that exact turn
// (no iframe, no spend — same treatment as TxPipeline's visual). Right: the
// claim + the doctrine + the deep link to run the real prompt in /chat.
// Sits between TxPipeline (guarded builds) and EmbedAnywhere (distribution)
// because it IS the bridge: builds so safe they can fix their own funding,
// on any site the chat is embedded in.

import Link from 'next/link'

/** The exact prompt the CTA lands in the /chat composer (prefill, never
 *  auto-send) — with the Robinhood MCP preselected via ?mcps=. */
const TRY_PROMPT = 'Buy $2 of AAPL'
const TRY_HREF = `/chat?mcps=robinhood-free&prompt=${encodeURIComponent(TRY_PROMPT)}`

const DOCTRINE: { t: string; d: string }[] = [
  { t: 'Scans, then offers', d: 'Reads ETH + USDC across Base, Arbitrum and Ethereum — and answers with choices, not a lecture.' },
  { t: 'Gas rides along', d: 'A wallet that can’t pay for the follow-up gets a gas leg first. Funds never land where they’d strand.' },
  { t: 'One job, your signatures', d: 'Bridge → settle → act, compiled as one job. Each step is rebuilt and guard-checked when it’s your turn to sign.' },
  { t: 'Any MCP, same net', d: 'Works for stakes, deposits, supplies, swaps — and the MCPs your users bring. Honest numbers when the wallet truly can’t cover it.' },
]

export default function FundAnything() {
  return (
    <section className="fundx" id="funding">
      <div className="fundx__grid">
        {/* the turn itself — a stylized still of the funding plan running */}
        <div className="fundx__visual" aria-hidden="true">
          <div className="fundx__vhead">
            <span className="fundx__vbrand mono">
              <i /> Yeetful chat · any site
            </span>
            <span className="fundx__vwallet mono">0x5E…55a0 · 0 USDG</span>
          </div>
          <div className="fundx__vbody">
            <div className="fundx__vuser">Buy $2 of AAPL</div>
            <div className="fundx__voffer">
              <p>
                You don&rsquo;t have USDG on Robinhood Chain yet — but you&rsquo;re holding{' '}
                <strong>$9.77 of USDC on Base</strong>. I can move it over, drop in a little ETH
                for gas, and buy the AAPL — one job, signed step by step.
              </p>
              <div className="fundx__vchips">
                <span className="fundx__vchip fundx__vchip--hot mono">Just enough (~$4.50)</span>
                <span className="fundx__vchip mono">All of it ($9)</span>
                <span className="fundx__vchip mono">Not now</span>
              </div>
            </div>
            <ol className="fundx__vjob mono">
              <li className="fundx__vstep fundx__vstep--done">
                <i>✓</i> Bridge $1.50 → gas ETH on Robinhood Chain
              </li>
              <li className="fundx__vstep fundx__vstep--done">
                <i>✓</i> Move $3 of Base USDC → USDG <em>· arrived in 14s</em>
              </li>
              <li className="fundx__vstep fundx__vstep--live">
                <i>✍</i> Buy ~$2 of AAPL <em>· sign in your wallet</em>
              </li>
            </ol>
            <div className="fundx__vreceipt mono">✓ 0.0062 AAPL settled on Robinhood Chain · tx 0x8c1d…9a2f ↗</div>
          </div>
        </div>

        <div className="fundx__copy">
          <span className="fundx__eyebrow mono">THE FUNDING LAYER</span>
          <h2 className="fundx__h2">
            &ldquo;Insufficient funds&rdquo; isn&rsquo;t an answer. <span className="x-grad">It&rsquo;s a to-do list.</span>
          </h2>
          <p className="fundx__sub">
            Your users show up with money on the wrong chain — that&rsquo;s not an edge case,
            that&rsquo;s onboarding. Ask for $2 of AAPL with an empty Robinhood Chain wallet and the
            agent scans every chain, sizes the move with gas included, bridges, waits for
            settlement, and finishes the buy. Their wallet signs every step; nothing moves
            without them.
          </p>
          <ul className="fundx__points">
            {DOCTRINE.map((p) => (
              <li className="fundx__point" key={p.t}>
                <strong>{p.t}</strong> <span>{p.d}</span>
              </li>
            ))}
          </ul>
          <div className="fundx__ctas">
            <Link href={TRY_HREF} className="fundx__cta">
              Try &ldquo;{TRY_PROMPT}&rdquo; →
            </Link>
            <Link href="/blog/one-sentence-four-transactions" className="fundx__cta2">
              How one sentence becomes four transactions
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
