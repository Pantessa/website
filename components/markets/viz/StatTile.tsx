// StatTile — one headline number with its label, an optional delta, note and
// sparkline; the receipt rule under it. The "is it even a chart?" answer for
// a single value (dataviz: hero number).

import type { ReactNode } from 'react'
import Delta from './Delta'
import Sparkline from './Sparkline'

export interface StatTileProps {
  label: string
  /** Pre-formatted (the caller owns units) — or a node for a custom value. */
  value: ReactNode
  pct?: number | null
  delta?: number | null
  /** One short line under the number: source, as-of, unit. */
  note?: ReactNode
  spark?: readonly number[]
  /** Drop the receipt rule (when the tile sits in a ruled row already). */
  noRule?: boolean
  className?: string
}

export default function StatTile({ label, value, pct, delta, note, spark, noRule = false, className = '' }: StatTileProps) {
  return (
    <div className={`mk-stat ${noRule ? '' : 'mk-receipt'} ${className}`.trim()}>
      <span className="mk-label">{label}</span>
      <div className="mk-stat__row">
        <span className="mk-stat__value">{value}</span>
        {pct !== undefined || delta !== undefined ? <Delta pct={pct} value={delta} /> : null}
        {spark && spark.length >= 2 ? <Sparkline values={spark} width={64} height={20} /> : null}
      </div>
      {note ? <span className="mk-stat__note">{note}</span> : null}
    </div>
  )
}
