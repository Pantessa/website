'use client'

// NEEDS YOU: the wallet briefing's rows that ask for something (a position
// with no stop, money earning nothing, a buy that is due), flat at the top
// of the page whatever the apps are. One sentence per row (lib/apps-portfolio
// needsPieces), the row's first ask as the strong outlined button, a second
// as a quiet one, and the token's 30-day line when the row is about a token.
// Buttons hand the row's own asks to the chat. Rows with no action never show
// here (lib/apps-page needsYouRows).

import type { StatRow } from '@/lib/splash/types'
import { AskButton, Eyebrow } from '@/components/apps/parts'
import { Sparkline } from '@/components/splash/Sparkline'
import TokenIcon from '@/components/TokenIcon'
import { needsPieces, rowTokenOf } from '@/lib/apps-portfolio'
import './portfolio.css'

export default function NeedsYou({ rows, onAsk }: { rows: StatRow[]; onAsk: (text: string) => void }) {
  if (rows.length === 0) return null
  return (
    <section className="apg-needs apgp-needs" data-apps-needs={rows.length} aria-label="Needs you">
      <Eyebrow tone="needs">{rows.length === 1 ? 'Needs you' : `${rows.length} things need you`}</Eyebrow>
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
    </section>
  )
}
