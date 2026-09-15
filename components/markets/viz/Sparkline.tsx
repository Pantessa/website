'use client'

// Sparkline — a tiny line (optionally area-filled) for a series of numbers.
// Theme-aware through tokens; no deps. The line's ink defaults to the delta
// tone of last-vs-first (up/down/flat) unless `color` is given.

import { deltaVar } from '@/lib/markets-look'

export interface SparklineProps {
  values: readonly number[]
  width?: number
  height?: number
  /** CSS color; default = up/down ink by last-vs-first. */
  color?: string
  /** Soft area fill under the line. */
  area?: boolean
  strokeWidth?: number
  /** Draws a dot on the last point. */
  endDot?: boolean
  className?: string
  title?: string
}

export function sparkPath(values: readonly number[], w: number, h: number, pad = 1): { d: string; last: { x: number; y: number } | null } {
  const v = values.filter((n) => Number.isFinite(n))
  if (v.length < 2) return { d: '', last: null }
  let lo = Infinity
  let hi = -Infinity
  for (const n of v) {
    if (n < lo) lo = n
    if (n > hi) hi = n
  }
  const span = hi - lo || 1
  const step = (w - pad * 2) / (v.length - 1)
  const pts = v.map((n, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (n - lo) / span)] as const)
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return { d, last: { x: lx, y: ly } }
}

export default function Sparkline({ values, width = 80, height = 24, color, area = false, strokeWidth = 1.5, endDot = false, className, title }: SparklineProps) {
  const { d, last } = sparkPath(values, width, height)
  const ink = color ?? deltaVar(values.length >= 2 ? values[values.length - 1] - values[0] : 0)
  if (!d) return <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />
  return (
    <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      {area ? <path d={`${d} L${width - 1} ${height - 1} L1 ${height - 1} Z`} fill={ink} opacity={0.12} /> : null}
      <path d={d} fill="none" stroke={ink} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {endDot && last ? <circle cx={last.x} cy={last.y} r={2.2} fill={ink} /> : null}
    </svg>
  )
}
