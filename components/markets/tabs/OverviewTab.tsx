'use client'

// Overview — the symbol's numbers and the "what you can do" row. Real
// (SHELL). Performance tiles + key stats derive client-side from the
// existing candles proxy (the CHART lane's lib/performance.ts replaces the
// math behind the same tiles). Every chip carries an ask an existing parser
// accepts and SENDS through the frame's `onAsk` (chip-send contract) — the
// href is the no-JS fallback (a /chat prefill; a URL never fires a turn).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Candle, ChartPair } from '@/lib/charts'
import { stats24h, symbolName } from '@/lib/markets'
import PerformanceTiles from '@/components/markets/chart/PerformanceTiles'
import { chgClass, fmtPct, fmtQuotePrice } from '@/lib/markets-quotes'
import { tradeAsks, type TradeAsk } from '@/components/markets/tabs/TradeTab'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

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
  onAsk,
}: {
  symbol: string
  pair: ChartPair
  /** The frame's send door: lands on the Trade tab and fires the ask. */
  onAsk?: (ask: TradeAsk) => void
}) {
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
  const day = hourly ? stats24h(hourly) : null
  const asks = tradeAsks(pair)

  return (
    <div className="mkt-overview">
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
          <span className="mkt-card__eyebrow mono">LAST 24H · HOURLY BARS</span>
        </header>
        <dl className="mkt-kv mkt-kv--grid">
          <div>
            <dt>Last</dt>
            <dd className="mono">{last != null ? `$${fmtQuotePrice(last)}` : hourly === null ? '…' : '—'}</dd>
          </div>
          <div>
            <dt>24h high</dt>
            <dd className="mono">{day ? `$${fmtQuotePrice(day.high)}` : hourly === null ? '…' : '—'}</dd>
          </div>
          <div>
            <dt>24h low</dt>
            <dd className="mono">{day ? `$${fmtQuotePrice(day.low)}` : hourly === null ? '…' : '—'}</dd>
          </div>
          <div>
            <dt>24h volume</dt>
            <dd className="mono">{day && day.volume > 0 ? fmtVolume(day.volume, last) : hourly === null ? '…' : '—'}</dd>
          </div>
        </dl>
      </section>

      {/* What you can do — chips send, the wallet signs */}
      <section className="mkt-card" aria-label="What you can do">
        <header className="mkt-card__head">
          <h2 className="mkt-card__title">Act on {symbolName(symbol)}</h2>
          <span className="mkt-card__eyebrow mono">SENDS THE ASK · YOUR WALLET SIGNS</span>
        </header>
        <div className="mkt-chips">
          {asks.map((a) => (
            <Link
              key={a.label}
              href={promptHref(a.ask)}
              className={`mkt-chip ${a.side === 'buy' ? 'mkt-chip--buy' : ''}`}
              onClick={(e) => {
                if (!onAsk) return
                e.preventDefault()
                onAsk(a)
              }}
            >
              {a.label}
            </Link>
          ))}
        </div>
        <p className="mkt-card__note">
          Each chip is one sentence Pantessa already understands. It builds the guarded transaction here on the Trade tab; nothing moves until you sign.
        </p>
      </section>
    </div>
  )
}
