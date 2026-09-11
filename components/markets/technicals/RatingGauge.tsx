'use client'

// A theme-aware SVG rating gauge: five bands (strong sell → strong buy), a
// needle at the score, the word under it. Pure presentation — every color
// is a site token (--sell / --accent / --muted-2), so light and dark are
// free and no green is hardcoded (memory light-dark-theme-system).

import { RATING_LABELS, type Gauge, type Rating } from '@/lib/technicals'

const BANDS: { rating: Rating; color: string; dim: number }[] = [
  { rating: 'strong_sell', color: 'var(--sell)', dim: 1 },
  { rating: 'sell', color: 'var(--sell)', dim: 0.5 },
  { rating: 'neutral', color: 'var(--muted-2)', dim: 0.8 },
  { rating: 'buy', color: 'var(--accent)', dim: 0.5 },
  { rating: 'strong_buy', color: 'var(--accent)', dim: 1 },
]

export function ratingColor(rating: Rating): string {
  return rating === 'neutral' ? 'var(--muted)' : rating.endsWith('sell') ? 'var(--sell)' : 'var(--accent)'
}

const CX = 100
const CY = 100
const R = 82
const W = 14

function pt(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}

/** Arc path from angle a0 to a1 (degrees, 180 = left, 0 = right). */
function arc(a0: number, a1: number, r: number): string {
  const [x0, y0] = pt(a0, r)
  const [x1, y1] = pt(a1, r)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Score −1..1 → needle angle 180..0. */
export function needleAngle(score: number): number {
  const s = Math.max(-1, Math.min(1, Number.isFinite(score) ? score : 0))
  return 90 - s * 90
}

export default function RatingGauge({
  gauge,
  title,
  size = 'md',
  loading = false,
}: {
  gauge: Gauge | null
  title: string
  size?: 'md' | 'lg'
  loading?: boolean
}) {
  const rating = gauge?.rating ?? 'neutral'
  const angle = needleAngle(gauge?.score ?? 0)
  const [nx, ny] = pt(angle, R - W / 2 - 4)
  const width = size === 'lg' ? 260 : 200
  return (
    <div className="flex flex-col items-center" data-rating={rating} aria-label={`${title}: ${gauge ? RATING_LABELS[rating] : 'loading'}`}>
      <div className="mono text-[9.5px] uppercase tracking-[0.16em] text-[color:var(--muted-2)]">{title}</div>
      <svg viewBox="0 0 200 118" width={width} height={(width * 118) / 200} className="mt-1 overflow-visible" role="img" aria-hidden="true">
        {BANDS.map((b, i) => {
          const a0 = 180 - i * 36
          const a1 = a0 - 36
          const active = gauge && b.rating === rating
          return (
            <path
              key={b.rating}
              d={arc(a0 - 0.6, a1 + 0.6, R)}
              fill="none"
              stroke={b.color}
              strokeWidth={active ? W + 4 : W}
              strokeLinecap="butt"
              opacity={gauge ? (active ? 1 : b.dim * 0.45) : 0.18}
              style={{ transition: 'opacity .3s, stroke-width .3s' }}
            />
          )
        })}
        {/* tick marks at the band edges */}
        {[180, 144, 108, 72, 36, 0].map((a) => {
          const [x0, y0] = pt(a, R - W / 2 - 2)
          const [x1, y1] = pt(a, R + W / 2 + 2)
          return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--bg)" strokeWidth={2} />
        })}
        {/* needle */}
        <g style={{ transition: 'transform .5s cubic-bezier(.2,.8,.2,1)', transformOrigin: `${CX}px ${CY}px` }}>
          <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--fg)" strokeWidth={2.2} strokeLinecap="round" opacity={gauge ? 1 : 0.25} />
          <circle cx={CX} cy={CY} r={5} fill="var(--fg)" opacity={gauge ? 1 : 0.25} />
        </g>
        <text x={12} y={114} className="mono" fontSize={8.5} fill="var(--muted-2)" textAnchor="start">
          STRONG SELL
        </text>
        <text x={188} y={114} className="mono" fontSize={8.5} fill="var(--muted-2)" textAnchor="end">
          STRONG BUY
        </text>
      </svg>
      <div
        className={`-mt-1 font-semibold tracking-[-0.01em] ${size === 'lg' ? 'text-[24px]' : 'text-[19px]'}`}
        style={{ color: gauge ? ratingColor(rating) : 'var(--muted-2)', fontFamily: 'var(--font-fraunces, Fraunces, serif)' }}
      >
        {gauge ? RATING_LABELS[rating] : loading ? 'Reading the tape…' : '—'}
      </div>
      {gauge && (
        <div className="mono mt-1 flex items-center gap-3 text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
          <span>
            <b className="text-[color:var(--sell)]">{gauge.sell}</b> sell
          </span>
          <span>
            <b className="text-[color:var(--fg)]">{gauge.neutral}</b> neutral
          </span>
          <span>
            <b className="text-[color:var(--accent)]">{gauge.buy}</b> buy
          </span>
        </div>
      )}
    </div>
  )
}
