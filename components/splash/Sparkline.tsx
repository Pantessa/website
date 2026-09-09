'use client'

// The splash's price sparklines — one keyless fetch per symbol per minute,
// shared by every row on the screen that shows that symbol (module cache +
// inflight dedupe, the /api/charts/candles route's own discipline). Gated
// by lib/charts' resolver exactly like the chart button: a symbol with no
// candle source renders NOTHING — a flat fake line would be a lie, and
// tokenized stocks stay honest until a stock feed lands.

import { useEffect, useState } from 'react'
import { useYeetfulStore } from '@/lib/store'
import { chartPairFor, type Candle } from '@/lib/charts'

export interface SparkData {
  symbol: string
  label: string
  /** Closing prices, oldest first (30 days of 4h candles). */
  closes: number[]
  last: number
  changePct24h: number | null
  /** First close → last close over the whole series, percent. */
  changePctSeries: number | null
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; data: SparkData | null }>()
const inflight = new Map<string, Promise<SparkData | null>>()

async function fetchSpark(symbol: string): Promise<SparkData | null> {
  const pair = chartPairFor(symbol)
  if (!pair) return null
  const hit = cache.get(pair.symbol)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const running = inflight.get(pair.symbol)
  if (running) return running
  const p = fetch(`/api/charts/candles?symbol=${encodeURIComponent(pair.symbol)}&tf=4h`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { candles?: Candle[]; last?: number | null; changePct24h?: number | null; label?: string | null } | null) => {
      const candles = Array.isArray(d?.candles) ? d!.candles : []
      if (candles.length < 2) return null
      const closes = candles.map((c) => c.c).filter((n) => Number.isFinite(n))
      const first = closes[0]
      const last = closes[closes.length - 1]
      const data: SparkData = {
        symbol: pair.symbol,
        label: d?.label ?? pair.label,
        closes,
        last: typeof d?.last === 'number' ? d.last : last,
        changePct24h: typeof d?.changePct24h === 'number' ? d.changePct24h : null,
        changePctSeries: first > 0 ? ((last - first) / first) * 100 : null,
      }
      return data
    })
    .catch(() => null)
    .then((data) => {
      cache.set(pair.symbol, { at: Date.now(), data })
      return data
    })
    .finally(() => inflight.delete(pair.symbol))
  inflight.set(pair.symbol, p)
  return p
}

/** Null until loaded, and null forever for symbols with no candle source. */
export function useSpark(symbol?: string | null): SparkData | null {
  const key = symbol ? chartPairFor(symbol)?.symbol ?? null : null
  const [data, setData] = useState<SparkData | null>(() => (key ? cache.get(key)?.data ?? null : null))
  useEffect(() => {
    if (!key) return
    let alive = true
    fetchSpark(key).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [key])
  return key ? data : null
}

/** Path for a closes series in a w×h box (a little vertical padding so the
 *  stroke never clips at the extremes). */
export function sparkPath(closes: number[], w: number, h: number, pad = 1.5): { line: string; area: string } {
  const n = closes.length
  if (n < 2) return { line: '', area: '' }
  let min = Infinity
  let max = -Infinity
  for (const c of closes) {
    if (c < min) min = c
    if (c > max) max = c
  }
  const span = max - min || 1
  const x = (i: number) => (i / (n - 1)) * w
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2)
  let line = `M${x(0).toFixed(2)},${y(closes[0]).toFixed(2)}`
  for (let i = 1; i < n; i++) line += ` L${x(i).toFixed(2)},${y(closes[i]).toFixed(2)}`
  const area = `${line} L${w},${h} L0,${h} Z`
  return { line, area }
}

let gradSeq = 0

/**
 * A 30-day price sparkline. Tone follows the series direction (accent up,
 * sell down). Click opens the full chart overlay — same door as the chart
 * button, no chat turn burned. Renders nothing until data lands.
 */
export function Sparkline({
  symbol,
  width = 88,
  height = 26,
  className,
}: {
  symbol?: string | null
  width?: number
  height?: number
  className?: string
}) {
  const data = useSpark(symbol)
  const setChartDetail = useYeetfulStore((s) => s.setChartDetail)
  const [gid] = useState(() => `spk${++gradSeq}`)
  if (!data) return null
  const up = (data.changePctSeries ?? 0) >= 0
  const tone = up ? 'var(--accent)' : 'var(--sell)'
  const { line, area } = sparkPath(data.closes, width, height)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setChartDetail({ symbol: data.symbol })
      }}
      title={`${data.label} · 30 days · open the live chart`}
      aria-label={`${data.label} 30-day sparkline, open the live chart`}
      className={`group/spark shrink-0 rounded-md p-0.5 transition-colors hover:bg-white/5 ${className ?? ''}`}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={tone} stopOpacity={0.28} />
            <stop offset="1" stopColor={tone} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={tone} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={width} cy={Number(line.split(' ').pop()!.split(',')[1])} r={1.8} fill={tone} />
      </svg>
    </button>
  )
}

/** "▲ 2.4%" 24h change chip beside a value; nothing without data. */
export function Delta24({ symbol, className }: { symbol?: string | null; className?: string }) {
  const data = useSpark(symbol)
  if (!data || data.changePct24h == null) return null
  const v = data.changePct24h
  const up = v >= 0
  return (
    <span
      className={`mono text-[10px] tabular-nums ${className ?? ''}`}
      style={{ color: up ? 'var(--accent)' : 'var(--sell)' }}
      title={`${data.label} · 24h change`}
    >
      {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
    </span>
  )
}
