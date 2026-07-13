// The transaction layer — shown, not argued. Left: the five stops, tight.
// Right: a stylized still of the embedded chat mid-transaction (pure CSS —
// no iframe, no spend) with the venue marks. The "chat that shows its work"
// section, doing exactly that.

const STOPS: { t: string; d: string }[] = [
  { t: 'Quote', d: 'Live from the venue — CoW by default, Uniswap when you say so.' },
  { t: 'Build', d: 'Exact calldata or EIP-712, deterministic. Never freehand.' },
  { t: 'Guardrails', d: 'Re-fired per step. Over-cap gets dropped, not built.' },
  { t: 'Sign', d: 'Your wallet pops. We never hold keys.' },
  { t: 'Receipt', d: 'Tx hash on every settlement, in a public ledger.' },
  { t: 'Learn', d: 'Every dead-end conversation becomes an upgrade suggestion for your MCPs.' },
]

export default function TxPipeline() {
  return (
    <section className="txp">
      <div className="txp__grid">
        <div className="txp__copy">
          <span className="txp__eyebrow mono">THE TRANSACTION LAYER</span>
          <h2 className="txp__h2">
            From &ldquo;swap this&rdquo; to a <span className="x-grad">signed, receipted</span>{' '}
            transaction.
          </h2>
          <p className="txp__sub">
            An agent that moves money should show its work — and learn from it. Every step
            receipted on every site it&rsquo;s embedded in; every miss studied, so your set gets
            sharper the more people use it.
          </p>
          <ol className="txp__steps">
            {STOPS.map((s, i) => (
              <li className="txp__step" key={s.t}>
                <span className="txp__n mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="txp__stepbody">
                  <strong>{s.t}</strong> <span>{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* the embed, mid-transaction — a stylized still, venue marks included */}
        <div className="txp__visual" aria-hidden="true">
          <div className="txp__vhead">
            <span className="txp__vbrand mono">
              <i /> Yeetful chat
            </span>
            <span className="txp__vmarks">
              <span className="txp__vmark txp__vmark--uni mono">
                <i>U</i> Uniswap
              </span>
              <span className="txp__vmark txp__vmark--snap mono">
                <i>⚡</i> Snapshot
              </span>
            </span>
          </div>
          <div className="txp__vbody">
            <div className="txp__vuser">Swap 100 USDC → WETH, then vote FOR the proposal</div>
            <div className="txp__vcard">
              <div className="txp__vrow mono">
                <span className="txp__vkind">⇄ swap built on Uniswap</span>
                <span className="txp__vamt">min 0.0521 WETH</span>
              </div>
              <div className="txp__vguard mono">✓ guardrails · under your $5/day cap</div>
              <span className="txp__vsign">✍ Sign in your wallet</span>
            </div>
            <div className="txp__vreceipt mono">🗳 vote cast on Snapshot · ✓ receipted · tx 0x9f2e…41c7 ↗</div>
          </div>

          {/* the loop closes: usage feeds the owner's analytics, analytics
              feed upgrade suggestions, upgrades feed more signed txs */}
          <div className="txp__loopline" />
          <div className="txp__loop">
            <div className="txp__loophead mono">
              <span>IT LEARNS FROM YOUR USERS</span>
              <span className="txp__loopback" aria-hidden="true">⟲</span>
            </div>
            <div className="txp__looprow mono">
              <span className="txp__loopdead">dead end · &ldquo;what&rsquo;s my balance on Base?&rdquo;</span>
            </div>
            <div className="txp__looprow mono">
              <span className="txp__loopfix">→ suggested: add a <b>balances</b> tool to your MCP</span>
            </div>
            <span className="txp__loopcta mono">Deep analytics &amp; MCP upgrade prompts → your dashboard</span>
          </div>
        </div>
      </div>
    </section>
  )
}
