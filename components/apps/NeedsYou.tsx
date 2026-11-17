'use client'

// NEEDS YOU: the wallet briefing's rows that ask for something (a position
// with no stop, money earning nothing, a buy that is due), flat at the top
// of the page whatever the apps are. One sentence, one button each; the
// button hands the row's own ask to the chat. Rows with no action are
// observations and never show here (lib/apps-page needsYouRows).

import type { StatRow } from '@/lib/splash/types'
import { AskButton, Eyebrow } from '@/components/apps/parts'

export default function NeedsYou({ rows, onAsk }: { rows: StatRow[]; onAsk: (text: string) => void }) {
  if (rows.length === 0) return null
  return (
    <section className="apg-needs" data-apps-needs={rows.length} aria-label="Needs you">
      <Eyebrow tone="needs">Needs you</Eyebrow>
      {rows.map((r) => {
        const act = r.actions?.[0]
        return (
          <div key={`${r.label}|${r.sub ?? ''}`} className="apg-needs__row">
            <p className="apg-needs__text">
              {r.label}
              {r.value ? <span className="apg-needs__value"> {r.value}</span> : null}
              {r.sub ? <span className="apg-muted"> {r.sub}</span> : null}
            </p>
            {act && (
              <AskButton strong onClick={() => onAsk(act.prompt)} title={act.prompt}>
                {act.label}
              </AskButton>
            )}
          </div>
        )
      })}
    </section>
  )
}
