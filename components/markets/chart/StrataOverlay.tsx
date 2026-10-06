'use client'

// StrataOverlay — the liquidation clusters drawn ON the candle chart (Nate
// picked it 2026-10-06): translucent strata in the right margin after the
// last candle, the ESTIMATED clusters above and below the price (lib/derivs
// liquidationMap over the chart's own bars), with Hyperliquid's resting
// orders within 2% hugging the last price as two ramparts (MEASURED). A
// stratum glows by its dollars; when price trades into one it flares and
// fades: it was set off.
//
// A pointer-transparent canvas over the plot, positioned with the chart's
// own geometry (DrawingLayer's ChartGeom), so it follows every zoom and pan.
// The chart gives the margin room (MarketChart widens rightOffset while the
// strata are on).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Candle, ChartPair, ChartTf } from '@/lib/charts'
import { bookWalls, fmtUsdShort, liqBuckets, liquidationMap, strataFor, type BookBody, type DerivsBody, type Stratum } from '@/lib/derivs'
import { fmtPrice } from '@/components/CandleChart'
import type { Tokens } from './chart-tokens'
import type { ChartGeom } from './DrawingLayer'

const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const FLARE_MS = 1_600
/** Strata within this much of the price are drawn. */
export const STRATA_PCT = 25
/** The margin the chart leaves right of the last candle while strata are on, in bars. */
export const STRATA_MARGIN_BARS = 14

export interface StrataOverlayProps {
  geom: ChartGeom | null
  bars: Candle[]
  symbol: string
  pair: ChartPair
  tf: ChartTf
  tokens: Tokens
  last: number | null
  /** Called with whether anything is drawn (the chart widens its margin on true). */
  onActive?: (on: boolean) => void
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const rgba = (hex: string, a: number): string => `rgba(${rgb(hex).join(',')},${a})`

export default function StrataOverlay({ geom, bars, symbol, pair, tf, tokens, last, onActive }: StrataOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  const [book, setBook] = useState<BookBody | null>(null)
  const noMarket = pair.source === 'robinhood'
  useEffect(() => {
    setDerivs(null)
    if (noMarket) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
        const body = (await res.json()) as DerivsBody
        if (alive && res.ok && Array.isArray(body.oi)) setDerivs(body)
      } catch {
        /* no strata this read */
      }
    }
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbol, tf, noMarket])
  useEffect(() => {
    setBook(null)
    if (noMarket) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/markets/book?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        const body = (await res.json()) as BookBody
        if (alive && res.ok && Array.isArray(body.bids)) setBook(body)
      } catch {
        /* no ramparts this read */
      }
    }
    void load()
    const t = setInterval(() => void load(), 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [symbol, noMarket])

  const strata = useMemo<Stratum[]>(() => {
    if (!derivs || derivs.oi.length < 2 || bars.length < 2 || !last) return []
    const map = liquidationMap(bars, derivs.oi, derivs.oiUnit)
    return strataFor(liqBuckets(map.alive, last), last, STRATA_PCT)
  }, [derivs, bars, last])
  const walls = useMemo(() => (book && book.mid ? bookWalls(book) : null), [book])
  const active = strata.length > 0 || (walls !== null && (walls.bidUsd > 0 || walls.askUsd > 0))
  useEffect(() => onActive?.(active), [active, onActive])

  // Flares: a stratum that stood last render and is gone now, with the price
  // having moved through it, was set off. Drawn for FLARE_MS, then forgotten.
  const seenRef = useRef<Map<string, Stratum>>(new Map())
  const flaresRef = useRef<{ price: number; side: 'long' | 'short'; usd: number; at: number }[]>([])
  const lastPriceRef = useRef<number | null>(null)
  useEffect(() => {
    const now = performance.now()
    const next = new Map(strata.map((s) => [`${s.side}:${s.price.toPrecision(4)}`, s]))
    const prev = lastPriceRef.current
    if (prev !== null && last !== null) {
      for (const [key, s] of seenRef.current) {
        if (next.has(key)) continue
        const crossed = s.side === 'long' ? Math.min(prev, last) <= s.price : Math.max(prev, last) >= s.price
        if (crossed) flaresRef.current.push({ price: s.price, side: s.side, usd: s.usd, at: now })
      }
    }
    seenRef.current = next
    lastPriceRef.current = last
  }, [strata, last])

  // Draw: once per geometry/data change, and while a flare is alive.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geom) return
    let raf = 0
    const draw = () => {
      const now = performance.now()
      flaresRef.current = flaresRef.current.filter((f) => now - f.at < FLARE_MS)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(geom.width * dpr) || canvas.height !== Math.round(geom.height * dpr)) {
        canvas.width = Math.round(geom.width * dpr)
        canvas.height = Math.round(geom.height * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, geom.width, geom.height)
      if (!active || !bars.length || !last) return
      const lastX = geom.timeToX(bars[bars.length - 1].t)
      if (lastX === null) return
      const barW = bars.length > 1 ? Math.abs((geom.timeToX(bars[bars.length - 1].t) ?? 0) - (geom.timeToX(bars[bars.length - 2].t) ?? 0)) : 8
      const x0 = Math.min(geom.plotRight - 40, lastX + barW + 6)
      const x1 = geom.plotRight - 4
      if (x1 - x0 < 24) return
      const plotBottom = geom.height - 28
      const text = (s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'right') => {
        ctx.font = `9px ${FONT}`
        ctx.textAlign = align
        ctx.textBaseline = 'middle'
        const w = ctx.measureText(s).width
        const xs = align === 'right' ? x - w : x
        ctx.fillStyle = rgba(tokens.bg, 0.8)
        ctx.fillRect(xs - 3, y - 7, w + 6, 14)
        ctx.fillStyle = color
        ctx.fillText(s, x, y)
      }
      // Strata: faint far, bright near; the two biggest a side carry words.
      const labelled = new Set((['long', 'short'] as const).flatMap((side) => strata.filter((s) => s.side === side).slice(0, 2)))
      for (const s of [...strata].sort((a, b) => a.weight - b.weight)) {
        const y = geom.priceToY(s.price)
        if (y === null || y < 4 || y > plotBottom) continue
        const ink = s.side === 'long' ? tokens.up : tokens.down
        const h = 2 + 8 * s.weight
        const g = ctx.createLinearGradient(x0, 0, x1, 0)
        g.addColorStop(0, rgba(ink, 0.08 + 0.3 * s.weight))
        g.addColorStop(1, rgba(ink, 0.18 + 0.55 * s.weight))
        ctx.fillStyle = g
        ctx.fillRect(x0, y - h / 2, x1 - x0, h)
        if (labelled.has(s)) text(`${fmtUsdShort(s.usd)} ${s.side}s · ${fmtPrice(s.price)}`, x1 - 2, y - h / 2 - 8, ink)
      }
      // Ramparts: the resting book within 2%, hugging the price.
      if (walls && (walls.bidUsd > 0 || walls.askUsd > 0)) {
        const y = geom.priceToY(last)
        if (y !== null && y > 4 && y < plotBottom) {
          const max = Math.max(walls.bidUsd, walls.askUsd)
          for (const side of ['long', 'short'] as const) {
            const usd = side === 'long' ? walls.bidUsd : walls.askUsd
            if (usd <= 0) continue
            const ink = side === 'long' ? tokens.up : tokens.down
            const len = (x1 - x0) * (0.2 + 0.8 * (usd / max))
            const yy = side === 'long' ? y + 4 : y - 8
            ctx.fillStyle = rgba(ink, 0.85)
            ctx.fillRect(x0, yy, len, 4)
            ctx.fillStyle = ink
            for (let x = x0; x < x0 + len; x += 6) ctx.fillRect(x, side === 'long' ? yy - 2 : yy + 4, 3, 2)
            text(`${fmtUsdShort(usd)} ${side === 'long' ? 'bids' : 'asks'}`, x0 + len + 4, yy + 2, ink, 'left')
          }
        }
      }
      // Flares: a stratum set off, fading.
      for (const f of flaresRef.current) {
        const y = geom.priceToY(f.price)
        if (y === null) continue
        const k = (now - f.at) / FLARE_MS
        const r = 6 + 26 * k
        const ink = f.side === 'long' ? tokens.up : tokens.down
        ctx.beginPath()
        ctx.arc(x0 + 10, y, r, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(ink, 0.9 * (1 - k))
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = `rgba(255, 206, 120, ${0.6 * (1 - k)})`
        ctx.fill()
        if (k < 0.7) text(`${fmtUsdShort(f.usd)} ${f.side}s set off`, x0 + 10 + r + 6, y, tokens.fg, 'left')
      }
      if (flaresRef.current.length) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [geom, bars, strata, walls, active, last, tokens])

  if (noMarket) return null
  return <canvas ref={canvasRef} className="strata" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: geom?.width ?? 0, height: geom?.height ?? 0, pointerEvents: 'none', zIndex: 2 }} />
}
