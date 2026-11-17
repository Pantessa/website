'use client'

// The wallet's recurring buys (the DCA tile, wallet-level: no app owns it).
// In full / side density it is a short list under the apps; in the one-line
// posture it is one line. Each row's own asks (Buy now, Pause, Cancel) go to
// the chat.

import type { RowsTile } from '@/lib/splash/types'
import TokenIcon from '@/components/TokenIcon'
import { AskButton, Eyebrow, ListBlock, ListRow } from '@/components/apps/parts'

export default function Recurring({ tile, line, onAsk }: { tile: RowsTile | null; line?: boolean; onAsk: (text: string) => void }) {
  if (!tile || tile.rows.length === 0) return null
  const due = tile.rows.filter((r) => /due now/i.test(r.value ?? ''))
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
  return (
    <ListBlock title="Recurring buys" note={tile.headline ? `${tile.headline.value} ${tile.headline.caption}` : undefined} className="apg-recurring">
      {tile.rows.map((r) => {
        const act = r.actions?.[0]
        return (
          <ListRow
            key={`${r.label}|${r.sub ?? ''}`}
            lead={r.chartSymbol ? <TokenIcon symbol={r.chartSymbol} size={22} /> : undefined}
            main={r.label}
            sub={r.sub}
            value={r.value}
            actions={act ? <AskButton onClick={() => onAsk(act.prompt)}>{act.label}</AskButton> : undefined}
          />
        )
      })}
    </ListBlock>
  )
}
