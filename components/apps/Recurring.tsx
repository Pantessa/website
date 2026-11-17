'use client'

// The wallet's recurring buys (the DCA tile, wallet-level: no app owns it).
// In full / side density it is a short list under the apps: what the calendar
// commits a month, then each schedule with the ones that are due first and
// their own "run it" ask as the strong button; Pause / Cancel sit behind the
// row's More. In the one-line posture it is one line. Every button is the
// row's own ask (never a new recurring-buy suggestion).

import { useState } from 'react'
import type { RowsTile } from '@/lib/splash/types'
import TokenIcon from '@/components/TokenIcon'
import { AskButton, Eyebrow } from '@/components/apps/parts'
import { RowActs, RowBand } from '@/components/apps/sections/uniswap'
import { dueFirst, isDueRow, recurringMonthly, recurringSentence } from '@/lib/apps-portfolio'
import './portfolio.css'

export default function Recurring({ tile, line, onAsk }: { tile: RowsTile | null; line?: boolean; onAsk: (text: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!tile || tile.rows.length === 0) return null
  const due = tile.rows.filter(isDueRow)
  if (line) {
    const first = due[0]?.actions?.[0]
    return (
      <div className="apg-line" data-apps-line="recurring">
        <span className="apg-line__app">
          <Eyebrow tone={due.length ? 'idle' : undefined}>Recurring buys</Eyebrow>
        </span>
        <p className="apg-line__text">
          {due.length > 0 ? `${due.length} of ${tile.rows.length} recurring buys ${due.length === 1 ? 'is' : 'are'} due.` : `${tile.rows.length} recurring buys, none due.`}
        </p>
        {first && (
          <AskButton onClick={() => onAsk(first.prompt)} className="apg-line__act">
            {first.label}
          </AskButton>
        )}
      </div>
    )
  }
  const monthly = recurringMonthly(tile)
  return (
    <section className="apgp-rec" data-apgp-recurring={tile.rows.length} aria-label="Recurring buys">
      <div className="apgp-listhead">
        <Eyebrow tone={due.length ? 'idle' : undefined}>Recurring buys</Eyebrow>
        <span className="apgp-listhead__note">
          {recurringSentence(tile)}
          {monthly ? ` ${monthly} on the calendar.` : ''}
        </span>
      </div>
      <div className="apgp-rec__rows">
        {dueFirst(tile.rows).map((r) => {
          const id = `${r.label}|${r.sub ?? ''}`
          const isDue = isDueRow(r)
          const acts = r.actions ?? []
          const expanded = open === id
          return (
            <div key={id} className="apgp-hrow" data-due={isDue || undefined}>
              <div className="apgp-rec__tr">
                <span className="apgp-asset">
                  {r.chartSymbol ? <TokenIcon symbol={r.chartSymbol} size={26} /> : <span className="apgp-thumb--letter apgp-recmark" aria-hidden />}
                  <span className="apgp-asset__text">
                    <span className="apgp-asset__sym">{r.label}</span>
                    {r.sub && <span className="apgp-tag">{r.sub.replace(/^on /, '')}</span>}
                  </span>
                </span>
                <span className={`apgp-rec__state${isDue ? ' apgp-rec__state--due' : ''}`}>{r.value}</span>
                <span className="apgp-c-act">
                  <RowActs actions={acts} onAsk={onAsk} strong={isDue} open={expanded} onToggle={() => setOpen(expanded ? null : id)} />
                </span>
              </div>
              {expanded && <RowBand actions={acts.slice(1)} onAsk={onAsk} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}
