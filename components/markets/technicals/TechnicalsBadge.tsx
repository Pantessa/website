'use client'

// Compact rating badge — the summary verdict as a word + a mini needle,
// linking to the full gauges (/t/<sym>?tab=technicals&tf=). SHELL mounts it
// in the symbol header, WATCH in a rail row. Self-fetching; renders NOTHING
// until it has a verdict (never a fake neutral), nothing at all for a
// chartless symbol.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ChartTf } from '@/lib/charts'
import { RATING_LABELS, type Gauge } from '@/lib/technicals'
import { needleAngle, ratingColor } from './RatingGauge'

interface TechRes {
  symbol: string
  tf: ChartTf
  summary?: Gauge
  error?: string
}

export default function TechnicalsBadge({ symbol, tf = '1d', className = '' }: { symbol: string; tf?: ChartTf; className?: string }) {
  const [gauge, setGauge] = useState<Gauge | null>(null)
  useEffect(() => {
    let alive = true
    setGauge(null)
    fetch(`/api/charts/technicals?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((r) => r.json() as Promise<TechRes>)
      .then((b) => {
        if (alive && b.summary) setGauge(b.summary)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [symbol, tf])
  if (!gauge) return null
  const angle = needleAngle(gauge.score)
  const a = (angle * Math.PI) / 180
  const nx = 12 + 9 * Math.cos(a)
  const ny = 12 - 9 * Math.sin(a)
  const color = ratingColor(gauge.rating)
  return (
    <Link
      href={`/t/${symbol}?tab=technicals&tf=${tf}`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] py-0.5 pl-1 pr-2 text-[11px] font-medium transition-colors hover:border-[var(--line-2)] ${className}`}
      title={`Technicals ${tf}: ${RATING_LABELS[gauge.rating]} (${gauge.buy} buy · ${gauge.neutral} neutral · ${gauge.sell} sell)`}
      data-rating={gauge.rating}
    >
      <svg viewBox="0 0 24 14" width={24} height={14} aria-hidden="true">
        <path d="M 3 12 A 9 9 0 0 1 21 12" fill="none" stroke="var(--line-2)" strokeWidth={3} />
        <line x1={12} y1={12} x2={nx} y2={ny} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <circle cx={12} cy={12} r={1.6} fill={color} />
      </svg>
      <span style={{ color }}>{RATING_LABELS[gauge.rating]}</span>
      <span className="mono text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">{tf}</span>
    </Link>
  )
}
