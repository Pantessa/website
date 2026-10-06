'use client'

// FrontBoard — the chart's Battlefield view: the market's two sides as two
// armies on a tilted table, with no candles on it (Nate, 2026-10-06: "skip
// the candle charts"). Depth is price: the front line across the middle is
// the price right now, the ground in front of it is the buyers'/longs',
// the ground behind it the sellers'/shorts'. Every tank on it is a number.
//
//   PERPS   tank = a round dollar amount of ESTIMATED leveraged positions
//           (lib/derivs liquidationMap), standing at the price where they
//           liquidate; ramparts = Hyperliquid's resting orders within 2%
//           (MEASURED); banners = the share of accounts on each side
//           (MEASURED); funding rides a wagon from the side that pays; a
//           player is one position with its entry and its break line
//   SPOT    tank = a round dollar amount of orders RESTING on Coinbase's
//           book (MEASURED), standing at their price; banners = which side
//           has the deeper book within 5%
//   HEAT    the contribution-graph: one cell per UTC day for a year, inked
//           by which side was crowded and how much (MEASURED daily share)
//
// A canvas draws the table; the words over it (the date, the read, the
// toggle, the player row, a row's report) are DOM so they theme with the
// page. lib/battlefield has the projection, lib/derivs the rules.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAccount } from 'wagmi'
import type { Candle, ChartPair, ChartTf } from '@/lib/charts'
import { fieldDate, fieldProjector, type FieldBox } from '@/lib/battlefield'
import {
  PLAYER_LEVERAGES,
  PLAYER_SIZES,
  bookRows,
  bookWalls,
  crowdRead,
  fmtUsdShort,
  fuelBeforePlayer,
  fuelWithin,
  fundingLine,
  heatCells,
  heatMedian,
  heatSummary,
  heatTone,
  liqBuckets,
  liquidationMap,
  oiAtBars,
  parsePlayer,
  playerState,
  spotRead,
  unitUsd,
  unitsFor,
  type BookBody,
  DAY_SEC,
  type DerivsBody,
  type HeatCell,
  type Player,
  type PlayerState,
} from '@/lib/derivs'
import { composeExecAsk } from '@/lib/trade-asks'
import { hasPerpCold } from '@/lib/symbol-venues'
import type { PerpPosition } from '@/lib/symbol-position'
import { fmtPrice } from '@/components/CandleChart'
import type { BoardMode } from '@/lib/markets'
import type { Tokens } from './chart-tokens'
import './battlefield.css'

export interface FrontBoardProps {
  symbol: string
  pair: ChartPair
  tf: ChartTf
  /** The live window: the last price and the last 24 hours' range come from it. */
  bars: Candle[]
  tokens: Tokens
  onAsk?: (ask: string) => void
  canAsk?: (ask: string) => boolean
  /** The board a shared link named (`?board=`); null = this browser's last pick, else perps. */
  board?: Mode | null
  onBoard?: (m: Mode) => void
}

type Mode = BoardMode
const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const TILT_MS = 900
/** The strip under the table (the toggle + legend, then the player). */
const CTL_STRIP = 76
/** Half the price range the table shows, per mode. */
const RANGE_PCT: Record<Mode, number> = { perps: 25, spot: 10, heat: 25 }
/** A spot row is this wide (of the mid). */
const SPOT_STEP_PCT = 1
const PLAYER_KEY = 'pantessa.bf.player.v1'
const MODE_KEY = 'pantessa.bf.mode.v1'

interface StoredPlayer {
  side: 'long' | 'short'
  leverage: number
  usd: number
  entry: number | null
}
type BoardPlayer = Player & { live: boolean; atMarket: boolean }

/** One line of tanks on the table. */
interface Row {
  side: 'long' | 'short'
  price: number
  usd: number
  units: number
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const mix = (a: string, b: string, t: number): string => {
  const A = rgb(a)
  const B = rgb(b)
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`
}
const rgba = (hex: string, a: number): string => `rgba(${rgb(hex).join(',')},${a})`
const ease = (t: number) => 1 - (1 - t) ** 3
const pctOf = (price: number, mark: number) => `${price >= mark ? '+' : '−'}${Math.abs((price / mark - 1) * 100).toFixed(1)}%`

export default function FrontBoard({ symbol, pair, tf, bars, tokens, onAsk, canAsk, board, onBoard }: FrontBoardProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<Mode>('perps')
  const [hover, setHover] = useState<{ row: Row; x: number; y: number } | null>(null)
  const mountedAtRef = useRef<number | null>(null)
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const noMarket = pair.source === 'robinhood'
  const n = bars.length
  const mark = n ? bars[n - 1].c : 0

  useEffect(() => {
    if (board) {
      setMode(board)
      return
    }
    try {
      const m = localStorage.getItem(MODE_KEY)
      if (m === 'spot' || m === 'perps' || m === 'heat') setMode(m)
    } catch {
      /* default */
    }
  }, [board])
  const pickMode = (m: Mode) => {
    setMode(m)
    onBoard?.(m)
    setHover(null)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* this visit only */
    }
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Data ─────────────────────────────────────────────────────────────────
  const poll = <T,>(url: string | null, ms: number, ok: (b: T) => boolean, set: (b: T | null) => void) => {
    set(null)
    if (!url) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        const body = (await res.json()) as T
        if (alive && res.ok && ok(body)) set(body)
      } catch {
        /* the table draws without it */
      }
    }
    void load()
    const timer = setInterval(() => void load(), ms)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  const [hlBook, setHlBook] = useState<BookBody | null>(null)
  const [spotBook, setSpotBook] = useState<BookBody | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => poll<DerivsBody>(noMarket ? null : `/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, 60_000, (b) => Array.isArray(b.oi), setDerivs), [symbol, tf, noMarket])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => poll<BookBody>(noMarket ? null : `/api/markets/book?symbol=${encodeURIComponent(symbol)}`, 10_000, (b) => Array.isArray(b.bids), setHlBook), [symbol, noMarket])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => poll<BookBody>(noMarket ? null : `/api/markets/spot-book?symbol=${encodeURIComponent(symbol)}`, 15_000, (b) => Array.isArray(b.bids), setSpotBook), [symbol, noMarket])

  // The heatmap's daily series: the chart's own read when it is on 1D, else its own.
  const [dailyDerivs, setDailyDerivs] = useState<DerivsBody | null>(null)
  const [dailyBars, setDailyBars] = useState<Candle[]>([])
  const wantDaily = mode === 'heat' && !noMarket
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => poll<DerivsBody>(wantDaily && tf !== '1d' ? `/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=1d` : null, 120_000, (b) => Array.isArray(b.oi), setDailyDerivs), [symbol, wantDaily, tf])
  useEffect(() => {
    setDailyBars([])
    if (!wantDaily) return
    let alive = true
    fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1d&warmup=1`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { candles?: Candle[]; warmup?: Candle[] }) => {
        if (alive && Array.isArray(d.candles)) setDailyBars([...(d.warmup ?? []), ...d.candles])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [symbol, wantDaily])
  const [heatHover, setHeatHover] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)

  // The player (perps): a what-if kept per symbol in this browser, or the wallet's real position.
  const { address } = useAccount()
  const [stored, setStored] = useState<StoredPlayer | null>(null)
  const [placing, setPlacing] = useState(false)
  const [livePos, setLivePos] = useState<PerpPosition | null>(null)
  useEffect(() => {
    setPlacing(false)
    try {
      const all = JSON.parse(localStorage.getItem(PLAYER_KEY) ?? '{}') as Record<string, unknown>
      const raw = all[symbol] as Record<string, unknown> | undefined
      const ok = raw ? parsePlayer({ ...raw, entry: raw.entry ?? 1 }) : null
      setStored(ok && raw ? { side: ok.side, leverage: ok.leverage, usd: ok.usd, entry: typeof raw.entry === 'number' ? ok.entry : null } : null)
    } catch {
      setStored(null)
    }
  }, [symbol])
  const savePlayer = useCallback(
    (next: StoredPlayer | null) => {
      setStored(next)
      try {
        const all = JSON.parse(localStorage.getItem(PLAYER_KEY) ?? '{}') as Record<string, unknown>
        if (next) all[symbol] = next
        else delete all[symbol]
        localStorage.setItem(PLAYER_KEY, JSON.stringify(all))
      } catch {
        /* a private window keeps it for this visit */
      }
    },
    [symbol],
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => poll<{ perp?: PerpPosition | null }>(address && !noMarket ? `/api/markets/position?symbol=${encodeURIComponent(symbol)}&address=${address}` : null, 60_000, () => true, (b) => setLivePos(b?.perp && b.perp.entryPx > 0 ? b.perp : null)), [address, symbol, noMarket])

  // ── The rows ─────────────────────────────────────────────────────────────
  const range = RANGE_PCT[mode]
  const liqMap = useMemo(() => (derivs && derivs.oi.length > 1 && n > 1 ? liquidationMap(bars, derivs.oi, derivs.oiUnit) : null), [bars, derivs, n])
  const buckets = useMemo(() => (liqMap && mark > 0 ? liqBuckets(liqMap.alive, mark) : []), [liqMap, mark])
  const spotRowsRaw = useMemo(() => (spotBook && spotBook.mid ? bookRows(spotBook, RANGE_PCT.spot, SPOT_STEP_PCT) : []), [spotBook])
  const rows = useMemo<Row[]>(() => {
    const src: { side: 'long' | 'short'; price: number; usd: number }[] =
      mode === 'perps' ? buckets.filter((b) => Math.abs(b.price / mark - 1) < range / 100 && (b.side === 'short' ? b.price > mark : b.price < mark)) : spotRowsRaw
    if (!src.length || !(mark > 0)) return []
    // Rows closer than a tank's height merge (dollars summed, price dollar-weighted); the ten biggest a side stand.
    const mergePct = mode === 'perps' ? 0.022 : 0.0105
    const merged: { side: 'long' | 'short'; price: number; usd: number }[] = []
    for (const b of [...src].sort((a, c) => a.price - c.price)) {
      const last = merged[merged.length - 1]
      if (last && last.side === b.side && Math.abs(last.price - b.price) / mark < mergePct) {
        const usd = last.usd + b.usd
        merged[merged.length - 1] = { side: last.side, price: (last.price * last.usd + b.price * b.usd) / usd, usd }
      } else merged.push({ ...b })
    }
    const kept = (['long', 'short'] as const).flatMap((side) => merged.filter((b) => b.side === side).sort((a, c) => c.usd - a.usd).slice(0, size.w < 520 ? 5 : 10))
    const unit = unitUsd(kept.reduce((m, b) => Math.max(m, b.usd), 0))
    return kept.map((b) => ({ ...b, units: unitsFor(b.usd, unit) })).filter((r) => r.units > 0).sort((a, c) => a.price - c.price)
  }, [mode, buckets, spotRowsRaw, mark, range, size.w])
  const unit = useMemo(() => unitUsd(rows.reduce((m, r) => Math.max(m, r.usd), 0)), [rows])
  const walls = useMemo(() => (hlBook && hlBook.mid ? bookWalls(hlBook) : null), [hlBook])
  const spot = useMemo(() => (spotBook && spotBook.mid ? spotRead(spotBook) : null), [spotBook])
  const heatSrc = tf === '1d' ? derivs : dailyDerivs
  const cells = useMemo(() => (mode === 'heat' && heatSrc ? heatCells(heatSrc.ratio, heatSrc.oi, dailyBars, Date.now() / 1000) : []), [mode, heatSrc, dailyBars])
  const heat = useMemo(() => (cells.length ? heatSummary(cells) : null), [cells])

  // The perps read at the price now (lib/derivs crowdRead).
  const intel = useMemo(() => {
    if (!derivs || n < 2) return null
    const longShare = derivs.ratio.length ? derivs.ratio[derivs.ratio.length - 1].long : null
    const at = oiAtBars(bars, derivs.oi)
    const a = at[Math.max(0, n - 20)]
    const z = at[n] ?? at[n - 1]
    const oiChangePct = a && z ? ((z - a) / a) * 100 : null
    const oiUsd = z ? (derivs.oiUnit === 'coin' ? z * mark : z) : null
    const fuel = fuelWithin(buckets, mark, 10)
    const priceChangePct = bars[Math.max(0, n - 20)].o > 0 ? (mark / bars[Math.max(0, n - 20)].o - 1) * 100 : null
    return { longShare, oiChangePct, oiUsd, fuel, read: crowdRead({ longShare, funding8h: derivs.funding8h, oiChangePct, priceChangePct, fuelAbove: fuel.above, fuelBelow: fuel.below }) }
  }, [derivs, bars, n, mark, buckets])

  const maxLev = derivs?.hl?.maxLeverage ?? 10
  const player = useMemo<BoardPlayer | null>(() => {
    if (mode !== 'perps') return null
    if (livePos) return { side: livePos.side, entry: livePos.entryPx, leverage: Math.max(1, livePos.leverage), usd: Math.abs(livePos.valueUsd), live: true, atMarket: false }
    if (!stored || !(mark > 0)) return null
    return { side: stored.side, entry: stored.entry ?? mark, leverage: stored.leverage, usd: stored.usd, live: false, atMarket: stored.entry === null }
  }, [mode, livePos, stored, mark])
  const pstate = useMemo<PlayerState | null>(() => {
    if (!player) return null
    const st = playerState(player, mark, maxLev)
    return player.live && livePos?.liquidationPx ? { ...st, liq: livePos.liquidationPx, toLiqPct: (Math.abs(mark - livePos.liquidationPx) / mark) * 100, pnlUsd: livePos.pnlUsd } : st
  }, [player, mark, maxLev, livePos])
  const firstToBreak = player && pstate ? fuelBeforePlayer(buckets, player, mark, pstate.liq) : 0

  // The last 24 hours' range: the ground fought over today.
  const day = useMemo(() => {
    if (!n) return null
    const since = bars[n - 1].t - 86_400
    let lo = Infinity
    let hi = -Infinity
    for (const b of bars) {
      if (b.t < since) continue
      if (b.l < lo) lo = b.l
      if (b.h > hi) hi = b.h
    }
    return Number.isFinite(lo) ? { lo, hi } : null
  }, [bars, n])

  const boardRef = useRef({ rows, unit, walls, spot, intel, player, pstate, firstToBreak, day, mode, tokens, size, mark, placing, funding8h: derivs?.funding8h ?? null, source: derivs?.source ?? null })
  boardRef.current = { rows, unit, walls, spot, intel, player, pstate, firstToBreak, day, mode, tokens, size, mark, placing, funding8h: derivs?.funding8h ?? null, source: derivs?.source ?? null }

  // ── Geometry ─────────────────────────────────────────────────────────────
  const box = useCallback((w: number, h: number): FieldBox => {
    const left = w < 520 ? 46 : 64
    return { left, top: 6, width: Math.max(40, w - left - 12), height: Math.max(40, h - 6 - CTL_STRIP) }
  }, [])
  const tiltAt = useCallback(
    (now: number) => {
      if (reduced || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return 1
      if (mountedAtRef.current === null) mountedAtRef.current = now
      return ease(Math.min(1, (now - mountedAtRef.current) / TILT_MS))
    },
    [reduced],
  )
  /** Price → table depth 0..1 (the front at 0.5, the near edge the range below it). */
  const vOf = useCallback((price: number, m: number, r: number) => (price / m - 1 + r / 100) / (2 * r / 100), [])
  const rowY = useCallback(
    (price: number) => {
      const b = boardRef.current
      const { project } = fieldProjector(box(b.size.w, b.size.h), tiltAt(performance.now()))
      return project(0.5, vOf(price, b.mark, RANGE_PCT[b.mode])).y
    },
    [box, tiltAt, vOf],
  )

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current
      const b = boardRef.current
      const tk = b.tokens
      const sz = b.size
      if (!canvas || sz.w < 40 || sz.h < 40) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(sz.w * dpr) || canvas.height !== Math.round(sz.h * dpr)) {
        canvas.width = Math.round(sz.w * dpr)
        canvas.height = Math.round(sz.h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = tk.bg
      ctx.fillRect(0, 0, sz.w, sz.h)
      if (!(b.mark > 0)) return
      const tilt = tiltAt(now)
      const t = reduced ? 0 : now
      const r = RANGE_PCT[b.mode]
      const { project } = fieldProjector(box(sz.w, sz.h), tilt)
      const P = (u: number, v: number) => project(u, v)
      const V = (price: number) => vOf(price, b.mark, r)
      const poly = (pts: { x: number; y: number }[]) => {
        ctx.beginPath()
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.closePath()
      }
      const text = (s: string, x: number, y: number, color: string, opts?: { size?: number; align?: CanvasTextAlign; bold?: boolean; plate?: boolean }) => {
        const px = opts?.size ?? 10
        ctx.font = `${opts?.bold ? '600 ' : ''}${px}px ${FONT}`
        ctx.textAlign = opts?.align ?? 'left'
        ctx.textBaseline = 'middle'
        if (opts?.plate) {
          const w = ctx.measureText(s).width
          const x0 = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x
          ctx.fillStyle = rgba(tk.bg, 0.8)
          ctx.fillRect(x0 - 4, y - px / 2 - 3, w + 8, px + 6)
        }
        ctx.fillStyle = color
        ctx.fillText(s, x, y)
      }
      const tank = (p: { x: number; y: number }, ink: string, k: number, dir: number) => {
        ctx.fillStyle = mix(ink, tk.bg, 0.55)
        ctx.fillRect(p.x - 5.5 * k, p.y - 3 * k, 11 * k, 4 * k)
        ctx.fillStyle = ink
        ctx.fillRect(p.x - 4.5 * k, p.y - 5.5 * k, 9 * k, 3.5 * k)
        ctx.fillRect(p.x - 2 * k, p.y - 8 * k, 4 * k, 3 * k)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - 6.5 * k)
        ctx.lineTo(p.x, p.y - 6.5 * k - dir * 6 * k)
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.4 * k
        ctx.stroke()
      }

      // Sky and the two halves of the table.
      const horizon = P(0.5, 1).y
      if (tilt > 0.05) {
        const g = ctx.createLinearGradient(0, Math.max(0, horizon - 70), 0, horizon)
        g.addColorStop(0, rgba(tk.fg, 0))
        g.addColorStop(1, rgba(tk.fg, 0.07 * tilt))
        ctx.fillStyle = g
        ctx.fillRect(0, Math.max(0, horizon - 70), sz.w, 70)
      }
      poly([P(0, 0.5), P(1, 0.5), P(1, 1), P(0, 1)])
      ctx.fillStyle = mix(tk.bg, tk.down, 0.2)
      ctx.fill()
      poly([P(0, 0), P(1, 0), P(1, 0.5), P(0, 0.5)])
      ctx.fillStyle = mix(tk.bg, tk.up, 0.24)
      ctx.fill()
      // Today's ground: the last 24 hours' range.
      if (b.day) {
        const lo = Math.max(0, V(b.day.lo))
        const hi = Math.min(1, V(b.day.hi))
        if (hi > lo) {
          poly([P(0, lo), P(1, lo), P(1, hi), P(0, hi)])
          ctx.fillStyle = rgba(tk.fg, 0.06)
          ctx.fill()
          const e = P(0, hi)
          text('FOUGHT OVER IN THE LAST 24H', e.x + 6, e.y + 8, rgba(tk.fg, 0.5), { size: 8 })
        }
      }
      // Price rungs with their prices, down the left edge.
      const rungs = b.mode === 'perps' ? [-20, -10, 10, 20] : [-8, -4, 4, 8]
      for (const pct of rungs) {
        const v = V(b.mark * (1 + pct / 100))
        const a = P(0, v)
        const z = P(1, v)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(z.x, z.y)
        ctx.strokeStyle = rgba(tk.fg, 0.08)
        ctx.lineWidth = 1
        ctx.stroke()
        text(`${fmtPrice(b.mark * (1 + pct / 100))}`, a.x - 8, a.y, tk.muted2, { size: 9.5, align: 'right' })
        text(`${pct > 0 ? '+' : ''}${pct}%`, a.x + 6, a.y - 8, rgba(tk.fg, 0.35), { size: 8 })
      }
      // The front line: the price right now.
      const fa = P(0, 0.5)
      const fz = P(1, 0.5)
      ctx.beginPath()
      ctx.moveTo(fa.x, fa.y)
      ctx.lineTo(fz.x, fz.y)
      ctx.strokeStyle = rgba(tk.fg, 0.9)
      ctx.lineWidth = 1.6
      ctx.shadowColor = rgba(tk.fg, 0.6)
      ctx.shadowBlur = 8
      ctx.stroke()
      ctx.shadowBlur = 0
      const tagText = fmtPrice(b.mark)
      ctx.font = `600 10px ${FONT}`
      const tagW = ctx.measureText(tagText).width + 10
      ctx.fillStyle = n > 1 && mark >= bars[n - 1].o ? tk.up : tk.down
      ctx.fillRect(fa.x - 4 - tagW, fa.y - 8, tagW, 16)
      text(tagText, fa.x - 4 - tagW + 5, fa.y + 0.5, tk.bg, { size: 10, bold: true })

      // Player lines (perps): entry dashed in the accent, the break line as a wall.
      const pl = b.player
      const ps = b.pstate
      if (pl && ps) {
        const ve = V(pl.entry)
        const vl = V(ps.liq)
        if (ve > 0 && ve < 1) {
          const a = P(0, ve)
          const z = P(1, ve)
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(z.x, z.y)
          ctx.setLineDash([6, 5])
          ctx.strokeStyle = rgba(tk.accent, 0.75)
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.setLineDash([])
        }
        if (vl > 0 && vl < 1) {
          const a = P(0, vl)
          const z = P(1, vl)
          const hgt = 12 * tilt
          poly([a, z, { x: z.x, y: z.y - hgt * z.s }, { x: a.x, y: a.y - hgt * a.s }])
          ctx.fillStyle = rgba(tk.down, 0.3)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(a.x, a.y - hgt * a.s)
          ctx.lineTo(z.x, z.y - hgt * z.s)
          ctx.strokeStyle = tk.down
          ctx.lineWidth = 1.4
          ctx.stroke()
          text(`YOUR ${pl.side.toUpperCase()} BREAKS ~${fmtPrice(ps.liq)}${b.firstToBreak > 0 ? ` · ~${fmtUsdShort(b.firstToBreak)} of other ${pl.side}s break first` : ''}`, a.x + 8, a.y - hgt * a.s - 9, tk.fg, { size: 9, plate: true })
        }
      }

      // Formation rows, far first so a near rank can stand over a far one.
      const perRank = sz.w < 520 ? 7 : 12
      const hv = hover?.row ?? null
      // Row labels stack down the right edge and never sit on each other.
      let lastLabelY = -Infinity
      for (const row of [...b.rows].sort((a, c) => c.price - a.price)) {
        const v = V(row.price)
        if (v <= 0.01 || v >= 0.99) continue
        const dir = row.side === 'long' ? 1 : -1
        const ink = hv && hv.price === row.price && hv.side === row.side ? mix(row.side === 'long' ? tk.up : tk.down, tk.fg, 0.35) : row.side === 'long' ? tk.up : tk.down
        const a = P(0.06, v)
        const z = P(0.94, v)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y + 1)
        ctx.lineTo(z.x, z.y + 1)
        ctx.strokeStyle = rgba(ink, 0.28)
        ctx.lineWidth = 1
        ctx.stroke()
        const ranks = Math.ceil(row.units / perRank)
        for (let q = 0; q < row.units; q++) {
          const rank = Math.floor(q / perRank)
          const inRank = Math.min(perRank, row.units - rank * perRank)
          const col = q - rank * perRank
          // A row stands centred; a second rank steps back from the line.
          const u = 0.5 + ((col - (inRank - 1) / 2) * 0.058 * (sz.w < 520 ? 0.8 : 1)) + (rank % 2 ? 0.025 : 0)
          const p = P(u, v - dir * rank * 0.018 * (ranks > 1 ? 1 : 0))
          tank(p, ink, Math.max(0.6, p.s) * (sz.w < 520 ? 0.8 : 1.3), dir)
        }
        const ly = Math.max(z.y - 10 * Math.max(0.6, z.s), lastLabelY + 15)
        lastLabelY = ly
        text(sz.w < 520 ? `~${fmtUsdShort(row.usd)} · ${pctOf(row.price, b.mark)}` : `~${fmtUsdShort(row.usd)} · ${fmtPrice(row.price)} · ${pctOf(row.price, b.mark)}`, z.x, ly, ink, { size: 9, align: 'right', plate: true })
      }

      // Ramparts (perps, MEASURED): Hyperliquid's resting orders within 2%,
      // walls standing just beside the front; the longer holds more money.
      if (b.mode === 'perps' && b.walls && (b.walls.bidUsd > 0 || b.walls.askUsd > 0)) {
        const wallMax = Math.max(b.walls.bidUsd, b.walls.askUsd)
        for (const side of ['long', 'short'] as const) {
          const usd = side === 'long' ? b.walls.bidUsd : b.walls.askUsd
          if (usd <= 0) continue
          const dir = side === 'long' ? 1 : -1
          const v = 0.5 - dir * 0.022
          const len = 0.12 + 0.52 * (usd / wallMax)
          const A = P(0.5 - len / 2, v)
          const Z = P(0.5 + len / 2, v)
          const hgt = 8 * tilt * Math.max(0.6, A.s)
          const ink = side === 'long' ? tk.up : tk.down
          poly([A, Z, { x: Z.x, y: Z.y - hgt }, { x: A.x, y: A.y - hgt }])
          ctx.fillStyle = mix(ink, tk.bg, 0.3)
          ctx.fill()
          ctx.fillStyle = ink
          const seg = (Z.x - A.x) / 9
          for (let q = 0; q < 9; q += 2) ctx.fillRect(A.x + q * seg, A.y - hgt - 2.5, seg, 2.5)
          text(`${fmtUsdShort(usd)} ${side === 'long' ? 'bids' : 'asks'}${sz.w < 520 ? '' : ' on Hyperliquid'}`, Z.x + 8, Z.y - hgt / 2, ink, { size: 8.5, bold: true, plate: true })
        }
      }

      // Banners: the side's share, as the width of its flag.
      const share = b.mode === 'perps' ? b.intel?.longShare ?? null : b.spot ? b.spot.bidShare : null
      if (share !== null && tilt > 0.4) {
        const flag = (side: 'long' | 'short', at: { x: number; y: number; s: number }, w: number, label: string) => {
          const ink = side === 'long' ? tk.up : tk.down
          const pole = 22 * at.s
          ctx.beginPath()
          ctx.moveTo(at.x, at.y)
          ctx.lineTo(at.x, at.y - pole)
          ctx.strokeStyle = rgba(tk.fg, 0.8)
          ctx.lineWidth = 1.2
          ctx.stroke()
          const wave = reduced ? 0 : Math.sin(t / 420 + (side === 'long' ? 0 : 2)) * 1.5
          ctx.beginPath()
          ctx.moveTo(at.x, at.y - pole)
          ctx.lineTo(at.x + w, at.y - pole + 3.5 + wave)
          ctx.lineTo(at.x, at.y - pole + 8)
          ctx.closePath()
          ctx.fillStyle = ink
          ctx.fill()
          text(label, at.x + w + 5, at.y - pole + 4, ink, { size: 9, bold: true, plate: true })
        }
        const longAt = P(0.04, 0.5 - 0.09)
        const shortAt = P(0.04, 0.5 + 0.09)
        const what = b.mode === 'perps' ? ['LONG', 'SHORT'] : ['BUYERS', 'SELLERS']
        flag('long', longAt, 10 + 44 * share, `${Math.round(share * 100)}% ${what[0]}`)
        flag('short', shortAt, 10 + 44 * (1 - share), `${Math.round((1 - share) * 100)}% ${what[1]}`)
        // Funding (perps) rides a wagon from the paying side's banner to the other's.
        const f8 = b.mode === 'perps' ? b.funding8h : null
        if (f8 !== null && f8 !== 0) {
          const from = f8 > 0 ? longAt : shortAt
          const to = f8 > 0 ? shortAt : longAt
          const prog = reduced ? 0.5 : (t / 3200) % 1
          const w = { x: from.x + 6 + (to.x - from.x) * prog, y: from.y + (to.y - from.y) * prog }
          ctx.fillStyle = tk.accent
          ctx.fillRect(w.x - 5, w.y - 9, 8, 6)
          ctx.fillRect(w.x + 3, w.y - 6.5, 4, 3.5)
          ctx.fillStyle = tk.fg
          ctx.beginPath()
          ctx.arc(w.x - 2.5, w.y - 2.5, 1.6, 0, Math.PI * 2)
          ctx.arc(w.x + 4, w.y - 2.5, 1.6, 0, Math.PI * 2)
          ctx.fill()
          const under = P(0.04, 0.5 - 0.17)
          text(`FUNDING ${f8 > 0 ? '+' : '−'}${Math.abs(f8 * 100).toFixed(4)}% / 8H · ${f8 > 0 ? 'LONGS PAY' : 'SHORTS PAY'}`, under.x, under.y, tk.muted2, { size: 8.5, plate: true })
        }
      }

      // The player's piece at the line (its entry), with its words.
      if (pl && ps) {
        const ve = V(pl.entry)
        if (ve > 0 && ve < 1) {
          const p = P(0.5, ve)
          const k = Math.max(0.7, p.s) * 1.5
          const dir = pl.side === 'long' ? 1 : -1
          ctx.fillStyle = mix(tk.accent, tk.bg, 0.55)
          ctx.fillRect(p.x - 6 * k, p.y - 3 * k, 12 * k, 4 * k)
          ctx.fillStyle = tk.accent
          ctx.fillRect(p.x - 5 * k, p.y - 6 * k, 10 * k, 4 * k)
          ctx.fillRect(p.x - 2.2 * k, p.y - 9 * k, 4.4 * k, 3.4 * k)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y - 7.5 * k)
          ctx.lineTo(p.x, p.y - 7.5 * k - dir * 7 * k)
          ctx.strokeStyle = tk.accent
          ctx.lineWidth = 1.6 * k
          ctx.stroke()
          const won = ps.pnlUsd >= 0
          const pnl = pl.atMarket ? '' : ` ${won ? '+' : '−'}$${Math.abs(ps.pnlUsd).toFixed(2)}`
          text(`YOU · ${pl.live ? 'LIVE ' : ''}${pl.side.toUpperCase()} ${pl.leverage}x${pnl}`, p.x, p.y - 9 * k - 12, pl.atMarket ? tk.fg : won ? tk.up : tk.down, { size: 9, align: 'center', bold: true, plate: true })
        }
      }

      // The near edge: whose ground this is.
      const near = P(0.5, 0)
      const far = P(0.5, 1)
      text(b.mode === 'perps' ? 'LONGS · WHERE THEY BREAK' : 'BUYERS · RESTING BIDS', near.x, near.y + 11, rgba(tk.up, 0.7), { size: 8.5, align: 'center', bold: true })
      text(b.mode === 'perps' ? 'SHORTS · WHERE THEY BREAK' : 'SELLERS · RESTING ASKS', far.x, far.y - 10, rgba(tk.down, 0.75), { size: 8.5, align: 'center', bold: true })
    },
    [box, reduced, tiltAt, vOf, hover, n, mark, bars],
  )

  useEffect(() => {
    let raf = 0
    let alive = true
    const frame = (now: number) => {
      if (!alive) return
      draw(now)
      if (!reduced) raf = requestAnimationFrame(frame)
    }
    draw(performance.now())
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [draw, reduced, rows, walls, spot, intel, player, pstate, size, tokens, mode, day])

  // ── Pointer: a row's report on hover; a click sets the player's entry while placing ──
  const rowAt = useCallback(
    (clientX: number, clientY: number): { row: Row | null; x: number; y: number; price: number } | null => {
      const el = wrapRef.current
      const b = boardRef.current
      if (!el || !(b.mark > 0)) return null
      const rc = el.getBoundingClientRect()
      const x = clientX - rc.left
      const y = clientY - rc.top
      const { unproject } = fieldProjector(box(rc.width, rc.height), tiltAt(performance.now()))
      const g = unproject(x, y)
      if (g.v < -0.02 || g.v > 1.02 || g.u < -0.05 || g.u > 1.05) return null
      const price = b.mark * (1 + (g.v * 2 - 1) * (RANGE_PCT[b.mode] / 100))
      let best: Row | null = null
      let bestD = 9
      for (const row of b.rows) {
        const d = Math.abs(rowY(row.price) - y)
        if (d < bestD) {
          bestD = d
          best = row
        }
      }
      return { row: best, x, y, price }
    },
    [box, tiltAt, rowY],
  )

  // ── HUD ──────────────────────────────────────────────────────────────────
  const now = fieldDate(Math.floor(Date.now() / 1000), '1h')
  const crowd = mode === 'perps' && intel && intel.longShare !== null ? intel : null
  const lean = mode === 'perps' ? crowd?.read.lean ?? null : mode === 'spot' ? spot?.lean ?? null : heat?.streak && heat.streak.days >= 3 ? (heat.streak.side === 'long' ? 'up' : 'down') : null
  const perpOk = pair.source === 'hyperliquid' || hasPerpCold(pair.symbol)
  const openAsk = (() => {
    if (!onAsk || !stored || livePos || stored.entry !== null || !perpOk || stored.leverage > maxLev || mode !== 'perps') return null
    const ask = composeExecAsk(pair, stored.side, { usd: stored.usd, leverage: stored.leverage })
    return ask && (canAsk ? canAsk(ask) : true) ? ask : null
  })()
  const levs = PLAYER_LEVERAGES.filter((l) => l <= maxLev)
  const cycle = <T,>(list: T[], cur: T): T => list[(Math.max(0, list.indexOf(cur)) + 1) % list.length]
  const addPlayer = (side: 'long' | 'short') => savePlayer({ side, leverage: levs.includes(3) ? 3 : levs[0] ?? 1, usd: 25, entry: null })
  const spotSource = spotBook && !spotBook.missing ? 'Coinbase' : null

  if (noMarket || !(mark > 0)) {
    return (
      <div ref={wrapRef} className="bf">
        <canvas ref={canvasRef} className="bf__canvas" aria-hidden="true" />
        <p className="bf__empty mono">{noMarket ? 'A tokenized stock has no perp or spot book to put on the board.' : 'Mustering the field…'}</p>
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      className={`bf bf--board has-front${placing ? ' is-placing' : ''}`}
      onPointerMove={(e) => {
        if ((e.target as HTMLElement).closest('.bf__strip') || mode === 'heat') return setHover(null)
        const hit = rowAt(e.clientX, e.clientY)
        setHover(hit?.row ? { row: hit.row, x: hit.x, y: hit.y } : null)
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.bf__strip')) return
        const hit = rowAt(e.clientX, e.clientY)
        if (hit && placing && stored) {
          savePlayer({ ...stored, entry: Number(hit.price.toPrecision(5)) })
          setPlacing(false)
        }
      }}
    >
      {mode === 'heat' && <HeatGrid cells={cells} source={heatSrc?.source ?? null} onHover={setHeatHover} />}
      {mode !== 'heat' && <canvas
        ref={canvasRef}
        className="bf__canvas"
        role="img"
        aria-label={`${symbol} battlefield, ${mode}: ${mode === 'perps' ? crowd?.read.headline ?? 'positioning loading' : spot?.headline ?? 'book loading'}. The front at ${fmtPrice(mark)} dollars.`}
      />}

      <div className="bf__date">
        <div className="bf__cal">
          <span className="bf__cal-m mono">{now.month}</span>
          <span className="bf__cal-d">{now.day}</span>
          <span className="bf__cal-y mono">{now.time}</span>
        </div>
        <div className="bf__day mono">
          <span>The front, live</span>
          <span className="bf__day-sub">{mode === 'perps' ? `${derivs?.source ?? 'perps'} · Hyperliquid` : mode === 'spot' ? spotSource ?? 'spot' : `${heatSrc?.source ?? 'perps'} · daily`}</span>
        </div>
      </div>

      {mode === 'heat' ? (
        <div className={`bf__press bf__press--${lean === 'up' ? 'bulls' : lean === 'down' ? 'bears' : 'stalemate'}`}>
          <span className="bf__press-k mono">Positioning by day · {heatSrc?.source ?? 'perps'} accounts</span>
          <span className="bf__press-v">{heat ? heat.headline : heatSrc ? 'No daily read for this coin' : 'Reading the year…'}</span>
          {heat ? <span className="bf__press-l mono">{heat.read} days read · the typical day is {heat.median !== null ? `${Math.round(heat.median * 100)}% long` : 'unread'} · green = more long than usual, red = more short</span> : null}
        </div>
      ) : mode === 'perps' ? (
        crowd ? (
          <div className={`bf__press bf__press--${lean === 'up' ? 'bulls' : lean === 'down' ? 'bears' : 'stalemate'}`}>
            <span className="bf__press-k mono">Longs vs shorts · {derivs?.source} accounts</span>
            <span className="bf__press-v">{crowd.read.headline}</span>
            <span className="bf__meter" style={{ '--bf-share': `${Math.round(crowd.longShare! * 100)}%` } as CSSProperties}>
              <i />
            </span>
            <span className="bf__press-l mono">
              {Math.round(crowd.longShare! * 100)}% long · {100 - Math.round(crowd.longShare! * 100)}% short
              {derivs?.funding8h != null ? ` · funding ${fundingLine(derivs.funding8h)}` : ''}
            </span>
            {crowd.oiUsd != null || crowd.read.flow ? (
              <span className="bf__press-l bf__press-l2 mono">
                {crowd.oiUsd != null ? `open interest ${fmtUsdShort(crowd.oiUsd)}${crowd.oiChangePct != null ? ` (${crowd.oiChangePct >= 0 ? '+' : '−'}${Math.abs(crowd.oiChangePct).toFixed(1)}% / 20 bars)` : ''}` : ''}
                {crowd.oiUsd != null && crowd.read.flow ? ' · ' : ''}
                {crowd.read.flow ? crowd.read.flow.split(': ')[1] : ''}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="bf__press bf__press--stalemate">
            <span className="bf__press-k mono">Longs vs shorts</span>
            <span className="bf__press-v">{derivs ? 'No positioning read for this coin' : 'Reading positioning…'}</span>
            {derivs?.missing.length ? <span className="bf__press-l mono">did not answer: {derivs.missing.join(', ')}</span> : null}
          </div>
        )
      ) : (
        <div className={`bf__press bf__press--${lean === 'up' ? 'bulls' : lean === 'down' ? 'bears' : 'stalemate'}`}>
          <span className="bf__press-k mono">Buyers vs sellers · {spotSource ?? 'spot'} book</span>
          <span className="bf__press-v">{spot?.headline ?? (spotBook?.missing ? 'No spot book for this coin' : 'Reading the book…')}</span>
          {spot ? (
            <>
              <span className="bf__meter" style={{ '--bf-share': `${Math.round(spot.bidShare * 100)}%` } as CSSProperties}>
                <i />
              </span>
              <span className="bf__press-l mono">
                within 5%: {fmtUsdShort(bookWalls(spotBook!, 5).bidUsd)} bids · {fmtUsdShort(bookWalls(spotBook!, 5).askUsd)} asks
                {spot.spreadPct != null ? ` · spread ${spot.spreadPct.toFixed(3)}%` : ''}
              </span>
            </>
          ) : null}
        </div>
      )}

      {heatHover && (
        <div className={`bf__tip bf__tip--${(heatHover.cell.long ?? 0.5) >= 0.5 ? 'bulls' : 'bears'}`} style={{ left: Math.max(8, Math.min(size.w - 268, heatHover.x + 16)), top: Math.max(8, Math.min(size.h - 120, heatHover.y - 20)) }} role="status">
          <span className="bf__tip-k mono">{fieldDate(heatHover.cell.day, '1d').month} {fieldDate(heatHover.cell.day, '1d').day}, {fieldDate(heatHover.cell.day, '1d').year}</span>
          <strong>{heatHover.cell.long === null ? 'No reading that day' : `${Math.round(heatHover.cell.long * 100)}% long · ${100 - Math.round(heatHover.cell.long * 100)}% short${heat?.median != null ? ` · ${heatHover.cell.long - heat.median >= 0 ? '+' : '\u2212'}${Math.abs((heatHover.cell.long - heat.median) * 100).toFixed(0)} pts vs usual` : ''}`}</strong>
          {heatHover.cell.pricePct !== null ? <span>price {heatHover.cell.pricePct >= 0 ? '+' : '\u2212'}{Math.abs(heatHover.cell.pricePct).toFixed(1)}% that day</span> : null}
          {heatHover.cell.oi !== null && heatSrc ? <span>open interest {fmtUsdShort(heatSrc.oiUnit === 'coin' ? heatHover.cell.oi * mark : heatHover.cell.oi)}</span> : null}
        </div>
      )}
      {hover && mode !== 'heat' && (
        <div className={`bf__tip bf__tip--${hover.row.side === 'long' ? 'bulls' : 'bears'}`} style={{ left: Math.max(8, Math.min(size.w - 268, hover.x + 16)), top: Math.max(8, Math.min(size.h - 120, hover.y - 20)) }} role="status">
          <span className="bf__tip-k mono">{mode === 'perps' ? 'Estimated · lib/derivs' : 'Resting orders · Coinbase'}</span>
          <strong>
            {mode === 'perps'
              ? `~${fmtUsdShort(hover.row.usd)} of ${hover.row.side}s break near ${fmtPrice(hover.row.price)}`
              : `~${fmtUsdShort(hover.row.usd)} of ${hover.row.side === 'long' ? 'bids' : 'asks'} rest near ${fmtPrice(hover.row.price)}`}
          </strong>
          <span>
            {pctOf(hover.row.price, mark)} from the line · {hover.row.units} {hover.row.units === 1 ? 'tank' : 'tanks'} of {fmtUsdShort(unit)}
          </span>
          {mode === 'perps' ? <span className="bf__tip-h mono">a model of where positions opened, not a forecast</span> : null}
        </div>
      )}

      <div className="bf__strip">
        <div className="bf__row">
          <div className="mkt-view bf__mode" role="group" aria-label="Board">
            <button type="button" className={`mkt-view__btn mono${mode === 'perps' ? ' is-active' : ''}`} aria-pressed={mode === 'perps'} onClick={() => pickMode('perps')} title="Longs vs shorts: estimated liquidation rows, Hyperliquid's book, the share of accounts">
              <span>Perps</span>
            </button>
            <button type="button" className={`mkt-view__btn mono${mode === 'spot' ? ' is-active' : ''}`} aria-pressed={mode === 'spot'} onClick={() => pickMode('spot')} title="Buyers vs sellers: the orders resting on Coinbase's book">
              <span>Spot</span>
            </button>
            <button type="button" className={`mkt-view__btn mono${mode === 'heat' ? ' is-active' : ''}`} aria-pressed={mode === 'heat'} onClick={() => pickMode('heat')} title="A year of positioning, one cell a day: which side was crowded, and how much">
              <span>Heatmap</span>
            </button>
          </div>
          <p className="bf__legend mono">
            {mode === 'heat' ? (
              <span className="bf__heatkey">
                short <i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 100%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 55%, var(--surf-1))' }} /><i style={{ background: 'var(--surf-1)' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 55%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 100%, var(--surf-1))' }} /> long · against the year's typical day · full ink 8 points off it
              </span>
            ) : rows.length ? (
              <span title={mode === 'perps' ? 'Estimated from open interest that appeared on each bar, across 5x to 50x leverage: where the positions probably break, not where price will go.' : 'Orders resting on Coinbase Exchange’s book, read every 15 seconds.'}>
                <i className="bf__sw bf__sw--up" />
                <i className="bf__sw bf__sw--down" />
                tank = {fmtUsdShort(unit)} of {mode === 'perps' ? 'est. positions, standing where it breaks' : 'resting orders, standing at their price'}
              </span>
            ) : (
              <span>{mode === 'perps' ? (derivs ? 'no liquidation rows within 25%' : 'reading open interest…') : spotBook?.missing ? 'no spot book' : 'reading the book…'}</span>
            )}
            {mode === 'perps' && walls ? <span>ramparts = resting orders within 2%</span> : null}
            {mode !== 'heat' && (mode === 'perps' ? crowd : spot) ? <span>banners = {mode === 'perps' ? 'share of accounts' : 'share of the book within 5%'}</span> : null}
          </p>
        </div>

        {mode === 'perps' && (
          <div className="bf__player">
            {!player || !pstate ? (
              <>
                <span className="bf__player-k mono">Put a position on the board</span>
                <button type="button" className="bf__chip bf__chip--long mono" onClick={() => addPlayer('long')}>+ Long</button>
                <button type="button" className="bf__chip bf__chip--short mono" onClick={() => addPlayer('short')}>+ Short</button>
                <span className="bf__player-note mono">see where it breaks before you open it</span>
              </>
            ) : (
              <>
                <span className="bf__player-k mono">{player.live ? 'Your position' : 'You'}</span>
                {player.live || !stored ? (
                  <span className={`bf__chip bf__chip--${player.side} mono`}>{player.side} {player.leverage}x · ${Math.round(player.usd)}</span>
                ) : (
                  <>
                    <button type="button" className={`bf__chip bf__chip--${stored.side} mono`} title="Switch side" onClick={() => savePlayer({ ...stored, side: stored.side === 'long' ? 'short' : 'long' })}>{stored.side}</button>
                    <button type="button" className="bf__chip mono" title="Leverage (tap to change)" onClick={() => savePlayer({ ...stored, leverage: cycle(levs, stored.leverage) })}>{stored.leverage}x</button>
                    <button type="button" className="bf__chip mono" title="Position size (tap to change)" onClick={() => savePlayer({ ...stored, usd: cycle(PLAYER_SIZES, stored.usd) })}>${stored.usd}</button>
                  </>
                )}
                <span className="bf__player-stats mono">
                  <span className="bf__player-wide">entry {fmtPrice(player.entry)} · </span>
                  {pstate.liquidated ? <b className="is-down">liquidated</b> : <>breaks ~{fmtPrice(pstate.liq)} <i>({pstate.toLiqPct.toFixed(1)}% away)</i></>}
                  {firstToBreak > 0 && !pstate.liquidated ? <span className="bf__player-wide"> · est. {fmtUsdShort(firstToBreak)} of other {player.side}s break first</span> : null}
                  {!player.atMarket ? <> · <b className={pstate.pnlUsd >= 0 ? 'is-up' : 'is-down'}>{pstate.pnlUsd >= 0 ? '+' : '−'}${Math.abs(pstate.pnlUsd).toFixed(2)}</b></> : null}
                </span>
                {!player.live && stored && (
                  <button type="button" className={`bf__chip bf__chip--move mono${placing ? ' is-on' : ''}`} onClick={() => (stored.entry !== null && !placing ? savePlayer({ ...stored, entry: null }) : setPlacing((v) => !v))} title={stored.entry !== null ? 'Put the entry back at the market price' : 'Click the board to try another entry price'}>
                    {placing ? 'click the board…' : stored.entry !== null ? 'at market' : 'move entry'}
                  </button>
                )}
                {openAsk && onAsk && (
                  <button type="button" className="bf__open" onClick={() => onAsk(openAsk)} title={openAsk}>Open<span className="bf__player-wide">&nbsp;on Hyperliquid</span></button>
                )}
                {player.live && onAsk && (
                  <button type="button" className="bf__chip mono" onClick={() => onAsk(`Close my ${pair.symbol} ${player.side} on Hyperliquid`)}>Close</button>
                )}
                {!player.live && (
                  <button type="button" className="bf__chip bf__chip--x mono" aria-label="Take the player off the board" onClick={() => { savePlayer(null); setPlacing(false) }}>×</button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The year as a contribution graph: columns are weeks (Sunday first),
 *  rows the days, each cell inked by that day's long/short share. */
function HeatGrid({ cells, source, onHover }: { cells: HeatCell[]; source: string | null; onHover: (h: { cell: HeatCell; x: number; y: number } | null) => void }) {
  const center = heatMedian(cells) ?? 0.5
  const weeks: HeatCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const months: { col: number; label: string }[] = []
  weeks.forEach((w, col) => {
    const first = w.find((c) => new Date(c.day * 1000).getUTCDate() <= 7)
    if (first && (months.length === 0 || months[months.length - 1].label !== fieldDate(first.day, '1d').month)) months.push({ col, label: fieldDate(first.day, '1d').month })
  })
  const ink = (c: HeatCell) => {
    const tone = heatTone(c.long, center)
    if (tone === null) return 'var(--surf-1)'
    const side = tone >= 0 ? 'var(--mk-up, var(--accent))' : 'var(--mk-down, var(--sell))'
    return `color-mix(in oklch, ${side} ${Math.round(12 + 88 * Math.abs(tone))}%, var(--surf-1))`
  }
  const today = Math.floor(Date.now() / 1000 / DAY_SEC) * DAY_SEC
  return (
    <div className="bf__heat" onPointerLeave={() => onHover(null)}>
      {!cells.length ? (
        <p className="bf__empty mono">{source === null ? 'Reading the year…' : 'No daily positioning for this coin'}</p>
      ) : (
        <div className="bf__heat-scroll">
          <div className="bf__heat-months mono" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--hc))` }}>
            {months.map((m) => (
              <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="bf__heat-body">
            <div className="bf__heat-days mono">
              <span style={{ gridRowStart: 2 }}>Mon</span>
              <span style={{ gridRowStart: 4 }}>Wed</span>
              <span style={{ gridRowStart: 6 }}>Fri</span>
            </div>
            <div className="bf__heat-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--hc))` }} role="img" aria-label="A year of daily long/short share, one cell a day">
              {weeks.map((w, col) =>
                w.map((c, row) => (
                  <i
                    key={c.day}
                    className={`bf__cell${c.day > today ? ' is-future' : ''}`}
                    style={{ gridColumnStart: col + 1, gridRowStart: row + 1, background: c.day > today ? 'transparent' : ink(c) }}
                    onPointerEnter={(e) => {
                      const host = (e.currentTarget as HTMLElement).closest('.bf') as HTMLElement | null
                      const r = host?.getBoundingClientRect()
                      onHover(r ? { cell: c, x: e.clientX - r.left, y: e.clientY - r.top } : null)
                    }}
                  />
                )),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
