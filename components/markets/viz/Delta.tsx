// Delta — a signed change wearing the up/down/flat ink, with an arrow so the
// direction is never color-alone. Pass a percent (`pct`) or an absolute
// (`value`) or both; null renders "—" in the flat ink.

import { deltaTone, fmtPct, fmtCompact } from '@/lib/markets-look'

export interface DeltaProps {
  pct?: number | null
  value?: number | null
  /** Prefix `$` on the absolute value. */
  usd?: boolean
  digits?: number
  /** Soft-pill background. */
  pill?: boolean
  /** Hide the arrow glyph (the parent draws its own cue). */
  noArrow?: boolean
  className?: string
}

export default function Delta({ pct, value, usd = true, digits = 2, pill = false, noArrow = false, className = '' }: DeltaProps) {
  const basis = pct ?? value
  const tone = deltaTone(basis)
  const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : '·'
  const parts: string[] = []
  if (value != null && Number.isFinite(value)) parts.push(`${value > 0 ? '+' : ''}${fmtCompact(value, { usd, digits })}`)
  if (pct != null && Number.isFinite(pct)) parts.push(fmtPct(pct, { digits }))
  const text = parts.length ? parts.join(' ') : '—'
  return (
    <span className={`mk-delta mk-${tone} ${pill ? 'mk-delta--pill' : ''} ${className}`.trim()} data-tone={tone}>
      {noArrow ? null : (
        <span className="mk-delta__arrow" aria-hidden="true">
          {arrow}
        </span>
      )}
      <span>{text}</span>
    </span>
  )
}
