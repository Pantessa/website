'use client'

// Performance tiles — 1W · 1M · 3M · 6M · YTD · 1Y off the DAILY series
// (lib/performance). Reads /api/charts/candles?tf=1d itself so it never
// depends on which timeframe the chart happens to show; windows the 180-bar
// series can't reach render "—" and are named underneath.

import { useEffect, useState } from 'react'
import { chartPairFor, type Candle } from '@/lib/charts'
import { fmtPct, performanceTiles, type PerformanceTiles as Tiles } from '@/lib/performance'

export default function PerformanceTiles({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const [tiles, setTiles] = useState<Tiles | null>(null)
  const pair = chartPairFor(symbol)

  useEffect(() => {
    if (!pair) return
    let alive = true
    const run = async () => {
      try {
        const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(pair.symbol)}&tf=1d`, { cache: 'no-store' })
        const body = (await res.json()) as { candles?: Candle[] }
        if (alive && body.candles?.length) setTiles(performanceTiles(body.candles))
      } catch {
        /* the tiles simply stay empty */
      }
    }
    void run()
    const timer = setInterval(() => void run(), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [pair])

  if (!pair) return null
  const list = tiles?.tiles ?? []
  return (
    <div className={`mkt-perf${compact ? ' mkt-perf--compact' : ''}`} aria-label="Performance">
      {(list.length ? list : (['1W', '1M', '3M', '6M', 'YTD', '1Y'] as const).map((key) => ({ key, pct: null as number | null }))).map((t) => (
        <div key={t.key} className={`mkt-perf__tile${t.pct === null ? ' is-na' : t.pct > 0 ? ' is-up' : t.pct < 0 ? ' is-down' : ''}`} title={t.pct === null ? `${t.key}: the daily feed does not reach back that far` : `${t.key} change`}>
          <span className="mono mkt-perf__key">{t.key}</span>
          <span className="mono mkt-perf__val">{fmtPct(t.pct)}</span>
        </div>
      ))}
      {tiles && tiles.unavailable.length > 0 && !compact && (
        <span className="mono mkt-perf__note">{tiles.unavailable.join(' · ')} beyond the feed’s reach</span>
      )}
    </div>
  )
}
