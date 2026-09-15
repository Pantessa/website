'use client'

// FlowPanel — where this symbol's money lives across dapps: pool liquidity,
// Aave reserves, Hyperliquid open interest, stock-token supply. Reads
// GET /api/markets/viz/flow?symbol= (60s cache, every source fail-soft: a
// missing source is a LABELLED gap, never a zero). Drawn as a ribbon over a
// ranked list, venue colors stable via seriesVar.

import { useEffect, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import { fmtCompact, seriesVar, TAPE_FOOTNOTE } from '@/lib/markets-look'
import Ribbon from './Ribbon'

export interface FlowSource {
  /** Stable entity id (uniswap, aave, hyperliquid, robinhood, cow, lido…). */
  id: string
  venue: string
  /** What the number IS (pool TVL, reserve size, open interest, supply). */
  measure: string
  chain?: string
  usd: number | null
  /** Extra facts the venue emits (funding rate, utilization…). */
  detail?: string
  /** Why usd is null — the gap's own words. */
  gap?: string
}

export interface FlowResponse {
  symbol: string
  sources: FlowSource[]
  asOf: number
  cached?: boolean
}

export interface FlowPanelProps {
  symbol: string
  pair: ChartPair | null
  className?: string
}

export default function FlowPanel({ symbol, pair, className = '' }: FlowPanelProps) {
  const [data, setData] = useState<FlowResponse | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'down'>('loading')
  useEffect(() => {
    let alive = true
    setState('loading')
    setData(null)
    fetch(`/api/markets/viz/flow?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as FlowResponse) : null))
      .then((body) => {
        if (!alive) return
        if (body) {
          setData(body)
          setState('ok')
        } else setState('down')
      })
      .catch(() => alive && setState('down'))
    return () => {
      alive = false
    }
  }, [symbol])

  const sources = data?.sources ?? []
  const live = sources.filter((s) => s.usd != null && s.usd > 0)
  const gaps = sources.filter((s) => s.usd == null)
  const total = live.reduce((a, s) => a + (s.usd ?? 0), 0)

  return (
    <section className={`mk-panel ${className}`.trim()} aria-label={`Where ${symbol} money lives`}>
      <div className="mk-panel__head">
        <h3 className="mk-panel__title">Where the money lives</h3>
        <span className="mk-label">{pair ? pair.source : 'not charted'}</span>
      </div>
      {state === 'loading' ? (
        <div className="mk-num" style={{ color: 'var(--muted-2)', fontSize: 12 }}>Reading venues…</div>
      ) : state === 'down' ? (
        <div className="mk-num" style={{ color: 'var(--muted-2)', fontSize: 12 }}>Venue reads unavailable — retrying next open.</div>
      ) : (
        <>
          <div className="mk-receipt">
            <div className="mk-label">Visible across {live.length} venue{live.length === 1 ? '' : 's'}</div>
            <div className="mk-flow__total">{total > 0 ? fmtCompact(total, { usd: true }) : '—'}</div>
          </div>
          {live.length ? <Ribbon className="mt-3" segs={live.map((s) => ({ id: s.id, name: s.venue, value: s.usd ?? 0 }))} usd legend={false} /> : null}
          <div className="mk-flow__rows">
            {sources.map((s) => (
              <div key={`${s.id}:${s.measure}:${s.chain ?? ''}`} className="mk-flow__row">
                <i style={{ background: seriesVar(s.id) }} aria-hidden="true" />
                <span className="mk-flow__venue">
                  {s.venue}
                  <small>
                    {s.measure}
                    {s.chain ? ` · ${s.chain}` : ''}
                    {s.detail ? ` · ${s.detail}` : ''}
                  </small>
                </span>
                <span className={`mk-flow__amt ${s.usd == null ? 'mk-flow__amt--gap' : ''}`}>{s.usd == null ? (s.gap ?? 'no read') : fmtCompact(s.usd, { usd: true })}</span>
              </div>
            ))}
            {sources.length === 0 ? <div className="mk-flow__gaps">No venue reads this symbol yet.</div> : null}
          </div>
          {gaps.length ? <div className="mk-flow__gaps">{gaps.length} source{gaps.length === 1 ? '' : 's'} unread — shown as gaps, never as zero.</div> : null}
        </>
      )}
      <div className="mk-panel__foot">{TAPE_FOOTNOTE}</div>
    </section>
  )
}
