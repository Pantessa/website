'use client'

// FUNDAMENTALS — the DefiLlama panel under the Technicals gauges on
// /t/<symbol>, for crypto symbols only (a stock's fundamentals are its
// filings, not a TVL curve). Reads GET /api/markets/fundamentals, which maps
// the symbol to the protocol or chain DefiLlama tracks and hands back up to
// five daily series (TVL · fees · revenue · holders revenue · DEX volume).
//
// The look is DefiLlama's own chart page translated into our tokens: metric
// chips you toggle (two at a time, left axis / right axis), a range strip,
// a stat strip above, and the chart drawn by the SAME engine and theme probe
// the candles use (components/markets/chart/chart-tokens). Every color is a
// --mk-* token, resolved at mount and again on a theme flip, so light mode
// gets its own inks instead of a dark canvas on a white page.
//
// Attribution is a condition of DefiLlama's free API: the head and the foot
// both name it and link to the subject's page.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AreaSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type UTCTimestamp } from 'lightweight-charts'
import { readTokens, type Tokens } from '@/components/markets/chart/chart-tokens'
import { fmtCompact } from '@/lib/markets-look'
import {
  LLAMA_METRICS,
  LLAMA_RANGES,
  defaultLlamaPicks,
  llamaMetricDef,
  togglePick,
  windowPoints,
  type LlamaFundamentals,
  type LlamaFundamentalsApi,
  type LlamaMetricKey,
  type LlamaRange,
  type LlamaSeries,
} from '@/lib/defillama'
import './fundamentals.css'

/** A STABLE ink per metric (never by pick order), so TVL is always the blue
 *  line and fees always gold, whichever axis they land on. Slots index
 *  --mk-series-N (1-based in CSS, 0-based here). */
export const LLAMA_METRIC_SLOT: Record<LlamaMetricKey, number> = { tvl: 0, fees: 3, revenue: 2, holdersRevenue: 5, volume: 6 }

const alpha = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
}

const usd = (n: number | null | undefined) => fmtCompact(n, { usd: true })
const dayLabel = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

type Readout = { time: number; values: { key: LlamaMetricKey; value: number | null }[] } | null

export default function Fundamentals({ symbol }: { symbol: string }) {
  const [res, setRes] = useState<LlamaFundamentalsApi | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [picks, setPicks] = useState<LlamaMetricKey[]>([])
  const [range, setRange] = useState<LlamaRange>('1y')
  const [readout, setReadout] = useState<Readout>(null)
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<Map<LlamaMetricKey, ISeriesApi<'Area'> | ISeriesApi<'Histogram'>>>(new Map())

  // ── data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setFailed(false)
    fetch(`/api/markets/fundamentals?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? (r.json() as Promise<LlamaFundamentalsApi>) : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!alive) return
        setRes(b)
        if (b.subject) setPicks((prev) => (prev.length ? prev.filter((k) => b.series.some((s) => s.key === k)) : defaultLlamaPicks(b.series.map((s) => s.key))))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [symbol, tick])

  // ── theme ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setTokens(readTokens())
    const mo = new MutationObserver(() => setTokens(readTokens()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => setTokens(readTokens())
    mq.addEventListener('change', onMq)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', onMq)
    }
  }, [])

  const data: LlamaFundamentals | null = res && res.subject ? res : null
  const bySeries = useMemo(() => new Map((data?.series ?? []).map((s) => [s.key, s] as const)), [data])
  const drawn = useMemo(() => picks.map((k) => bySeries.get(k)).filter((s): s is LlamaSeries => !!s), [picks, bySeries])
  const inkOf = useCallback((key: LlamaMetricKey) => tokens?.series[LLAMA_METRIC_SLOT[key]] ?? '#9a9a9a', [tokens])

  // ── chart ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = hostRef.current
    if (!el || !tokens || drawn.length === 0) return
    const fmt = (v: number) => usd(v)
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: tokens.surf }, textColor: tokens.muted2, fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: tokens.grid }, horzLines: { color: tokens.grid } },
      leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.02 } },
      rightPriceScale: { visible: drawn.length > 1, borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.02 } },
      timeScale: { borderVisible: false, timeVisible: false, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: tokens.crosshair, labelBackgroundColor: tokens.line }, horzLine: { color: tokens.crosshair, labelBackgroundColor: tokens.line } },
      handleScroll: { pressedMouseMove: true, mouseWheel: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false } },
      localization: { priceFormatter: fmt },
    })
    chartRef.current = chart
    const map = new Map<LlamaMetricKey, ISeriesApi<'Area'> | ISeriesApi<'Histogram'>>()
    drawn.forEach((s, i) => {
      const ink = inkOf(s.key)
      const priceScaleId = i === 0 ? 'left' : 'right'
      const priceFormat = { type: 'custom' as const, formatter: fmt, minMove: 0.01 }
      const points = windowPoints(s.points, range)
      const series =
        s.kind === 'level'
          ? chart.addSeries(AreaSeries, { priceScaleId, lineColor: ink, topColor: alpha(ink, 0.32), bottomColor: alpha(ink, 0.02), lineWidth: 2, priceFormat, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 })
          : chart.addSeries(HistogramSeries, { priceScaleId, color: alpha(ink, drawn.length > 1 && i === 1 ? 0.7 : 0.85), priceFormat, priceLineVisible: false, lastValueVisible: true, base: 0 })
      series.setData(points.map(([t, v]) => ({ time: t as UTCTimestamp, value: v })))
      map.set(s.key, series)
    })
    seriesRef.current = map
    chart.timeScale().fitContent()

    const onMove = (p: MouseEventParams) => {
      if (!p.time || typeof p.time !== 'number' || !p.point) {
        setReadout(null)
        return
      }
      setReadout({
        time: p.time,
        values: drawn.map((s) => {
          const d = p.seriesData.get(map.get(s.key)!) as { value?: number } | undefined
          return { key: s.key, value: typeof d?.value === 'number' ? d.value : null }
        }),
      })
    }
    chart.subscribeCrosshairMove(onMove)
    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.remove()
      chartRef.current = null
      seriesRef.current = new Map()
      setReadout(null)
    }
  }, [tokens, drawn, range, inkOf])

  // ── states ────────────────────────────────────────────────────────────
  if (res && !res.subject) {
    if (!('retry' in res)) return null // no DefiLlama page: the panel simply isn't here
    return (
      <section className="mk-fund mk-fund--note" data-fundamentals={symbol} data-fundamentals-state="unavailable">
        <p>{res.reason}</p>
        <button type="button" onClick={() => setTick((t) => t + 1)}>
          Try again
        </button>
      </section>
    )
  }
  if (failed) {
    return (
      <section className="mk-fund mk-fund--note" data-fundamentals={symbol} data-fundamentals-state="unavailable">
        <p>DefiLlama did not answer.</p>
        <button type="button" onClick={() => setTick((t) => t + 1)}>
          Try again
        </button>
      </section>
    )
  }

  const stats = data
    ? [
        { label: 'TVL', value: data.stats.tvl, key: 'tvl' as const },
        { label: 'Fees 30d', value: data.stats.fees30d, key: 'fees' as const },
        { label: 'Revenue 30d', value: data.stats.revenue30d, key: 'revenue' as const },
        { label: 'DEX volume 30d', value: data.stats.volume30d, key: 'volume' as const },
        { label: 'Market cap', value: data.stats.mcap, key: null },
      ].filter((s) => s.value != null)
    : []
  const available = LLAMA_METRICS.filter((m) => bySeries.has(m.key))
  const latestPoint = drawn[0]?.points[drawn[0].points.length - 1]

  return (
    <section className="mk-fund" data-fundamentals={symbol} data-fundamentals-state={data ? 'ready' : 'loading'} aria-busy={!data}>
      <header className="mk-fund__head">
        <div className="mk-fund__title">
          <span className="mk-label">
            Fundamentals · via{' '}
            <a href={data?.subject.url ?? 'https://defillama.com'} target="_blank" rel="noreferrer">
              DefiLlama
            </a>
          </span>
          <h3>
            {data ? data.subject.name : `${symbol} on DefiLlama`}
            {data?.subject.category && <small>{data.subject.category}</small>}
            {data && !data.subject.category && data.subject.kind === 'chain' && <small>Chain</small>}
          </h3>
        </div>
        {data && (
          <a className="mk-fund__ext" href={data.subject.url} target="_blank" rel="noreferrer">
            defillama.com ↗
          </a>
        )}
      </header>

      {stats.length > 0 && (
        <div className="mk-fund__stats" role="list">
          {stats.map((s) => (
            <div key={s.label} className="mk-fund__stat mk-stat" role="listitem">
              <span className="mk-label">{s.label}</span>
              <span className="mk-stat__value mk-fund__stat-value" style={s.key ? { color: inkOf(s.key) } : undefined}>
                {usd(s.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mk-fund__controls">
        <div className="mk-fund__chips" role="group" aria-label="Chart metrics">
          {available.map((m) => {
            const on = picks.includes(m.key)
            const ink = inkOf(m.key)
            return (
              <button
                key={m.key}
                type="button"
                className="mk-fund__chip"
                aria-pressed={on}
                onClick={() => setPicks((p) => togglePick(p, m.key))}
                style={on ? { borderColor: ink, color: ink, background: alpha(ink, 0.12) } : undefined}
                title={m.note}
                data-metric={m.key}
              >
                <i style={{ background: on ? ink : 'transparent', borderColor: ink }} aria-hidden="true" />
                {m.label}
                <span aria-hidden="true">{on ? '×' : '+'}</span>
              </button>
            )
          })}
        </div>
        <div className="mk-fund__ranges" role="tablist" aria-label="Range">
          {LLAMA_RANGES.map((r) => (
            <button key={r.key} type="button" role="tab" aria-selected={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mk-fund__readout mono" aria-live="polite">
        {readout ? (
          <>
            <span className="mk-fund__readout-date">{dayLabel(readout.time)}</span>
            {readout.values.map((v) => (
              <span key={v.key} style={{ color: inkOf(v.key) }}>
                {llamaMetricDef(v.key).label} {usd(v.value)}
              </span>
            ))}
          </>
        ) : latestPoint ? (
          <>
            <span className="mk-fund__readout-date">{dayLabel(latestPoint[0])}</span>
            {drawn.map((s) => (
              <span key={s.key} style={{ color: inkOf(s.key) }}>
                {s.label} {usd(s.latest)}
                {s.kind === 'flow' && <em> · 30d {usd(s.last30d)}</em>}
              </span>
            ))}
          </>
        ) : (
          <span>{data ? 'nothing to draw' : 'reading DefiLlama…'}</span>
        )}
      </div>

      <div className="mk-fund__chart" ref={hostRef} data-fundamentals-chart={drawn.map((s) => s.key).join('+') || 'empty'} />

      <p className="mk-fund__foot">
        {data ? (
          <>
            Data: <a href={data.subject.url} target="_blank" rel="noreferrer">DefiLlama</a> · {data.subject.name} ({data.subject.kind}) · daily, USD
            {data.missing.length > 0 && <> · not tracked here: {data.missing.map((k) => llamaMetricDef(k).label.toLowerCase()).join(', ')}</>}
            {' · '}two metrics at a time, left and right axis
          </>
        ) : (
          <>Data: DefiLlama · daily, USD</>
        )}
      </p>
    </section>
  )
}
