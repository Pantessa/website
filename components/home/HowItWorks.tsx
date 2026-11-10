// HOW A SENTENCE BECOMES A SIGNED TRANSACTION — the landing's trust section
// (squad landing, 2026-11-10; lane CLOSE owns this file and how.css). It
// takes the seat the small "How a chart executes" card held at the bottom
// of the boards (components/markets/shell/MarketsIndex `how`).
//
// CONTRACT STUB: the old card's four steps, moved verbatim. The lane builds
// the real section: the path a sentence takes (say it → quote → a builder
// writes it → guards check it → you sign → the receipt), what Pantessa
// never does, and the fee lines from the snapshot — every number from
// `data`, never typed.
//
// A server component is fine here (no state needed); make it a client one
// only if it must move.

import SpineLink from '@/components/SpineLink'
import type { TourSnapshot } from '@/lib/home-tour'
import './how.css'

export default function HowItWorks({ data: _data }: { data?: TourSnapshot }) {
  return (
    <section className="how" aria-labelledby="how-title" data-how>
      <h2 id="how-title" className="how__title">
        How a chart executes
      </h2>
      <ol className="how__steps">
        <li>Pick a symbol. The candles are live and keyless.</li>
        <li>Tap a chip or write the sentence — “Buy $10 of AAPL”.</li>
        <li>Pantessa builds the guarded transaction. No model writes calldata.</li>
        <li>Your wallet signs. That signature is the only gate.</li>
      </ol>
      <p className="how__note">
        Non-custodial. No broker account, no KYC to look.{' '}
        <SpineLink href="/docs" className="how__link" prefetch={false} data-journey="How: docs">
          How it works →
        </SpineLink>
      </p>
    </section>
  )
}
