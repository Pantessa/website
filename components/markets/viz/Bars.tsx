// Bars — horizontal bars for a ranked list of named magnitudes (venues,
// chains, pools). Each row: swatch + name, value, a track. Widths scale to
// the max; color follows the ENTITY (seriesVar(entity)), never the rank.

import { fmtCompact, seriesVar } from '@/lib/markets-look'

export interface BarRow {
  /** Stable entity id → stable color (e.g. 'uniswap', 'base'). */
  id: string
  name: string
  value: number
  /** Pre-formatted value text; default fmtCompact. */
  text?: string
  color?: string
}

export interface BarsProps {
  rows: readonly BarRow[]
  usd?: boolean
  max?: number
  className?: string
}

export default function Bars({ rows, usd = false, max, className = '' }: BarsProps) {
  const top = max ?? Math.max(0, ...rows.map((r) => (Number.isFinite(r.value) ? r.value : 0)))
  return (
    <div className={`mk-bars ${className}`.trim()} role="list">
      {rows.map((r) => {
        const color = r.color ?? seriesVar(r.id)
        const pct = top > 0 ? Math.max(0, Math.min(100, (r.value / top) * 100)) : 0
        return (
          <div key={r.id} className="mk-bars__row" role="listitem">
            <span className="mk-bars__name">
              <i className="mk-bars__swatch" style={{ background: color }} aria-hidden="true" />
              <span>{r.name}</span>
            </span>
            <span className="mk-bars__val">{r.text ?? fmtCompact(r.value, { usd })}</span>
            <div className="mk-bars__track" aria-hidden="true">
              <div className="mk-bars__fill" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
