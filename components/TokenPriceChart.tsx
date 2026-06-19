'use client'

// Price chart for a launched MCP token (x402-launch). Polls
// /api/servers/[slug]/price — which samples the v4-pool spot price on read and
// returns the history — and renders the current price + the series. The pool may
// have little/no trade activity early, so the series fills in over time; until
// there are ≥2 points the chart shows a "builds as it trades" empty state.

import { useEffect, useRef, useState } from 'react'
import { PriceChart } from '@/components/LazyCharts'

const POLL_MS = 30_000

type Spot = { priceEth: string; priceUsd: number; marketCapUsd: number } | null
type PriceData = { launched: boolean; spot: Spot; samples: { at: string; priceUsd: number; marketCapUsd: number }[] }

function usd(v: number): string {
  if (!isFinite(v) || v <= 0) return '—'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  if (v >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${v.toPrecision(3)}`
}

export default function TokenPriceChart({ slug }: { slug: string }) {
  const [data, setData] = useState<PriceData | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const load = () =>
      fetch(`/api/servers/${slug}/price`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: PriceData) => setData(d))
        .catch(() => {})
    void load()
    timer.current = setInterval(load, POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [slug])

  if (!data || !data.launched) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.spot && (
        <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px', fontSize: 14 }}>
          <span><span style={{ color: 'var(--smoke)' }}>price </span>{usd(data.spot.priceUsd)}</span>
          <span><span style={{ color: 'var(--smoke)' }}>market cap </span>{usd(data.spot.marketCapUsd)}</span>
        </div>
      )}
      <PriceChart samples={data.samples} />
    </div>
  )
}
