'use client'

// Live candlestick chart — the DEX-style view behind every token chart button
// (ChartOverlay + /t/[symbol]). Hand-rolled SVG: recharts has no candle
// primitive, and drawing directly keeps the paint on the site's CSS tokens
// (--accent up / --sell down) so both themes come free. Polls
// /api/charts/candles; the pair resolver upstream guarantees a symbol that
// reaches this component has a real source, so the empty state here means
// "feed hiccup", not "unknown token".

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHART_TFS, chartPairFor, type Candle, type ChartTf } from '@/lib/charts'

const POLL_MS: Record<ChartTf, number> = { '15m': 8_000, '1h': 15_000, '4h': 20_000, '1d': 30_000 }

const AXIS_W = 56
const TIME_H = 18
const VOL_FRAC = 0.16

export interface ChartStats {
  last: number | null
  changePct24h: number | null
  label: string | null
  source: string | null
}

interface CandlesResponse {
  symbol: string
  label: string | null
  source: string | null
  tf: ChartTf
  candles: Candle[]
  last?: number | null
  changePct24h?: number | null
  error?: string
}

/** Price formatting that survives both BTC and PEPE. */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

function fmtTime(tSec: number, tf: ChartTf): string {
  const d = new Date(tSec * 1000)
  if (tf === '1d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (tf === '4h') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtHoverTime(tSec: number, tf: ChartTf): string {
  const d = new Date(tSec * 1000)
  if (tf === '1d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

export default function CandleChart({
  symbol,
  height: heightProp = 300,
  defaultTf = '1h',
  onStats,
  controlsRight,
  resizeKey,
}: {
  symbol: string
  /** Fixed pixel height, or 'fill' to take the flex parent's remaining space
   *  (the full-bleed /t page — the chart IS the page there). */
  height?: number | 'fill'
  defaultTf?: ChartTf
  /** Fires whenever fresh candles land — overlay/page headers feed off it. */
  onStats?: (s: ChartStats) => void
  /** Extra control rendered beside the live badge (the page's expand toggle). */
  controlsRight?: ReactNode
  /** Changes whenever the PARENT knowingly changes the chart's box (the page's
   *  expand toggle). Re-measures directly instead of waiting on an observer
   *  the browser may not have delivered yet. */
  resizeKey?: string | number | boolean
}) {
  const fill = heightProp === 'fill'
  const [tf, setTf] = useState<ChartTf>(defaultTf)
  const [data, setData] = useState<CandlesResponse | null>(null)
  const [stale, setStale] = useState(false)
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null)
  const [width, setWidth] = useState(0)
  const [measuredH, setMeasuredH] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const resolvable = useMemo(() => chartPairFor(symbol) !== null, [symbol])

  // Container-measured layout — viewBox stretching would distort wick widths,
  // so the axis math stays in real pixels. ResizeObserver is the primary
  // signal, but its callbacks are delivered on the frame loop: a starved or
  // backgrounded tab can withhold them (reproduced), which would leave the
  // canvas stuck at a stale size after leaving fullscreen. window resize and
  // fullscreenchange re-measure directly so the chart can't get stranded.
  const measure = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (box.width) setWidth(Math.round(box.width))
    if (box.height) setMeasuredH(Math.round(box.height))
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    window.addEventListener('resize', measure)
    document.addEventListener('fullscreenchange', measure)
    document.addEventListener('webkitfullscreenchange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('fullscreenchange', measure)
      document.removeEventListener('webkitfullscreenchange', measure)
    }
  }, [measure])

  // Parent-announced layout change (expand/collapse) — runs after the DOM has
  // the new box, so this is the authoritative measure for that transition.
  useEffect(() => {
    measure()
  }, [resizeKey, measure])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const d = (await res.json()) as CandlesResponse
      if (d.candles.length > 0) {
        setData(d)
        setStale(false)
        onStatsRef.current?.({
          last: d.last ?? d.candles[d.candles.length - 1].c,
          changePct24h: d.changePct24h ?? null,
          label: d.label,
          source: d.source,
        })
      } else if (d.error) {
        // Keep the last good series on a transient feed error.
        setStale(true)
        setData((cur) => cur ?? d)
      }
    } catch {
      setStale(true)
    }
  }, [symbol, tf])

  useEffect(() => {
    if (!resolvable) return
    setData(null)
    setHover(null)
    void load()
    const timer = setInterval(() => void load(), POLL_MS[tf])
    return () => clearInterval(timer)
  }, [symbol, tf, resolvable, load])

  const candles = data?.candles ?? []

  // ── Layout math ────────────────────────────────────────────────────────────
  const height = fill ? measuredH : heightProp
  const plotW = Math.max(0, width - AXIS_W)
  const volH = Math.round(height * VOL_FRAC)
  const priceH = height - volH - TIME_H - 6
  const layout = useMemo(() => {
    // priceH guard: in fill mode the first paint happens before the
    // ResizeObserver reports, so height is 0 for a frame.
    if (!candles.length || plotW <= 0 || priceH < 40) return null
    let lo = Infinity
    let hi = -Infinity
    let maxV = 0
    for (const c of candles) {
      if (c.l < lo) lo = c.l
      if (c.h > hi) hi = c.h
      if (c.v > maxV) maxV = c.v
    }
    if (!(hi > 0)) return null
    const pad = (hi - lo) * 0.06 || hi * 0.01
    lo -= pad
    hi += pad
    const slot = plotW / candles.length
    const bodyW = Math.max(1.5, Math.min(11, slot * 0.65))
    const y = (p: number) => priceH - ((p - lo) / (hi - lo)) * priceH
    const x = (i: number) => i * slot + slot / 2
    return { lo, hi, maxV, slot, bodyW, x, y }
  }, [candles, plotW, priceH])

  const gridPrices = useMemo(() => {
    if (!layout) return []
    const n = 4
    return Array.from({ length: n }, (_, i) => layout.lo + ((i + 0.5) / n) * (layout.hi - layout.lo))
  }, [layout])

  const timeTicks = useMemo(() => {
    if (!candles.length) return []
    const every = Math.max(1, Math.floor(candles.length / 6))
    return candles.map((c, i) => ({ c, i })).filter(({ i }) => i % every === 0 && i < candles.length - 2)
  }, [candles])

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!layout || !candles.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px > plotW) {
      setHover(null)
      return
    }
    const i = Math.max(0, Math.min(candles.length - 1, Math.floor(px / layout.slot)))
    setHover({ i, y: Math.max(0, Math.min(priceH, py)) })
  }

  const last = candles.length ? candles[candles.length - 1] : null
  const hovered = hover && candles[hover.i] ? candles[hover.i] : null
  const upColor = 'var(--accent)'
  const downColor = 'var(--sell)'

  if (!resolvable) {
    return (
      <div className="rounded-xl border border-[var(--line)] px-4 py-6 text-center text-[12px] text-[color:var(--muted-2)]">
        No live chart for {symbol.toUpperCase()} yet.
      </div>
    )
  }

  return (
    <div className={fill ? 'tok__chart min-h-0 flex-1' : 'tok__chart'}>
      {/* Timeframe row + live/stale badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="tok__tf">
          {CHART_TFS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tok__tfbtn mono${tf === t.key ? ' is-active' : ''}`}
              aria-pressed={tf === t.key}
              onClick={() => setTf(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2.5">
          <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
            {stale ? (
              'feed stalled — retrying'
            ) : (
              <>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: upColor }} />
                live
              </>
            )}
          </span>
          {controlsRight}
        </span>
      </div>

      {/* overflow-hidden: if a measurement is ever a frame behind (fullscreen
          exit), the oversized canvas clips instead of pushing a scrollbar. */}
      <div
        ref={wrapRef}
        className={fill ? 'relative w-full min-h-0 flex-1 overflow-hidden' : 'relative w-full'}
        style={fill ? undefined : { height }}
      >
        {candles.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center rounded-xl border border-[var(--line)]">
            <span className="text-[12px] text-[color:var(--muted-2)]">
              {data?.error ? 'Chart feed unavailable — retrying.' : 'Loading candles…'}
            </span>
          </div>
        ) : layout ? (
          <svg
            width={width}
            height={height}
            className="block select-none"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {/* Grid + price axis */}
            {gridPrices.map((p) => (
              <g key={p}>
                <line x1={0} x2={plotW} y1={layout.y(p)} y2={layout.y(p)} stroke="var(--line)" strokeDasharray="1 4" />
                <text x={plotW + 6} y={layout.y(p) + 3} fontSize={10} className="mono" style={{ fill: 'var(--muted-2)' }}>
                  {fmtPrice(p)}
                </text>
              </g>
            ))}

            {/* Volume strip */}
            {candles.map((c, i) => (
              <rect
                key={`v${c.t}`}
                x={layout.x(i) - layout.bodyW / 2}
                y={priceH + 4 + (layout.maxV > 0 ? (1 - c.v / layout.maxV) * volH : volH)}
                width={layout.bodyW}
                height={layout.maxV > 0 ? Math.max(1, (c.v / layout.maxV) * volH) : 1}
                style={{ fill: c.c >= c.o ? upColor : downColor, opacity: 0.28 }}
              />
            ))}

            {/* Candles */}
            {candles.map((c, i) => {
              const up = c.c >= c.o
              const color = up ? upColor : downColor
              const top = layout.y(Math.max(c.o, c.c))
              const bodyH = Math.max(1, Math.abs(layout.y(c.o) - layout.y(c.c)))
              return (
                <g key={c.t}>
                  <line x1={layout.x(i)} x2={layout.x(i)} y1={layout.y(c.h)} y2={layout.y(c.l)} stroke={color} strokeWidth={1} />
                  <rect x={layout.x(i) - layout.bodyW / 2} y={top} width={layout.bodyW} height={bodyH} style={{ fill: color }} rx={1} />
                </g>
              )
            })}

            {/* Last price marker */}
            {last && (
              <g>
                <line x1={0} x2={plotW} y1={layout.y(last.c)} y2={layout.y(last.c)} stroke={last.c >= last.o ? upColor : downColor} strokeDasharray="3 3" strokeWidth={1} opacity={0.7} />
                <rect x={plotW + 2} y={layout.y(last.c) - 8} width={AXIS_W - 4} height={16} rx={4} style={{ fill: last.c >= last.o ? upColor : downColor }} />
                <text x={plotW + AXIS_W / 2} y={layout.y(last.c) + 3.5} fontSize={10} textAnchor="middle" className="mono" style={{ fill: 'var(--ink)' }}>
                  {fmtPrice(last.c)}
                </text>
              </g>
            )}

            {/* Time axis */}
            {timeTicks.map(({ c, i }) => (
              <text key={`t${c.t}`} x={layout.x(i)} y={height - 4} fontSize={9.5} textAnchor="middle" className="mono" style={{ fill: 'var(--muted-2)' }}>
                {fmtTime(c.t, tf)}
              </text>
            ))}

            {/* Crosshair */}
            {hover && hovered && (
              <g pointerEvents="none">
                <line x1={layout.x(hover.i)} x2={layout.x(hover.i)} y1={0} y2={priceH + volH + 4} stroke="var(--line-2)" strokeDasharray="2 3" />
                <line x1={0} x2={plotW} y1={hover.y} y2={hover.y} stroke="var(--line-2)" strokeDasharray="2 3" />
                <rect x={plotW + 2} y={hover.y - 8} width={AXIS_W - 4} height={16} rx={4} style={{ fill: 'var(--surf-2)', stroke: 'var(--line-2)' }} />
                <text x={plotW + AXIS_W / 2} y={hover.y + 3.5} fontSize={10} textAnchor="middle" className="mono" style={{ fill: 'var(--fg)' }}>
                  {fmtPrice(layout.lo + (1 - hover.y / priceH) * (layout.hi - layout.lo))}
                </text>
              </g>
            )}
          </svg>
        ) : null}

        {/* OHLCV legend for the hovered candle */}
        {hovered && (
          <div className="mono pointer-events-none absolute left-1 top-1 rounded-md border border-[var(--line)] bg-[var(--surf-1)]/90 px-2 py-1 text-[10px] text-[color:var(--muted)]">
            <span className="text-[color:var(--muted-2)]">{fmtHoverTime(hovered.t, tf)}</span>
            {'  O '}
            {fmtPrice(hovered.o)}
            {'  H '}
            {fmtPrice(hovered.h)}
            {'  L '}
            {fmtPrice(hovered.l)}
            {'  C '}
            <span style={{ color: hovered.c >= hovered.o ? upColor : downColor }}>{fmtPrice(hovered.c)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
