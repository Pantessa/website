'use client'

// Price chart for a launched MCP token (x402-launch). Polls
// /api/servers/[slug]/price — which samples the v4-pool spot price on read and
// returns the history — and renders it as a hero: big current spot + a 24h
// change chip, a timeframe selector, and the area chart below. The pool may have
// little/no trade activity early, so the series fills in over time; until a
// window holds ≥2 points the chart shows a "builds as it trades" empty state.

import { useEffect, useMemo, useRef, useState } from 'react'
import { PriceChart } from '@/components/LazyCharts'
import { usdCompact } from '@/lib/format'

const POLL_MS = 30_000
const CHART_HEIGHT = 260

type Sample = { at: string; priceUsd: number; marketCapUsd: number }
type Spot = { priceEth: string; priceUsd: number; marketCapUsd: number } | null
type PriceData = { launched: boolean; spot: Spot; samples: Sample[] }

const HOUR = 3_600_000
const TIMEFRAMES: { key: string; label: string; ms: number }[] = [
  { key: '1H', label: '1H', ms: HOUR },
  { key: '1D', label: '1D', ms: 24 * HOUR },
  { key: '1W', label: '1W', ms: 7 * 24 * HOUR },
  { key: '1M', label: '1M', ms: 30 * 24 * HOUR },
  { key: 'ALL', label: 'All', ms: Infinity },
]

/** Latest price vs the price ~24h ago (or the earliest sample if younger). */
function change24h(samples: Sample[]): number | null {
  if (samples.length < 2) return null
  const latest = samples[samples.length - 1]
  const cutoff = Date.now() - 24 * HOUR
  let base = samples[0]
  for (const s of samples) {
    if (new Date(s.at).getTime() <= cutoff) base = s
    else break
  }
  if (!(base.priceUsd > 0)) return null
  return ((latest.priceUsd - base.priceUsd) / base.priceUsd) * 100
}

export default function TokenPriceChart({ slug }: { slug: string }) {
  const [data, setData] = useState<PriceData | null>(null)
  const [tf, setTf] = useState('ALL')
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

  const samples = useMemo(() => data?.samples ?? [], [data])
  const visible = useMemo(() => {
    const win = TIMEFRAMES.find((t) => t.key === tf)?.ms ?? Infinity
    if (!isFinite(win)) return samples
    const cutoff = Date.now() - win
    return samples.filter((s) => new Date(s.at).getTime() >= cutoff)
  }, [samples, tf])

  if (!data || !data.launched) return null

  const current = data.spot?.priceUsd ?? (samples.length ? samples[samples.length - 1].priceUsd : 0)
  const chg = change24h(samples)
  const chgClass = chg === null ? 'tok__chg--flat' : chg > 0 ? 'tok__chg--up' : chg < 0 ? 'tok__chg--down' : 'tok__chg--flat'
  const chgLabel = chg === null ? '24h —' : `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% 24h`

  return (
    <div className="tok__chart">
      <div className="tok__charthead">
        <div className="tok__pricewrap">
          <span className="tok__price mono">{usdCompact(current)}</span>
          <span className={`tok__chg ${chgClass}`}>{chgLabel}</span>
        </div>
        <div className="tok__tf">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.key}
              className={`tok__tfbtn mono${tf === t.key ? ' is-active' : ''}`}
              aria-pressed={tf === t.key}
              onClick={() => setTf(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <PriceChart samples={visible} height={CHART_HEIGHT} />
    </div>
  )
}
