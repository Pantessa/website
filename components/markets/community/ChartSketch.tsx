'use client'

// A static SVG sketch of a post's chart state: the post's LINES drawn over
// the market's own candles. A post is an annotated chart (BUSINESS-MODEL §4),
// and the lines are the idea: levels, zones, notes, each with the action it
// carries. The candles are fetched once per symbol + frame for every card on
// the screen (module cache + inflight dedupe, the Sparkline's discipline) and
// only when the card scrolls near view. With no candles (a feed down, a
// symbol with no source) the sketch falls back to the lines on their own
// axis, as it always did. Text is rendered as SVG text nodes, never markup.
//
// A line that cannot be seen is dropped before anything is scaled: a trend
// whose two ends share a time (a stray click on the chart, 2026-11-20) used
// to stretch both axes and squeeze the real drawing into a corner.

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChartLine, ChartState } from '@/lib/chart-state'
import { fibLevels } from '@/lib/chart-draw'
import { chartPairFor, type Candle } from '@/lib/charts'

const W = 320
const H = 180
const PAD_R = 52
const PAD_Y = 12
/** Bars of history shown left of the newest one. */
const BARS = 90
/** The future a line may open up on the right, as a share of the history shown. */
const FUTURE_MAX = 0.6

// ── candles: one fetch per symbol + frame for the whole screen ──
const TTL_MS = 60_000
const cache = new Map<string, { at: number; candles: Candle[] }>()
const inflight = new Map<string, Promise<Candle[]>>()

function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  const pair = chartPairFor(symbol)
  if (!pair) return Promise.resolve([])
  const key = `${pair.symbol}|${tf}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.candles)
  const running = inflight.get(key)
  if (running) return running
  const p = fetch(`/api/charts/candles?symbol=${encodeURIComponent(pair.symbol)}&tf=${encodeURIComponent(tf)}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { candles?: Candle[] } | null) =>
      (Array.isArray(d?.candles) ? d!.candles : []).filter((c) => [c.t, c.o, c.h, c.l, c.c].every((n) => Number.isFinite(n))).slice(-BARS),
    )
    .catch(() => [] as Candle[])
    .then((candles) => {
      cache.set(key, { at: Date.now(), candles })
      return candles
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function useCandles(symbol: string, tf: string, el: RefObject<HTMLDivElement | null>): Candle[] {
  const [candles, setCandles] = useState<Candle[]>(() => cache.get(`${chartPairFor(symbol)?.symbol ?? symbol}|${tf}`)?.candles ?? [])
  useEffect(() => {
    const node = el.current
    if (!node) return
    let live = true
    const load = () => void fetchCandles(symbol, tf).then((c) => live && setCandles(c))
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        live = false
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          load()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(node)
    return () => {
      live = false
      io.disconnect()
    }
  }, [symbol, tf, el])
  return candles
}

/** The lines worth drawing: a trend or fib with no width in time or price draws as a dot and lies about the scale. */
export function visibleLines(lines: readonly ChartLine[]): ChartLine[] {
  return lines.filter((l) => {
    if (l.kind === 'trend') return l.t1 !== l.t2
    if (l.kind === 'fib') return l.p1 !== l.p2
    return true
  })
}

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toPrecision(3)
}

function pricesOf(l: ChartLine): number[] {
  switch (l.kind) {
    case 'h':
      return [l.price]
    case 'trend':
      return [l.p1, l.p2]
    case 'zone':
      return [l.p1, l.p2]
    case 'note':
      return [l.price]
    case 'fib':
      return [l.p1, l.p2]
    case 'vline':
      return []
  }
}

export default function ChartSketch({ state, caption }: { state: ChartState; caption?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const candles = useCandles(state.symbol, state.tf, ref)
  const lines = visibleLines(state.lines)
  const prices = lines.flatMap(pricesOf)
  if (prices.length === 0 && candles.length === 0) {
    return (
      <div ref={ref} className="mkp__sketch" aria-label="Empty chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="No lines on this chart">
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="10" fill="var(--muted-2)" fontFamily="ui-monospace, monospace">
            no lines
          </text>
        </svg>
        {caption && <span className="mkp__sketchcap">{caption}</span>}
      </div>
    )
  }
  // Price axis: the candles shown and every line price, padded.
  const candlePrices = candles.flatMap((c) => [c.h, c.l])
  let lo = Math.min(...prices, ...candlePrices)
  let hi = Math.max(...prices, ...candlePrices)
  if (hi === lo) {
    lo *= 0.97
    hi *= 1.03
  } else {
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
  }
  const y = (p: number) => PAD_Y + ((hi - p) / (hi - lo)) * (H - PAD_Y * 2)
  // Time axis: the candles shown, opened to the right as far as a line reaches into the future (capped).
  const times = lines.flatMap((l) => (l.kind === 'trend' || l.kind === 'fib' ? [l.t1, l.t2] : l.kind === 'note' || l.kind === 'vline' ? [l.t] : []))
  let t0: number
  let t1: number
  if (candles.length >= 2) {
    const first = candles[0].t
    const last = candles[candles.length - 1].t
    t0 = first
    t1 = Math.min(Math.max(last, ...times), last + (last - first) * FUTURE_MAX)
  } else {
    t0 = times.length ? Math.min(...times) : 0
    t1 = times.length ? Math.max(...times) : 1
  }
  const plotW = W - PAD_R - 8
  const x = (t: number) => (t1 === t0 ? plotW / 2 : 4 + ((t - t0) / (t1 - t0)) * (plotW - 4))
  const barW = candles.length >= 2 ? Math.max(0.6, Math.min(4, ((x(candles[1].t) - x(candles[0].t)) || 2) * 0.6)) : 0
  const lastClose = candles.length ? candles[candles.length - 1].c : null

  return (
    <div ref={ref} className="mkp__sketch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${lines.length} lines on ${state.symbol} ${state.tf}`}>
        <defs>
          <clipPath id={`sk-${state.symbol}-${lines.length}`}>
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        {/* faint grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W - PAD_R} y1={PAD_Y + f * (H - PAD_Y * 2)} y2={PAD_Y + f * (H - PAD_Y * 2)} stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 3" />
        ))}
        {/* the market's own candles, quiet under the idea */}
        <g opacity="0.55" data-sketch-candles={candles.length || undefined}>
          {candles.map((c) => {
            const up = c.c >= c.o
            const cx = x(c.t)
            const top = y(Math.max(c.o, c.c))
            const bot = y(Math.min(c.o, c.c))
            return (
              <g key={c.t} stroke={up ? 'var(--up)' : 'var(--sell)'} fill={up ? 'var(--up)' : 'var(--sell)'}>
                <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} strokeWidth="0.6" />
                <rect x={cx - barW / 2} y={top} width={barW} height={Math.max(0.6, bot - top)} stroke="none" />
              </g>
            )
          })}
        </g>
        {lastClose !== null && (
          <g>
            <line x1={0} x2={W - PAD_R} y1={y(lastClose)} y2={y(lastClose)} stroke="var(--muted-2)" strokeWidth="0.5" strokeDasharray="1 2" />
            <text x={W - PAD_R + 4} y={y(lastClose) + 3} fontSize="8.5" fill="var(--fg)" fontFamily="ui-monospace, monospace">
              {fmt(lastClose)}
            </text>
          </g>
        )}
        <g clipPath={`url(#sk-${state.symbol}-${lines.length})`}>
        {lines.map((l) => {
          if (l.kind === 'zone') {
            const top = y(Math.max(l.p1, l.p2))
            const bot = y(Math.min(l.p1, l.p2))
            const color = l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect' ? 'var(--sell)' : 'var(--up)'
            return (
              <g key={l.id}>
                <rect x={0} y={top} width={W - PAD_R} height={Math.max(2, bot - top)} fill={color} opacity="0.16" />
                <text x={W - PAD_R + 4} y={top + 4} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                  {fmt(Math.max(l.p1, l.p2))}
                </text>
                <text x={W - PAD_R + 4} y={bot + 3} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                  {fmt(Math.min(l.p1, l.p2))}
                </text>
                {l.label && (
                  <text x={4} y={top + 10} fontSize="8.5" fill={color} fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'h') {
            const yy = y(l.price)
            const color = l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect' ? 'var(--sell)' : 'var(--up)'
            return (
              <g key={l.id}>
                <line x1={0} x2={W - PAD_R} y1={yy} y2={yy} stroke={color} strokeWidth="1.2" strokeDasharray={l.action ? undefined : '4 3'} />
                <text x={W - PAD_R + 4} y={yy + 3} fontSize="9" fill="var(--fg)" fontFamily="ui-monospace, monospace">
                  {fmt(l.price)}
                </text>
                {(l.label || l.action) && (
                  <text x={4} y={yy - 3} fontSize="8.5" fill={color} fontFamily="ui-monospace, monospace">
                    {(l.label ?? l.action?.kind ?? '').slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'vline') {
            return (
              <g key={l.id}>
                <line x1={x(l.t)} x2={x(l.t)} y1={PAD_Y} y2={H - PAD_Y} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
                {l.label && (
                  <text x={x(l.t) + 3} y={PAD_Y + 8} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 18)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'fib') {
            const left = Math.min(x(l.t1), x(l.t2))
            return (
              <g key={l.id}>
                {fibLevels(l.p1, l.p2).map((lv) =>
                  lv.price < lo || lv.price > hi ? null : (
                    <g key={lv.ratio}>
                      <line x1={left} x2={W - PAD_R} y1={y(lv.price)} y2={y(lv.price)} stroke={lv.ratio === 0 || lv.ratio === 1 ? 'var(--fg)' : 'var(--accent)'} strokeWidth="0.8" strokeDasharray={lv.ratio > 1 ? '2 2' : undefined} opacity="0.7" />
                      <text x={W - PAD_R + 4} y={y(lv.price) + 3} fontSize="7.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                        {lv.label}
                      </text>
                    </g>
                  ),
                )}
              </g>
            )
          }
          if (l.kind === 'trend') {
            return (
              <g key={l.id}>
                <line x1={x(l.t1)} y1={y(l.p1)} x2={x(l.t2)} y2={y(l.p2)} stroke="var(--fg)" strokeWidth="1.2" opacity="0.8" />
                {l.label && (
                  <text x={x(l.t2) - 2} y={y(l.p2) - 4} fontSize="8.5" fill="var(--muted)" textAnchor="end" fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          return (
            <g key={l.id}>
              <circle cx={x(l.t)} cy={y(l.price)} r="3" fill="var(--fg)" />
              <text x={Math.min(x(l.t) + 6, W - PAD_R - 40)} y={y(l.price) + 3} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                {l.text.slice(0, 18)}
              </text>
            </g>
          )
        })}
        </g>
      </svg>
      <span className="mkp__sketchcap">{caption ?? `${state.symbol} · ${state.tf} · ${lines.length} line${lines.length === 1 ? '' : 's'}`}</span>
    </div>
  )
}
