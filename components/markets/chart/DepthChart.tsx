'use client'

// DepthChart — the chart's Depth view (2026-10-13). Nate, with Coinbase's
// UNI depth chart: "can we build a depth chart on an asset like this using
// the realtime Dune data showing the order book stack?"
//
// Three layers, bottom to top, every pixel a measured number:
//   1. THE BOOK — the venue's resting orders, cumulated from the mid outward:
//      bids stepping up leftward in the up ink, asks rightward in the down
//      ink, filled under; the mid line with its label; the price along the
//      bottom, the size up the right (dollars by default, the venue's units
//      on a toggle). Coinbase's level-2 book for a spot coin, Hyperliquid's
//      l2Book for a perp — pushed over the venue's own keyless socket
//      (lib/depth-feed), polled from our routes when a socket is refused.
//   2. THE OTHER VENUE — a coin chart can lay Hyperliquid's perp book over
//      Coinbase's as a thin outline. A DIFFERENT instrument: labeled, off by
//      default.
//   3. THE PRINTS — Dune's executions of this instrument land on the curve
//      where they hit (a buy lifts the asks), sized by notional, fading over
//      eight seconds; the strip under the chart keeps the last few. This is
//      the layer only Dune gives, and the foot says so.
//
// Act: a level is a price. Clicking one on the bids aims the order ticket at
// a limit BUY resting there, on the asks a limit SELL (lib/depth limitAimAt;
// the ticket's own rule — the two orders that rest). A hover reads the level:
// price · size there · cumulative · "$N to move the mid here".
//
// The canvas draws numbers; the chips, the readout, the tape and the foot
// are DOM so they theme with the page. Inks come from the chart's own tokens
// (chart-tokens), never a color-mix() into a fillStyle.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChartPair } from '@/lib/charts'
import type { TapeFill } from '@/lib/tape'
import { venueTag } from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'
import { openBookFeed } from '@/lib/depth-feed'
import {
  DEFAULT_DEPTH_UNIT,
  DEFAULT_DEPTH_WINDOW_PCT,
  DEPTH_TAPE_ROWS,
  DEPTH_VENUE_LABEL,
  DEPTH_WINDOWS,
  PRINT_FADE_MS,
  axisSteps,
  bookWords,
  costToMove,
  depthPlanFor,
  depthWindow,
  fmtDepthPrice,
  fmtDepthSize,
  fmtDepthUsd,
  levelAt,
  limitAimAt,
  printAlpha,
  printOnBook,
  printRadius,
  printWords,
  wallsIn,
  type BookFeedStatus,
  type DepthBook,
  type DepthSide,
  type DepthUnit,
  type DepthWindow,
} from '@/lib/depth'
import type { Tokens } from './chart-tokens'
import './depth.css'

export interface DepthPrint {
  id: string
  at: number
  price: number
  size: number
  usd: number
  side: 'buy' | 'sell'
  tag: string
}

export interface DepthChartProps {
  symbol: string
  pair: ChartPair
  tokens: Tokens
  /** The chart's last close — the header's number, shown beside the mid. */
  last: number | null
  /** Hyperliquid lists a perp for this coin: the second book is offered. */
  perpListed: boolean
  /** The chart's print stream: the view registers its sink here and the
   *  chart's one relay stream (MarketChart) hands every batch over. */
  printSink: React.MutableRefObject<((fills: readonly TapeFill[]) => void) | null>
  /** The print stream's state, null when this instrument has no feed. */
  printStatus: FeedStatus | null
  printLabel: string | null
  /** A level clicked: aim the ticket at a limit there. Absent = no act. */
  onLevel?: (side: 'buy' | 'sell', price: number) => void
}

const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const PAD = { t: 26, r: 58, b: 26, l: 10 }
const PRINT_RING_MAX = 240

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (hex: string, a: number): string => (/^#[0-9a-f]{3,6}$/i.test(hex) ? `rgba(${rgb(hex).join(',')},${a})` : hex)

interface Geom {
  w: number
  h: number
  plotW: number
  plotH: number
}

export default function DepthChart({ symbol, pair, tokens, last, perpListed, printSink, printStatus, printLabel, onLevel }: DepthChartProps) {
  const plan = useMemo(() => depthPlanFor(pair, perpListed), [pair, perpListed])
  const [pct, setPct] = useState<number | null>(DEFAULT_DEPTH_WINDOW_PCT)
  const [unit, setUnit] = useState<DepthUnit>(DEFAULT_DEPTH_UNIT)
  const [otherOn, setOtherOn] = useState(false)
  const [main, setMain] = useState<DepthBook | null>(null)
  const [mainStatus, setMainStatus] = useState<BookFeedStatus>('idle')
  const [other, setOther] = useState<DepthBook | null>(null)
  const [otherStatus, setOtherStatus] = useState<BookFeedStatus>('idle')
  const [prints, setPrints] = useState<DepthPrint[]>([])
  const [hoverPx, setHoverPx] = useState<number | null>(null)
  const [geom, setGeom] = useState<Geom>({ w: 0, h: 0, plotW: 0, plotH: 0 })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  // ── The books ──
  useEffect(() => {
    setMain(null)
    if (!plan.main) {
      setMainStatus('missing')
      return
    }
    const h = openBookFeed(plan.main, pair, { onBook: setMain, onStatus: setMainStatus })
    return () => h.close()
  }, [plan.main, pair])
  useEffect(() => {
    setOther(null)
    if (!plan.other || !otherOn) {
      setOtherStatus('idle')
      return
    }
    const h = openBookFeed(plan.other, pair, { onBook: setOther, onStatus: setOtherStatus })
    return () => h.close()
  }, [plan.other, otherOn, pair])

  // ── The prints (from the chart's stream) ──
  useEffect(() => {
    setPrints([])
    printSink.current = (fills) => {
      if (!fills.length) return
      setPrints((prev) => {
        const next = [...prev]
        for (const f of fills) {
          if (!(f.price > 0)) continue
          next.push({ id: f.id, at: f.at, price: f.price, size: f.size, usd: f.usd, side: f.side, tag: venueTag(f.venue, f.chainId) })
        }
        next.sort((a, b) => a.at - b.at)
        return next.length > PRINT_RING_MAX ? next.slice(next.length - PRINT_RING_MAX) : next
      })
    }
    return () => {
      printSink.current = null
    }
  }, [printSink, symbol])

  // ── Geometry ──
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const r = host.getBoundingClientRect()
      const w = Math.max(0, Math.round(r.width))
      const h = Math.max(0, Math.round(r.height))
      setGeom({ w, h, plotW: Math.max(0, w - PAD.l - PAD.r), plotH: Math.max(0, h - PAD.t - PAD.b) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    // Belt: a pane that never paints delivers no ResizeObserver callbacks
    // (the hidden Browser pane); a window resize re-measures regardless.
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  // And on every draw: a host whose size the observer missed is re-measured.
  const geomRef = useRef(geom)
  geomRef.current = geom
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    if (w !== geomRef.current.w || h !== geomRef.current.h) setGeom({ w, h, plotW: Math.max(0, w - PAD.l - PAD.r), plotH: Math.max(0, h - PAD.t - PAD.b) })
  })

  const win = useMemo(() => (main ? depthWindow(main, pct) : null), [main, pct])
  const otherWin = useMemo(() => (other && win ? depthWindow(other, pct) : null), [other, win, pct])
  const walls = useMemo(() => (win ? wallsIn(win, 1) : null), [win])
  const yMax = useMemo(() => {
    if (!win) return 0
    const m = unit === 'usd' ? win.maxCumUsd : win.maxCum
    const o = otherWin && otherOn ? (unit === 'usd' ? otherWin.maxCumUsd : otherWin.maxCum) : 0
    return Math.max(m, o) * 1.08
  }, [win, otherWin, otherOn, unit])

  const xOf = useCallback((price: number, w: DepthWindow, g: Geom) => PAD.l + ((price - w.lo) / (w.hi - w.lo)) * g.plotW, [])
  const yOf = useCallback((cum: number, g: Geom, max: number) => PAD.t + g.plotH - (max > 0 ? (cum / max) * g.plotH : 0), [])
  const priceAtX = useCallback((x: number, w: DepthWindow, g: Geom) => w.lo + ((x - PAD.l) / Math.max(1, g.plotW)) * (w.hi - w.lo), [])

  // ── Draw ──
  const drawRef = useRef<() => void>(() => {})
  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas || geom.w === 0 || geom.h === 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(geom.w * dpr) || canvas.height !== Math.round(geom.h * dpr)) {
      canvas.width = Math.round(geom.w * dpr)
      canvas.height = Math.round(geom.h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, geom.w, geom.h)
    ctx.fillStyle = tokens.bg
    ctx.fillRect(0, 0, geom.w, geom.h)
    if (!win) return
    const g = geom
    const bottom = PAD.t + g.plotH
    const val = (l: { cum: number; cumUsd: number }) => (unit === 'usd' ? l.cumUsd : l.cum)

    // Grid + the size axis (right).
    ctx.font = `10px ${FONT}`
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = tokens.grid
    ctx.lineWidth = 1
    for (const v of axisSteps(yMax)) {
      const y = Math.round(yOf(v, g, yMax)) + 0.5
      ctx.beginPath()
      ctx.moveTo(PAD.l, y)
      ctx.lineTo(PAD.l + g.plotW, y)
      ctx.stroke()
      ctx.fillStyle = tokens.muted2
      ctx.textAlign = 'left'
      ctx.fillText(unit === 'usd' ? fmtDepthUsd(v) : fmtDepthSize(v), PAD.l + g.plotW + 6, y)
    }

    // One side's step curve, mid outward; returns the path for the fill.
    const curve = (rows: DepthWindow['bids'] | DepthWindow['asks'], side: DepthSide, ink: string, fill: boolean, width: number, dash: number[] | null) => {
      if (!rows.length) return
      const edgeX = side === 'bid' ? PAD.l : PAD.l + g.plotW
      const midX = xOf(win.mid, win, g)
      ctx.beginPath()
      ctx.moveTo(midX, bottom)
      let y = bottom
      for (const r of rows) {
        const x = xOf(r.px, win, g)
        ctx.lineTo(x, y)
        y = yOf(val(r), g, yMax)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(edgeX, y)
      if (fill) {
        ctx.lineTo(edgeX, bottom)
        ctx.closePath()
        ctx.fillStyle = rgba(ink, 0.16)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.moveTo(midX, bottom)
      y = bottom
      for (const r of rows) {
        const x = xOf(r.px, win, g)
        ctx.lineTo(x, y)
        y = yOf(val(r), g, yMax)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(edgeX, y)
      ctx.strokeStyle = ink
      ctx.lineWidth = width
      ctx.setLineDash(dash ?? [])
      ctx.stroke()
      ctx.setLineDash([])
    }
    // The other venue under the main book (a thin dashed outline).
    if (otherOn && otherWin) {
      // Its own mid may sit a hair off ours: drawn on OUR price scale, from ITS mid.
      const ow = otherWin
      const map = (rows: DepthWindow['bids'], side: DepthSide) => {
        if (!rows.length) return
        ctx.beginPath()
        ctx.moveTo(xOf(ow.mid, win, g), bottom)
        let y = bottom
        for (const r of rows) {
          const x = xOf(r.px, win, g)
          ctx.lineTo(x, y)
          y = yOf(val(r), g, yMax)
          ctx.lineTo(x, y)
        }
        ctx.lineTo(side === 'bid' ? PAD.l : PAD.l + g.plotW, y)
        ctx.strokeStyle = rgba(tokens.compare, 0.9)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
      map(ow.bids, 'bid')
      map(ow.asks, 'ask')
    }
    curve(win.bids, 'bid', tokens.up, true, 1.5, null)
    curve(win.asks, 'ask', tokens.down, true, 1.5, null)

    // The walls: the largest single level each side, named in dollars.
    if (walls) {
      ctx.font = `9px ${FONT}`
      for (const [side, rows] of [['bid', walls.bids], ['ask', walls.asks]] as const) {
        const r = rows[0]
        if (!r || r.size * r.px < win.maxCumUsd * 0.03) continue
        const x = xOf(r.px, win, g)
        const y = yOf(val(r), g, yMax)
        const ink = side === 'bid' ? tokens.up : tokens.down
        ctx.strokeStyle = rgba(ink, 0.7)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y - 14)
        ctx.stroke()
        ctx.fillStyle = tokens.fg
        ctx.textAlign = side === 'bid' ? 'right' : 'left'
        ctx.fillText(`wall ${fmtDepthUsd(r.size * r.px)}`, x + (side === 'bid' ? -3 : 3), y - 18)
      }
    }

    // The mid.
    const midX = Math.round(xOf(win.mid, win, g)) + 0.5
    ctx.strokeStyle = rgba(tokens.muted, 0.9)
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(midX, PAD.t - 6)
    ctx.lineTo(midX, bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = `10px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = tokens.fg
    ctx.fillText(`MID $${fmtDepthPrice(win.mid)}`, midX, PAD.t - 14)

    // The price axis (bottom): the window's edges, the mid, two more each side.
    ctx.fillStyle = tokens.muted2
    ctx.textBaseline = 'top'
    const ticks = [win.lo, win.lo + (win.mid - win.lo) / 2, win.mid, win.mid + (win.hi - win.mid) / 2, win.hi]
    ticks.forEach((p, i) => {
      const x = xOf(p, win, g)
      ctx.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
      if (i === 2) return
      ctx.fillText(fmtDepthPrice(p), x, bottom + 8)
    })
    ctx.textBaseline = 'middle'

    // The prints: a dot on the curve where each hit, fading.
    const now = Date.now()
    for (const p of prints) {
      const a = printAlpha(p.at, now)
      if (a <= 0) continue
      if (p.price < win.lo || p.price > win.hi) continue
      const side = printOnBook(p, win.mid)
      const lv = levelAt(win, p.price)
      const x = xOf(p.price, win, g)
      const y = lv ? yOf(val(lv.level), g, yMax) : bottom
      const r = printRadius(p.usd)
      const ink = p.side === 'buy' ? tokens.up : tokens.down
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = rgba(ink, 0.22 * a)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, Math.max(2, r * 0.45), 0, Math.PI * 2)
      ctx.fillStyle = rgba(ink, 0.95 * a)
      ctx.fill()
      ctx.strokeStyle = rgba(tokens.bg, 0.8 * a)
      ctx.lineWidth = 1
      ctx.stroke()
      void side
    }

    // The hover: a vertical line and a dot on the curve.
    if (hoverPx != null && hoverPx >= win.lo && hoverPx <= win.hi) {
      const x = Math.round(xOf(hoverPx, win, g)) + 0.5
      ctx.strokeStyle = tokens.crosshair
      ctx.beginPath()
      ctx.moveTo(x, PAD.t)
      ctx.lineTo(x, bottom)
      ctx.stroke()
      const lv = levelAt(win, hoverPx)
      if (lv) {
        const y = yOf(val(lv.level), g, yMax)
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = lv.side === 'bid' ? tokens.up : tokens.down
        ctx.fill()
        ctx.strokeStyle = tokens.bg
        ctx.stroke()
      }
    }
  }

  // Redraw on data; while a print is still fading, keep a frame loop.
  useEffect(() => {
    drawRef.current()
    const newest = prints.length ? prints[prints.length - 1].at : 0
    if (reduced || !newest || Date.now() - newest > PRINT_FADE_MS) return
    let raf = 0
    const frame = () => {
      drawRef.current()
      if (Date.now() - newest > PRINT_FADE_MS) return
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [win, otherWin, otherOn, unit, yMax, prints, hoverPx, geom, tokens, walls, reduced])

  // ── Pointer ──
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!win) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    if (x < PAD.l || x > PAD.l + geom.plotW) {
      setHoverPx(null)
      return
    }
    setHoverPx(priceAtX(x, win, geom))
  }
  const hover = useMemo(() => {
    if (!win || hoverPx == null || !main) return null
    const lv = levelAt(win, hoverPx)
    if (!lv) return { px: hoverPx, side: hoverPx < win.mid ? ('bid' as const) : ('ask' as const), level: null, cost: 0 }
    return { px: hoverPx, side: lv.side, level: lv.level, cost: costToMove(main, lv.level.px) }
  }, [win, hoverPx, main])
  const acts = !!onLevel && plan.main === 'coinbase'
  const act = () => {
    if (!acts || !hover?.level || !onLevel) return
    const aim = limitAimAt(hover.side, hover.level.px)
    if (aim) onLevel(aim.side, aim.limitPrice)
  }
  const onClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // A mouse click acts; a finger places the readout, whose button acts.
    if (e.pointerType === 'touch') return
    act()
  }

  const readoutLeft = hover && win ? Math.min(geom.w - 230, Math.max(0, xOf(hover.px, win, geom) + (hover.side === 'bid' ? 12 : -232))) : 0
  const tape = prints.slice(-DEPTH_TAPE_ROWS).reverse()
  const mainWords = bookWords(plan.main, mainStatus)
  const pWords = printWords(printLabel, printStatus, prints.length)

  return (
    <div className={`dp${hover ? ' is-hover' : ''}`} data-book={plan.main ?? 'none'} data-status={mainStatus} data-prints={prints.length} data-window={pct ?? 'all'} data-unit={unit}>
      <div className="dp__bar">
        <div className="dp__chips" role="group" aria-label="Window">
          {DEPTH_WINDOWS.map((w) => (
            <button key={w.label} type="button" className={`dp__chip mono${pct === w.pct ? ' is-on' : ''}`} aria-pressed={pct === w.pct} title={w.pct == null ? 'The whole book' : `±${w.pct}% of the mid`} onClick={() => setPct(w.pct)}>
              {w.label}
            </button>
          ))}
        </div>
        <div className="dp__chips" role="group" aria-label="Size axis">
          <button type="button" className={`dp__chip mono${unit === 'usd' ? ' is-on' : ''}`} aria-pressed={unit === 'usd'} title="Cumulative size in dollars" onClick={() => setUnit('usd')}>
            $
          </button>
          <button type="button" className={`dp__chip mono${unit === 'base' ? ' is-on' : ''}`} aria-pressed={unit === 'base'} title={`Cumulative size in ${pair.symbol}`} onClick={() => setUnit('base')}>
            {pair.symbol}
          </button>
        </div>
        {plan.other && (
          <button type="button" className={`dp__chip dp__chip--other mono${otherOn ? ' is-on' : ''}`} aria-pressed={otherOn} title={`${DEPTH_VENUE_LABEL[plan.other]} — a different book, drawn as an outline`} onClick={() => setOtherOn((v) => !v)}>
            <i className="dp__sw dp__sw--other" aria-hidden="true" />+ {DEPTH_VENUE_LABEL[plan.other]}
          </button>
        )}
        <p className="dp__legend mono">
          {plan.main && (
            <span>
              <i className="dp__sw dp__sw--bid" aria-hidden="true" />
              bids {win ? fmtDepthUsd(win.bidUsd) : '—'}
            </span>
          )}
          {plan.main && (
            <span>
              <i className="dp__sw dp__sw--ask" aria-hidden="true" />
              asks {win ? fmtDepthUsd(win.askUsd) : '—'}
            </span>
          )}
          {plan.main && win && pct != null ? <span>within ±{pct}%</span> : null}
          {plan.other && otherOn && otherWin ? (
            <span>
              <i className="dp__sw dp__sw--other" aria-hidden="true" />
              {DEPTH_VENUE_LABEL[plan.other]} {fmtDepthUsd(otherWin.bidUsd)} / {fmtDepthUsd(otherWin.askUsd)} · one scale
            </span>
          ) : null}
          {plan.main && last != null && win ? <span>last ${fmtDepthPrice(last)}</span> : null}
        </p>
      </div>
      <div ref={hostRef} className="dp__plot">
        <canvas ref={canvasRef} className="dp__canvas" style={{ width: geom.w, height: geom.h }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => e.pointerType !== 'touch' && setHoverPx(null)} onPointerUp={onClick} role="img" aria-label={win ? `${DEPTH_VENUE_LABEL[plan.main!]} depth for ${pair.symbol}: ${fmtDepthUsd(win.bidUsd)} of bids and ${fmtDepthUsd(win.askUsd)} of asks within the window, mid $${fmtDepthPrice(win.mid)}` : 'Depth chart'} />
        {plan.main && !win && (
          <p className="dp__empty mono">{mainStatus === 'missing' ? `${DEPTH_VENUE_LABEL[plan.main]} does not list ${pair.symbol}` : mainStatus === 'reconnecting' ? 'book · reconnecting' : 'reading the book…'}</p>
        )}
        {!plan.main && <p className="dp__empty dp__empty--why">{plan.why}</p>}
        {hover && win && (
          <div className="dp__readout mono" style={{ left: readoutLeft }} data-side={hover.side}>
            <b>${fmtDepthPrice(hover.level ? hover.level.px : hover.px)}</b>
            {hover.level ? (
              <>
                <span>
                  {fmtDepthSize(hover.level.size)} {pair.symbol} resting here · {fmtDepthUsd(hover.level.size * hover.level.px)}
                </span>
                <span>
                  {fmtDepthSize(hover.level.cum)} {pair.symbol} resting between the mid and here
                </span>
                <span className="dp__cost">{fmtDepthUsd(hover.cost)} to move the mid here</span>
                {acts && (
                  <button type="button" className="dp__act mono" onClick={act}>
                    limit {hover.side === 'bid' ? 'buy' : 'sell'} {pair.symbol} at ${fmtDepthPrice(hover.level.px)}
                  </button>
                )}
              </>
            ) : (
              <span>inside the spread · nothing rests here</span>
            )}
          </div>
        )}
      </div>
      <ul className="dp__tape mono" aria-label="Prints">
        {tape.length === 0 ? (
          <li className="dp__tape-empty">{printLabel && printStatus && printStatus !== 'unconfigured' && printStatus !== 'closed' ? 'waiting for the first print' : 'no prints for this instrument'}</li>
        ) : (
          tape.map((p) => (
            <li key={p.id} className={`dp__print dp__print--${p.side}`}>
              <span className="dp__print-side">{p.side === 'buy' ? 'BUY' : 'SELL'}</span>
              <span>{fmtDepthSize(p.size)} {pair.symbol}</span>
              <span>@ ${fmtDepthPrice(p.price)}</span>
              <span className="dp__print-usd">{fmtDepthUsd(p.usd)}</span>
              <span className="dp__print-tag">{p.tag}</span>
            </li>
          ))
        )}
      </ul>
      <p className="dp__foot mono">
        <span>{mainWords}</span>
        {plan.other && otherOn ? <span> · outline · {bookWords(plan.other, otherStatus)}</span> : null}
        <span> · {pWords}</span>
        {acts ? <span> · click a level → a limit order there</span> : plan.main ? <span> · no resting-order lane for this instrument</span> : null}
      </p>
    </div>
  )
}
