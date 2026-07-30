// Embed anywhere — the distribution story, told the way the rest of the
// landing tells things now: the install ASSEMBLES (EmbedAssemble types the
// five real lines and builds the widget in a host window beside them, one
// capability per line) instead of sitting next to a static screenshot. The
// docs landing keeps EmbedDemo, which shows the widget's behaviour rather
// than its install — different job, different page.
//
// Under it: the learning loop, which is a host's payoff. (The two live fork
// demos — forks of the Uniswap and CoW Swap interfaces with the chat mounted
// — were REMOVED 2026-07-30 at Nate's direction after a trademark flag. Do
// not reinstate third-party-branded demos here; the install claim is carried
// by EmbedAssemble, which uses nobody else's marks.)

import EmbedAssemble from '@/components/EmbedAssemble'

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

      <p className="embeda__next mono">
        On the roadmap: the same agent in Discord · Telegram · X
      </p>
    </section>
  )
}
