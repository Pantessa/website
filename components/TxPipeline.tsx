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
            An agent that moves money should have to show its work. This one does — every step,
            every time, on every site it&rsquo;s embedded in.
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
              <span className="txp__vmark mono" style={{ ['--pc' as string]: '#FF6BAF' }}>
                <i>U</i> Uniswap
              </span>
              <span className="txp__vmark mono" style={{ ['--pc' as string]: '#7AA7FF' }}>
                <i>C</i> CoW
              </span>
            </span>
          </div>
          <div className="txp__vbody">
            <div className="txp__vuser">Swap 100 USDC → WETH, best price</div>
            <div className="txp__vcard">
              <div className="txp__vrow mono">
                <span className="txp__vkind">⇄ CoW order built</span>
                <span className="txp__vamt">min 0.0521 WETH</span>
              </div>
              <div className="txp__vguard mono">✓ guardrails · under your $5/day cap</div>
              <span className="txp__vsign">✍ Sign in your wallet</span>
            </div>
            <div className="txp__vreceipt mono">✓ receipted · tx 0x9f2e…41c7 · Basescan ↗</div>
          </div>
        </div>
      </div>
    </section>
  )
}
