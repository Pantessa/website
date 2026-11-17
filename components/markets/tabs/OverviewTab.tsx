'use client'

// Overview — the symbol's numbers and the "what you can do" row. Real
// (SHELL). MK2 (2026-09-15): AI's brief LEADS (AiBrief slot), then VIZ's
// FlowPanel (where the money lives across dapps), the performance tiles +
// key stats, and EXEC's RouteTable (every venue a wallet can act on the
// symbol, one chip each). Slots come from components/markets/slots/*; the
// real components replace the stubs at integration. Every chip's ask goes
// through the page's act door (`onAskText`).

import { useEffect, useState } from 'react'
import { chartUnitOf, isLookOnlyPair, type Candle, type ChartPair } from '@/lib/charts'
import { fmtIndexStat } from '@/lib/macro'
import { lastSessionStats, stats24h } from '@/lib/markets'
import PerformanceTiles from '@/components/markets/chart/PerformanceTiles'
import { fmtQuotePrice } from '@/lib/markets-quotes'
import type { TradeAsk } from '@/lib/trade-asks'
import AiBrief from '@/components/markets/slots/AiBrief'
import FlowPanel from '@/components/markets/slots/FlowPanel'
import RouteTable from '@/components/markets/slots/RouteTable'

async function readCandles(symbol: string, tf: '1h' | '1d'): Promise<Candle[]> {
  try {
    const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
    if (!res.ok) return []
    const body = (await res.json()) as { candles?: Candle[]; error?: string }
    return body.error ? [] : (body.candles ?? [])
  } catch {
    return []
  }
}

function fmtVolume(v: number, last: number | null): string {
  // Candle volume is in base units; print it as notional when we know the
  // price, else as units — labelled either way so it never reads as USD by
  // accident.
  const n = last ? v * last : v
  const unit = last ? '$' : ''
  if (n >= 1e9) return `${unit}${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${unit}${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${unit}${(n / 1e3).toFixed(1)}K`
  return `${unit}${n.toFixed(0)}`
}

export default function OverviewTab({
  symbol,
  pair,
  onAskText,
  last: lastProp,
}: {
  symbol: string
  pair: ChartPair
  /** The frame's send door (kept on the contract for the tiles' future chips). */
  onAsk?: (ask: TradeAsk) => void
  /** The act door for a bare ask string (the slots' onAsk). */
  onAskText?: (ask: string) => void
  /** The chart's last close (the header's stats) — EXEC sizes unit rows from it. */
  last?: number | null
}) {
  const ask = onAskText ?? (() => {})
  const [daily, setDaily] = useState<Candle[] | null>(null)
  const [hourly, setHourly] = useState<Candle[] | null>(null)

  useEffect(() => {
    let stopped = false
    setDaily(null)
    setHourly(null)
    void Promise.all([readCandles(pair.symbol, '1d'), readCandles(pair.symbol, '1h')]).then(([d, h]) => {
      if (stopped) return
      setDaily(d)
      setHourly(h)
    })
    return () => {
      stopped = true
    }
  }, [pair.symbol])

  const last = hourly?.length ? hourly[hourly.length - 1].c : daily?.length ? daily[daily.length - 1].c : null
  // A look-only index (lib/charts isLookOnlyPair): its numbers in its own
  // unit, its latest SESSION rather than a mostly-closed 24 hours, no volume
  // (an index has none to state), and neither the money-flow panel nor the
  // venue table — nothing on-chain holds or trades an index.
  const lookOnly = isLookOnlyPair(pair)
  const unit = chartUnitOf(pair)
  const day = hourly ? (lookOnly ? lastSessionStats(hourly) : stats24h(hourly)) : null
  const dayVolume = !lookOnly && hourly ? (stats24h(hourly)?.volume ?? 0) : 0
  const money = (v: number) => (lookOnly ? fmtIndexStat(pair, v) : `${unit === 'usd' ? '$' : ''}${fmtQuotePrice(v)}`)

  return (
    <div className="mkt-overview mk-overview" data-look-only={lookOnly ? '' : undefined}>
      {/* The brief leads (AI) */}
      <div className="mk-overview__lead">
        <AiBrief symbol={symbol} pair={pair} onAsk={ask} />
      </div>
      {/* Where the money lives (VIZ) */}
      {!lookOnly && (
        <div className="mk-overview__flow">
          <FlowPanel symbol={symbol} pair={pair} />
        </div>
      )}
      {/* Performance tiles */}
      <section className="mkt-card" aria-label="Performance">
        <header className="mkt-card__head">
          <h2 className="mkt-card__title">Performance</h2>
          <span className="mkt-card__eyebrow mono">CLOSE TO CLOSE · DAILY BARS</span>
        </header>
        {/* CHART's lib/performance.ts is the one source for these numbers. */}
        <PerformanceTiles symbol={symbol} />
      </section>

      {/* Key stats */}
      <section className="mkt-card" aria-label="Key stats">
        <header className="mkt-card__head">
          <h2 className="mkt-card__title">Key stats</h2>
          <span className="mkt-card__eyebrow mono">{lookOnly ? 'LATEST SESSION · HOURLY BARS · DELAYED' : 'LAST 24H · HOURLY BARS'}</span>
        </header>
        <dl className="mkt-kv mkt-kv--grid">
          <div>
            <dt>Last</dt>
            <dd className="mono">{last != null ? money(last) : hourly === null ? '…' : '—'}</dd>
          </div>
          <div>
            <dt>{lookOnly ? 'Session high' : '24h high'}</dt>
            <dd className="mono">{day ? money(day.high) : hourly === null ? '…' : '—'}</dd>
          </div>
          <div>
            <dt>{lookOnly ? 'Session low' : '24h low'}</dt>
            <dd className="mono">{day ? money(day.low) : hourly === null ? '…' : '—'}</dd>
          </div>
          {!lookOnly && (
            <div>
              <dt>24h volume</dt>
              <dd className="mono">{dayVolume > 0 ? fmtVolume(dayVolume, last) : hourly === null ? '…' : '—'}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Every venue, one chip each (EXEC). An index has no venue: the page's look-only card says so, with the closest thing listed. */}
      {!lookOnly && (
        <div className="mk-overview__routes">
          <RouteTable symbol={symbol} pair={pair} onAsk={ask} last={lastProp ?? last ?? null} />
        </div>
      )}
    </div>
  )
}
