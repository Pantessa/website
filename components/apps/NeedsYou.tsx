'use client'

// NEEDS YOU: the wallet briefing's rows that ask for something (a position
// with no stop, money earning nothing, a buy that is due), flat at the top
// of the page whatever the apps are. One sentence per row (lib/apps-portfolio
// needsPieces), the row's first ask as the strong outlined button, a second
// as a quiet one, and the token's 30-day line when the row is about a token.
// Buttons hand the row's own asks to the chat. Rows with no action never show
// here (lib/apps-page needsYouRows).

import { useState } from 'react'
import type { StatRow } from '@/lib/splash/types'
import { AskButton, Eyebrow } from '@/components/apps/parts'
import { Sparkline } from '@/components/splash/Sparkline'
import TokenIcon from '@/components/TokenIcon'
import { needsPieces, rowTokenOf } from '@/lib/apps-portfolio'
import './portfolio.css'

/** Rows shown before "Show N more": the strip must never push the open
 *  apps' own content off the first screen (four rows did, on a real wallet). */
export const NEEDS_SHOWN = 2

export default function NeedsYou({ rows: allRows, onAsk }: { rows: StatRow[]; onAsk: (text: string) => void }) {
  const [all, setAll] = useState(false)
  if (allRows.length === 0) return null
  const rows = all ? allRows : allRows.slice(0, NEEDS_SHOWN)
  const hidden = allRows.length - rows.length
  return (
    <section className="apg-needs apgp-needs" data-apps-needs={allRows.length} aria-label="Needs you">
      <Eyebrow tone="needs">{allRows.length === 1 ? 'Needs you' : `${allRows.length} things need you`}</Eyebrow>
      {rows.map((r) => {
        const [first, second] = r.actions ?? []
        const token = rowTokenOf(r)
        const p = needsPieces(r)
        return (
          <div key={`${r.label}|${r.sub ?? ''}`} className="apgp-needs__row">
            {token ? (
              <span className="apgp-needs__mark">
                <TokenIcon symbol={token} size={26} />
              </span>
            ) : (
              <span aria-hidden className="apgp-needs__mark apgp-needs__mark--dot">
                <span className="apg-dot apg-dot--needs" />
              </span>
            )}
            <p className="apgp-needs__text">
              <span>{p.lead}</span>
              {p.value && <span className="apgp-needs__value"> {p.value}</span>}
              {p.sub && <span className="apgp-muted"> {p.sub}</span>}
            </p>
            {token && (
              <span className="apgp-needs__spark">
                <Sparkline symbol={token} width={84} height={26} />
              </span>
            )}
            <span className="apgp-needs__acts">
              {second && (
                <AskButton onClick={() => onAsk(second.prompt)} title={second.prompt} className="apgp-btn apgp-btn--quiet">
                  {second.label}
                </AskButton>
              )}
              {first && (
                <AskButton strong onClick={() => onAsk(first.prompt)} title={first.prompt} className="apgp-btn">
                  {first.label}
                </AskButton>
              )}
            </span>
          </div>
        )
      })}
      {(hidden > 0 || all) && allRows.length > NEEDS_SHOWN && (
        <button type="button" className="apg-more" aria-expanded={all} onClick={() => setAll((v) => !v)} data-apps-needs-more="">
          {all ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}
