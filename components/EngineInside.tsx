'use client'

// The demoted engine section — the old Switchboard hero, kept lower on the
// page and retold for the pivot: sharp routing is the mechanism INSIDE your
// composed set (tool-to-endpoint picking + param filling), feeding the
// transaction builder. Full-bleed .heroweb visual with the AgentSetWeb
// animation (uniswap-free + snapshot-free merging into one agent).

import Link from 'next/link'
import AgentSetWeb from '@/components/AgentSetWeb'

export default function EngineInside() {
  return (
    <section className="heroweb heroweb--inside">
      <AgentSetWeb />
      <div className="heroweb__stage">
        <div className="heroweb__copy">
          <div className="heroweb__eyebrow mono">
            Sharp routing <span>·</span> the engine inside <b>your set</b>
          </div>
          <h2 className="heroweb__h1 heroweb__h1--h2">
            <span className="heroweb__grad">Two MCPs in.</span>
            <br />
            <span className="heroweb__em">One agent</span>{' '}
            <span className="heroweb__grad">out.</span>
          </h2>
          <p className="heroweb__lede">
            Inside every set, the sharp router reads the ask, picks the{' '}
            <strong>exact tool</strong> across your MCPs, and fills the params —{' '}
            <span className="heroweb__nokey">Uniswap for the swap, Snapshot for the vote</span> —
            then hands anything that moves money to the transaction builder. Over-cap asks get
            dropped, not built.
          </p>
          <div className="heroweb__ctas">
            <Link className="btn btn--solid" href="/chat">
              Open the chat
            </Link>
            <Link className="btn btn--ghost" href="/servers">
              Pick your MCPs
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
