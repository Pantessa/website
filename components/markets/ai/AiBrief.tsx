'use client'

// MK2/AI — the symbol brief (README "Slots": AiBrief). Placeholder for the
// first push; the streamed brief lands in this file this round.

import type { ChartPair, ChartTf } from '@/lib/charts'

export type AiBriefProps = { symbol: string; pair: ChartPair; tf?: ChartTf; onAsk: (ask: string) => void }

export default function AiBrief({ symbol }: AiBriefProps) {
  return (
    <section className="mk-ai mk-ai--brief" data-slot="AiBrief" data-lane="AI">
      <header className="mk-ai__head">
        <span className="mk-ai__title">Brief</span>
        <span className="mk-ai__eyebrow mono">AI · WRITING</span>
      </header>
      <p className="mk-ai__body">The {symbol} brief streams here.</p>
    </section>
  )
}
