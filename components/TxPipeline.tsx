// The transaction layer — the edge, stated plainly. Five stops from plain
// English to an on-chain receipt, with the guardrail truths that make hosts
// willing to embed a chat that moves money. A slow pulse walks the rail.

const STOPS: { t: string; d: string }[] = [
  { t: 'Quote', d: 'A live quote from the venue — CoW by default, Uniswap when you say so.' },
  { t: 'Build', d: 'The exact transaction or EIP-712 order, constructed deterministically. Never freehand.' },
  { t: 'Guardrails', d: 'Spend policy re-fired per step. Over-cap gets dropped, not built. Denials are ledgered too.' },
  { t: 'Sign', d: 'Your wallet pops, on whatever page you’re on. We build only — never hold keys.' },
  { t: 'Receipt', d: 'Tx hash on every settlement, in a public ledger. Multi-step chains ride one card, re-quoted per step.' },
]

export default function TxPipeline() {
  return (
    <section className="txp">
      <div className="txp__head">
        <span className="txp__eyebrow mono">THE TRANSACTION LAYER</span>
        <h2 className="txp__h2">
          From &ldquo;swap this&rdquo; to a signed, receipted transaction.
        </h2>
        <p className="txp__sub">
          An agent that moves money should have to show its work. This one does — every step, every
          time, on every site it&rsquo;s embedded in.
        </p>
      </div>
      <ol className="txp__rail">
        {STOPS.map((s, i) => (
          <li className="txp__stop" key={s.t}>
            <span className="txp__n mono">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="txp__t">{s.t}</h3>
            <p className="txp__d">{s.d}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
