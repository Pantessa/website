// Ribbon — a 100%-stacked strip of named shares (where the money sits
// across venues/chains), with a legend so identity is never color-alone.
// A 2px surface gap separates segments (dataviz mark spec).

import { fmtCompact, seriesVar } from '@/lib/markets-look'

export interface RibbonSeg {
  id: string
  name: string
  value: number
  color?: string
}

export interface RibbonProps {
  segs: readonly RibbonSeg[]
  usd?: boolean
  legend?: boolean
  height?: number
  className?: string
}

export default function Ribbon({ segs, usd = false, legend = true, height = 14, className = '' }: RibbonProps) {
  const live = segs.filter((s) => Number.isFinite(s.value) && s.value > 0)
  const total = live.reduce((a, s) => a + s.value, 0)
  return (
    <div className={className}>
      <div className="mk-ribbon" style={{ height }} role="img" aria-label={live.map((s) => `${s.name} ${total ? Math.round((s.value / total) * 100) : 0}%`).join(', ')}>
        {/* Keyed by seat as well as id: one venue can hold several segments (Uniswap on four chains). */}
        {live.map((s, i) => (
          <div key={`${s.id}:${i}`} className="mk-ribbon__seg" style={{ flex: `${s.value} 1 0%`, background: s.color ?? seriesVar(s.id) }} title={`${s.name} · ${fmtCompact(s.value, { usd })}`} />
        ))}
      </div>
      {legend && live.length ? (
        <div className="mk-ribbon__legend">
          {live.map((s, i) => (
            <span key={`${s.id}:${i}`}>
              <i style={{ background: s.color ?? seriesVar(s.id) }} aria-hidden="true" />
              {s.name}
              <span className="mk-num" style={{ color: 'var(--muted-2)' }}>
                {total ? `${Math.round((s.value / total) * 100)}%` : '—'}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
