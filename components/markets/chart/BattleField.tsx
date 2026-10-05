'use client'

// BattleField — the chart's second view. The bars MarketChart holds, tipped
// back onto a tabletop map (lib/battlefield has the rules and the words):
//
//   time     left → right, as on the candles; the road along the near edge is
//            the calendar (a signpost per month, or per day on fast frames),
//            and the forest wears each month's season
//   price    near → far; the close is the front line. Ground under it is the
//            buyers', ground over it the sellers'
//   a bar    a block lying where its body lies, as tall as its volume
//   SMAs     the 50 is the river, the 200 the road
//   levels   the walls you drew; your fills are your flags
//
// Opening it tips the flat chart over (tilt 0 → 1), so the two views read as
// one chart. A canvas draws the field; the calendar, the pressure meter, the
// replay controls and a bar's battle report are DOM over it, so they theme
// and read like the rest of the page. Everything on the field is a number
// the candles already show.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { Candle, ChartPair, ChartTf } from '@/lib/charts'
import type { ChartLine } from '@/lib/chart-state'
import type { FillMarker } from '@/lib/chart-fills'
import { FRAME_SEC } from '@/lib/chart-sessions'
import {
  ROAD_V,
  battleReport,
  fieldDate,
  fieldHash,
  fieldProjector,
  fieldRecords,
  fieldScale,
  fieldTicks,
  pressureAt,
  pressureLine,
  timeBands,
  troopCounts,
  fieldAhead,
  type FieldBox,
  type Season,
} from '@/lib/battlefield'
import {
  PLAYER_LEVERAGES,
  PLAYER_SIZES,
  crowdRead,
  fmtUsdShort,
  fuelBeforePlayer,
  fuelWithin,
  fundingLine,
  liqBuckets,
  liquidationMap,
  oiAtBars,
  parsePlayer,
  playerState,
  type DerivsBody,
  type LiqBucket,
  type LiqHit,
  type Player,
  type PlayerState,
} from '@/lib/derivs'
import { composeExecAsk } from '@/lib/trade-asks'
import { hasPerpCold } from '@/lib/symbol-venues'
import type { PerpPosition } from '@/lib/symbol-position'
import { fmtPrice } from '@/components/CandleChart'
import type { Tokens } from './chart-tokens'
import './battlefield.css'

export interface BattleFieldProps {
  symbol: string
  /** The chart's pair: positioning is read for coins and perps, never a tokenized stock. */
  pair: ChartPair
  /** Sends an order sentence (the chart's chip-send path). Absent → the player stays a what-if. */
  onAsk?: (ask: string) => void
  /** The chart's venue gates: may this sentence be offered? */
  canAsk?: (ask: string) => boolean
  tf: ChartTf
  /** The bars on the field, oldest first. Empty while a frame loads. */
  bars: Candle[]
  tokens: Tokens
  lines: ChartLine[]
  fills?: FillMarker[]
  /** The averages, one value per bar (null before a line starts); null = off. */
  sma50?: (number | null)[] | null
  sma200?: (number | null)[] | null
}

const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const TILT_MS = 900
const REPLAY_MS = 11_000
/** The strip under the field that the replay controls and the legend sit on. */
const CTL_STRIP = 76
/** Liquidation fuel on the board: one ink for both sides, its place says whose. */
const FUEL = '#ffb648'
const PLAYER_KEY = 'pantessa.bf.player.v1'

/** A what-if position. `entry` null = at market: it rides the front until moved. */
interface StoredPlayer {
  side: 'long' | 'short'
  leverage: number
  usd: number
  entry: number | null
}
type BoardPlayer = Player & { live: boolean; atMarket: boolean }
/** Season inks for the forest and each month's ground: the calendar you can see. */
const SEASON_INK: Record<Season, { tree: string; ground: string; alpha: number }> = {
  winter: { tree: '#dce9f5', ground: '#cfe3ff', alpha: 0.075 },
  spring: { tree: '#7fd98a', ground: '#9be7a0', alpha: 0.04 },
  summer: { tree: '#2f9e5b', ground: '#ffe08a', alpha: 0.03 },
  autumn: { tree: '#e08a2e', ground: '#ff9d4d', alpha: 0.05 },
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const mix = (a: string, b: string, t: number): string => {
  const A = rgb(a)
  const B = rgb(b)
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`
}
const rgba = (hex: string, a: number): string => `rgba(${rgb(hex).join(',')},${a})`
const ease = (t: number) => 1 - (1 - t) ** 3

interface Tree {
  u: number
  v: number
  size: number
  idx: number
  bull: boolean
  season: Season
}

export default function BattleField({ symbol, pair, onAsk, canAsk, tf, bars, tokens, lines, fills, sma50, sma200 }: BattleFieldProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const n = bars.length
  // The front's position in time: the last bar while live, anywhere while scrubbed or replaying.
  const [live, setLive] = useState(true)
  const [tipIdx, setTipIdx] = useState(Math.max(0, n - 1))
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<{ idx: number; x: number; y: number; price: number } | null>(null)
  const tipRef = useRef(Math.max(0, n - 1))
  const hoverRef = useRef<number | null>(null)
  hoverRef.current = hover?.idx ?? null
  const mountedAtRef = useRef<number | null>(null)
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  // Live: the front follows the newest bar as polls land.
  useEffect(() => {
    if (live && !playing) {
      tipRef.current = Math.max(0, n - 1)
      setTipIdx(Math.max(0, n - 1))
    } else if (tipRef.current > n - 1) {
      tipRef.current = Math.max(0, n - 1)
      setTipIdx(Math.max(0, n - 1))
    }
  }, [n, live, playing])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Positioning: the perp market's longs and shorts (lib/derivs) ─────────
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  useEffect(() => {
    setDerivs(null)
    if (pair.source === 'robinhood') return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: 'no-store' })
        const body = (await res.json()) as DerivsBody
        if (alive && res.ok && Array.isArray(body.oi)) setDerivs(body)
      } catch {
        /* the field draws without positioning */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [symbol, tf, pair.source])

  // The player: a what-if you drop on the board (kept per symbol in this
  // browser), or your real Hyperliquid position when the wallet has one.
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
        /* a private window keeps the player for this visit only */
      }
    },
    [symbol],
  )
  useEffect(() => {
    setLivePos(null)
    if (!address || pair.source === 'robinhood') return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/markets/position?symbol=${encodeURIComponent(symbol)}&address=${address}`, { cache: 'no-store' })
        const body = (await res.json()) as { perp?: PerpPosition | null }
        if (alive) setLivePos(res.ok && body.perp && body.perp.entryPx > 0 ? body.perp : null)
      } catch {
        /* no live position shown */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [address, symbol, pair.source])

  const tipAt = Math.max(0, Math.min(tipIdx, n - 1))
  const tipClose = n ? bars[tipAt].c : 0
  const maxLev = derivs?.hl?.maxLeverage ?? 10
  // The liquidation map (an ESTIMATE): the live one frames the scale, the tip's one is drawn.
  const liveMap = useMemo(() => (derivs && derivs.oi.length > 1 && n > 1 ? liquidationMap(bars, derivs.oi, derivs.oiUnit) : null), [bars, derivs, n])
  const tipMap = useMemo(() => (!liveMap || !derivs ? null : tipAt >= n - 1 ? liveMap : liquidationMap(bars, derivs.oi, derivs.oiUnit, tipAt)), [liveMap, derivs, bars, tipAt, n])
  const buckets = useMemo<LiqBucket[]>(() => (tipMap && tipClose > 0 ? liqBuckets(tipMap.alive, tipClose) : []), [tipMap, tipClose])
  const hits = useMemo<LiqHit[]>(() => (tipMap ? [...tipMap.hits].sort((a, b) => b.usd - a.usd).slice(0, 12) : []), [tipMap])

  const player = useMemo<BoardPlayer | null>(() => {
    if (livePos) return { side: livePos.side, entry: livePos.entryPx, leverage: Math.max(1, livePos.leverage), usd: Math.abs(livePos.valueUsd), live: true, atMarket: false }
    if (!stored || !(tipClose > 0)) return null
    return { side: stored.side, entry: stored.entry ?? tipClose, leverage: stored.leverage, usd: stored.usd, live: false, atMarket: stored.entry === null }
  }, [livePos, stored, tipClose])
  const pstate = useMemo<PlayerState | null>(() => {
    if (!player) return null
    const st = playerState(player, tipClose, maxLev)
    // A real position carries the venue's own liquidation price.
    return player.live && livePos?.liquidationPx ? { ...st, liq: livePos.liquidationPx, toLiqPct: (Math.abs(tipClose - livePos.liquidationPx) / tipClose) * 100, pnlUsd: tipAt >= n - 1 ? livePos.pnlUsd : st.pnlUsd } : st
  }, [player, tipClose, maxLev, livePos, tipAt, n])
  const firstToBreak = player && pstate ? fuelBeforePlayer(buckets, player, tipClose, pstate.liq) : 0

  // What the board says about positioning at the tip.
  const intel = useMemo(() => {
    if (!derivs || n < 2) return null
    const tEnd = bars[tipAt].t + FRAME_SEC[tf]
    let longShare: number | null = null
    for (const r of derivs.ratio) {
      if (r.t > tEnd) break
      longShare = r.long
    }
    const at = oiAtBars(bars, derivs.oi)
    const a = at[Math.max(0, tipAt - 19)]
    const z = at[tipAt + 1] ?? at[tipAt]
    const oiChangePct = a && z ? ((z - a) / a) * 100 : null
    const oiUsd = z ? (derivs.oiUnit === 'coin' ? z * tipClose : z) : null
    const fuel = fuelWithin(buckets, tipClose, 10)
    const read = crowdRead({ longShare, funding8h: tipAt >= n - 1 ? derivs.funding8h : null, oiChangePct, priceChangePct: pressureAt(bars, tipAt)?.movePct ?? null, fuelAbove: fuel.above, fuelBelow: fuel.below })
    return { longShare, oiChangePct, oiUsd, fuel, read }
  }, [derivs, bars, n, tipAt, tf, buckets, tipClose])

  // Prices the scale must hold besides the tape: the big clusters near the
  // price and the player's two lines.
  const include = useMemo(() => {
    const last = n ? bars[n - 1].c : 0
    if (!(last > 0)) return []
    const out: number[] = []
    const liveBuckets = liveMap ? liqBuckets(liveMap.alive, last) : []
    const top = liveBuckets.reduce((m, b) => Math.max(m, b.usd), 0)
    for (const b of liveBuckets) if (b.usd >= top * 0.2 && Math.abs(b.price / last - 1) <= 0.22) out.push(b.price)
    if (player && pstate) for (const p of [player.entry, pstate.liq]) if (p > last * 0.4 && p < last * 1.8) out.push(p)
    return out
    // The player's lines move the scale only when the player's shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMap, n, bars, player?.side, player?.leverage, player?.atMarket ? 0 : player?.entry, player?.live])

  // ── The scene: everything that only changes when the bars do ────────────
  const scene = useMemo(() => {
    if (n < 2) return null
    const scale = fieldScale(bars, include)
    const slots = n + fieldAhead(n)
    const bands = timeBands(bars, tf)
    let volMax = 0
    for (const b of bars) if (b.v > volMax) volMax = b.v
    // Far blocks first: a near block's tower may cover a far one, never the reverse.
    const order = bars.map((_, i) => i).sort((a, b) => Math.max(bars[b].o, bars[b].c) - Math.max(bars[a].o, bars[a].c))
    const trees: Tree[] = []
    const want = Math.max(50, Math.min(150, Math.round(n * 0.6)))
    for (let i = 0; i < want * 2 && trees.length < want; i++) {
      const u = (fieldHash(i, 1) * n) / slots
      const v = 0.03 + fieldHash(i, 2) * 0.94
      const idx = Math.min(n - 1, Math.floor(u * slots))
      const b = bars[idx]
      // The fighting clears the ground: nothing grows inside a bar's range.
      if (v > scale.vOf(b.l) - 0.03 && v < scale.vOf(b.h) + 0.03) continue
      const band = bands.find((x) => idx >= x.from && idx <= x.to)
      trees.push({ u, v, size: 0.7 + fieldHash(i, 3) * 0.7, idx, bull: v < scale.vOf(b.c), season: band?.season ?? 'summer' })
    }
    trees.sort((a, b) => b.v - a.v)
    return { scale, bands, volMax, order, trees, slots, byMonth: tf === '1d' || tf === '4h' }
  }, [bars, n, tf, include])

  const board = { buckets, hits, player, pstate, firstToBreak, longShare: intel?.longShare ?? null, placing }
  const sceneRef = useRef({ scene, bars, tokens, lines, fills, sma50, sma200, size, tf, symbol, board })
  sceneRef.current = { scene, bars, tokens, lines, fills, sma50, sma200, size, tf, symbol, board }

  const box = useCallback((w: number, h: number): FieldBox => ({ left: 12, top: 6, width: Math.max(40, w - 12 - 58), height: Math.max(40, h - 6 - CTL_STRIP) }), [])
  const tiltAt = useCallback(
    (now: number) => {
      if (reduced || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return 1
      if (mountedAtRef.current === null) mountedAtRef.current = now
      return ease(Math.min(1, (now - mountedAtRef.current) / TILT_MS))
    },
    [reduced],
  )

  // ── Draw one frame ──────────────────────────────────────────────────────
  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current
      const { scene: sc, bars: bs, tokens: tk, lines: ls, fills: fl, sma50: s50, sma200: s200, size: sz, tf: frame, board: bd } = sceneRef.current
      if (!canvas || sz.w < 40 || sz.h < 40) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(sz.w * dpr) || canvas.height !== Math.round(sz.h * dpr)) {
        canvas.width = Math.round(sz.w * dpr)
        canvas.height = Math.round(sz.h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, sz.w, sz.h)
      ctx.fillStyle = tk.bg
      ctx.fillRect(0, 0, sz.w, sz.h)
      if (!sc) return
      const count = bs.length
      const tilt = tiltAt(now)
      const t = reduced ? 0 : now
      const { project } = fieldProjector(box(sz.w, sz.h), tilt)
      const P = (u: number, v: number) => project(u, v)
      const { vOf } = sc.scale
      const tipF = Math.max(0, Math.min(count - 1, tipRef.current))
      const tipI = Math.floor(tipF)
      const slots = sc.slots
      const uEnd = (tipI + 1) / slots
      const uc = (i: number) => (i + 0.5) / slots
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
          ctx.fillStyle = rgba(tk.bg, 0.78)
          ctx.fillRect(x0 - 4, y - px / 2 - 3, w + 8, px + 6)
        }
        ctx.fillStyle = color
        ctx.fillText(s, x, y)
      }

      // Sky: a breath of light on the horizon once the table tips.
      const horizon = P(0.5, 1).y
      if (tilt > 0.05) {
        const g = ctx.createLinearGradient(0, Math.max(0, horizon - 70), 0, horizon)
        g.addColorStop(0, rgba(tk.fg, 0))
        g.addColorStop(1, rgba(tk.fg, 0.07 * tilt))
        ctx.fillStyle = g
        ctx.fillRect(0, Math.max(0, horizon - 70), sz.w, 70)
      }

      // Ground. Unfought time (right of the front during a replay) stays fog.
      poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])
      ctx.fillStyle = mix(tk.bg, tk.fg, 0.05)
      ctx.fill()
      poly([P(0, 0), P(uEnd, 0), P(uEnd, 1), P(0, 1)])
      ctx.fillStyle = mix(tk.bg, tk.down, 0.2)
      ctx.fill()
      const front: { x: number; y: number }[] = [P(0, vOf(bs[0].c))]
      for (let i = 0; i <= tipI; i++) front.push(P(uc(i), vOf(bs[i].c)))
      front.push(P(uEnd, vOf(bs[tipI].c)))
      poly([P(0, 0), ...front, P(uEnd, 0)])
      ctx.fillStyle = mix(tk.bg, tk.up, 0.24)
      ctx.fill()

      // Ground-level marks stay on the table.
      ctx.save()
      poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])
      ctx.clip()
      // The calendar on the ground: alternate bands, each month in its season.
      sc.bands.forEach((band, j) => {
        const u0 = band.from / slots
        const u1 = Math.min(uEnd, (band.to + 1) / slots)
        if (u0 >= uEnd) return
        poly([P(u0, 0), P(u1, 0), P(u1, 1), P(u0, 1)])
        if (sc.byMonth) {
          const ink = SEASON_INK[band.season]
          ctx.fillStyle = rgba(ink.ground, ink.alpha)
          ctx.fill()
        }
        if (j % 2) {
          ctx.fillStyle = rgba(tk.fg, 0.028)
          ctx.fill()
        }
        if (j > 0) {
          const a = P(u0, 0)
          const b = P(u0, 1)
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = rgba(tk.fg, 0.1)
          ctx.lineWidth = 1
          ctx.stroke()
        }
      })
      // Price lines across the field.
      const ticks = fieldTicks(sc.scale.lo, sc.scale.hi)
      for (const p of ticks) {
        const a = P(0, vOf(p))
        const b = P(1, vOf(p))
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = rgba(tk.fg, 0.07)
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // Liquidation fuel (estimated, lib/derivs): where leveraged longs (under
      // the price) and shorts (over it) get closed out. A faint trail back to
      // the bars the positions opened on, the fuel itself on the ground ahead.
      let fuelMax = 0
      for (const b of bd.buckets) if (b.usd > fuelMax) fuelMax = b.usd
      const fuelHalf = ((bs[tipI].c * 0.015) / (sc.scale.hi - sc.scale.lo)) * 0.42
      for (const b of bd.buckets) {
        const v = vOf(b.price)
        const k = fuelMax > 0 ? b.usd / fuelMax : 0
        if (v <= 0.005 || v >= 0.995 || k < 0.05) continue
        const uFrom = Math.min(uEnd, (b.from + 0.5) / slots)
        poly([P(uFrom, v - fuelHalf), P(uEnd, v - fuelHalf), P(uEnd, v + fuelHalf), P(uFrom, v + fuelHalf)])
        ctx.fillStyle = rgba(FUEL, 0.03 + 0.1 * k)
        ctx.fill()
        poly([P(uEnd, v - fuelHalf), P(1, v - fuelHalf), P(1, v + fuelHalf), P(uEnd, v + fuelHalf)])
        ctx.fillStyle = rgba(FUEL, 0.1 + 0.45 * k)
        ctx.fill()
      }
      // Drawn zones and trend lines lie on the ground.
      const barSec = FRAME_SEC[frame]
      const uOfT = (time: number) => ((time - bs[0].t) / barSec + 0.5) / slots
      for (const l of ls) {
        if (l.kind === 'zone') {
          const v1 = vOf(Math.min(l.p1, l.p2))
          const v2 = vOf(Math.max(l.p1, l.p2))
          poly([P(0, v1), P(1, v1), P(1, v2), P(0, v2)])
          ctx.fillStyle = rgba(tk.fg, 0.07)
          ctx.fill()
          ctx.setLineDash([5, 4])
          ctx.strokeStyle = rgba(tk.fg, 0.35)
          ctx.stroke()
          ctx.setLineDash([])
        } else if (l.kind === 'trend') {
          const a = P(uOfT(l.t1), vOf(l.p1))
          const b = P(uOfT(l.t2), vOf(l.p2))
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.setLineDash([7, 5])
          ctx.strokeStyle = rgba(tk.fg, 0.6)
          ctx.lineWidth = 1.4
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      // The averages: the 50 is the river, the 200 the road.
      const flow = (vals: (number | null)[] | null | undefined, color: string) => {
        if (!vals) return
        ctx.beginPath()
        let pen = false
        for (let i = 0; i <= tipI && i < vals.length; i++) {
          const val = vals[i]
          if (val === null) {
            pen = false
            continue
          }
          const p = P(uc(i), vOf(val))
          if (pen) ctx.lineTo(p.x, p.y)
          else ctx.moveTo(p.x, p.y)
          pen = true
        }
        ctx.lineJoin = 'round'
        ctx.strokeStyle = rgba(color, 0.2)
        ctx.lineWidth = 7
        ctx.stroke()
        ctx.strokeStyle = rgba(color, 0.9)
        ctx.lineWidth = 2
        ctx.stroke()
      }
      flow(s200, tk.ma200)
      flow(s50, tk.ma50)
      // Wicks: how far each bar's fighting ranged.
      for (let i = 0; i <= tipI; i++) {
        const b = bs[i]
        const a = P(uc(i), vOf(b.l))
        const c = P(uc(i), vOf(b.h))
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(c.x, c.y)
        ctx.strokeStyle = rgba(b.c >= b.o ? tk.up : tk.down, 0.5)
        ctx.lineWidth = 1
        ctx.stroke()
      }
      // The front line.
      ctx.beginPath()
      front.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.strokeStyle = rgba(tk.fg, 0.85)
      ctx.lineWidth = 1.5
      ctx.shadowColor = rgba(tk.fg, 0.6)
      ctx.shadowBlur = 8
      ctx.stroke()
      ctx.shadowBlur = 0
      // The bar under the cursor.
      const hv = hoverRef.current
      if (hv !== null && hv <= tipI) {
        const a = P(uc(hv), 0)
        const b = P(uc(hv), 1)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = rgba(tk.fg, 0.28)
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()

      // The forest: green where buyers hold, charred where sellers do, in the month's colors.
      const lift = Math.max(0, tilt)
      for (const tr of sc.trees) {
        if (tr.idx > tipI) continue
        const p = P(tr.u, tr.v)
        const hgt = 8 * tr.size * p.s * (0.25 + 0.75 * lift)
        const wid = 2.6 * tr.size * p.s
        ctx.globalAlpha = 0.7
        ctx.fillStyle = rgba(tk.fg, 0.35)
        ctx.fillRect(p.x - 0.5, p.y - 1, 1, 2.5)
        ctx.beginPath()
        ctx.moveTo(p.x - wid, p.y - 1)
        ctx.lineTo(p.x + wid, p.y - 1)
        ctx.lineTo(p.x, p.y - 1 - hgt)
        ctx.closePath()
        ctx.fillStyle = tr.bull ? mix(SEASON_INK[tr.season].tree, tk.bg, 0.3) : mix(mix(tk.down, SEASON_INK[tr.season].tree, tr.season === 'winter' ? 0.45 : 0.12), tk.bg, 0.55)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // Units mass where the front is (lib/battlefield: the trailing stretch's force share).
      const press = pressureAt(bs, tipI)
      const troops = troopCounts(bd.longShare ?? press?.bullShare ?? 0.5, Math.max(10, Math.min(44, count * 0.2)))
      const reach = Math.max(6, Math.round(count * 0.12))
      const unit = (j: number, bull: boolean) => {
        const salt = bull ? 11 : 23
        const r1 = fieldHash(j, salt)
        const r2 = fieldHash(j, salt + 1)
        const r3 = fieldHash(j, salt + 2)
        const idx = Math.max(0, tipI - Math.floor(r1 * r1 * reach))
        const frontV = vOf(bs[idx].c)
        const dir = bull ? 1 : -1
        const v = Math.max(0.01, Math.min(0.99, frontV - dir * (0.035 + r2 * 0.11) + Math.sin(t / 900 + r3 * 6.28) * 0.004))
        const u = (idx + 0.15 + 0.7 * r3) / slots
        const p = P(u, v)
        const k = Math.max(0.55, p.s) * (sz.w < 520 ? 0.8 : 1)
        const ink = bull ? tk.up : tk.down
        const dark = mix(ink, tk.bg, 0.55)
        if (j % 3 === 2) {
          // Infantry: three in a row.
          for (let q = -1; q <= 1; q++) {
            ctx.beginPath()
            ctx.arc(p.x + q * 4 * k, p.y - 1.6 * k, 1.7 * k, 0, Math.PI * 2)
            ctx.fillStyle = ink
            ctx.fill()
          }
        } else {
          ctx.fillStyle = dark
          ctx.fillRect(p.x - 5.5 * k, p.y - 3 * k, 11 * k, 4 * k)
          ctx.fillStyle = ink
          ctx.fillRect(p.x - 4.5 * k, p.y - 5.5 * k, 9 * k, 3.5 * k)
          ctx.fillRect(p.x - 2 * k, p.y - 8 * k, 4 * k, 3 * k)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y - 6.5 * k)
          ctx.lineTo(p.x + (r3 - 0.5) * 4 * k, p.y - 6.5 * k - dir * 6 * k)
          ctx.strokeStyle = ink
          ctx.lineWidth = 1.4 * k
          ctx.stroke()
        }
        if (reduced) return
        // Fire across the line: a tracer out, a flash where it lands.
        const period = 2200 + r2 * 3800
        const f = (t / period + r3) % 1
        if (f < 0.22) {
          const prog = f / 0.22
          const target = P(u + (r1 - 0.5) * 0.03, Math.max(0.01, Math.min(0.99, frontV + dir * (0.03 + r3 * 0.08))))
          const from = { x: p.x, y: p.y - 6.5 * k }
          const at = (q: number) => ({ x: from.x + (target.x - from.x) * q, y: from.y + (target.y - from.y) * q - Math.sin(q * Math.PI) * 10 * k * tilt })
          const a = at(Math.max(0, prog - 0.22))
          const b = at(Math.min(1, prog))
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.strokeStyle = rgba(ink, 0.95)
          ctx.lineWidth = 1.5
          ctx.stroke()
          if (prog > 0.82) {
            const q = (prog - 0.82) / 0.18
            ctx.beginPath()
            ctx.arc(target.x, target.y, (2 + q * 6) * k, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(255, 206, 120, ${0.85 * (1 - q)})`
            ctx.fill()
          }
        }
      }
      for (let j = 0; j < troops.bears; j++) unit(j, false)

      // The bars: each block lies where its body lies and stands as tall as its volume.
      const hovered = hoverRef.current
      for (const i of sc.order) {
        if (i > tipI) continue
        const b = bs[i]
        const up = b.c >= b.o
        const va = vOf(Math.min(b.o, b.c))
        const vb = Math.max(vOf(Math.max(b.o, b.c)), va + 0.004)
        const u0 = (i + 0.16) / slots
        const u1 = (i + 0.84) / slots
        // The newest block rises as the replay reaches it.
        const grow = i === tipI && tipF < count - 1 ? Math.max(0.15, tipF - tipI) : 1
        const tall = (sc.volMax > 0 ? 3 + 46 * Math.sqrt(b.v / sc.volMax) : 9) * tilt * grow * (sz.h < 320 ? 0.7 : 1)
        const A = P(u0, va)
        const B = P(u1, va)
        const C = P(u1, vb)
        const D = P(u0, vb)
        const raise = (p: { x: number; y: number; s: number }) => ({ x: p.x, y: p.y - tall * p.s })
        const A2 = raise(A)
        const B2 = raise(B)
        const C2 = raise(C)
        const D2 = raise(D)
        const base = up ? tk.up : tk.down
        const ink = hovered === i ? mix(base, tk.fg, 0.35) : base
        if (tall > 0.5) {
          // The side that faces the middle of the table, then the near face.
          poly(uc(i) < 0.5 ? [B, C, C2, B2] : [A, D, D2, A2])
          ctx.fillStyle = mix(ink, tk.bg, 0.62)
          ctx.fill()
          poly([A, B, B2, A2])
          ctx.fillStyle = mix(ink, tk.bg, 0.42)
          ctx.fill()
        }
        poly([A2, B2, C2, D2])
        ctx.fillStyle = ink
        ctx.fill()
      }

      for (let j = 0; j < troops.bulls; j++) unit(j, true)

      // Where a cluster already went off: the bar whose range reached it.
      const hitMax = bd.hits.reduce((m, h) => Math.max(m, h.usd), 0)
      for (const h of bd.hits) {
        if (h.at > tipI || hitMax <= 0) continue
        const v = vOf(h.price)
        if (v <= 0 || v >= 1) continue
        const p = P(uc(h.at), v)
        const r = (3 + 7 * Math.sqrt(h.usd / hitMax)) * Math.max(0.6, p.s)
        ctx.strokeStyle = rgba(FUEL, 0.9)
        ctx.lineWidth = 1.2
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4 + 0.3
          ctx.beginPath()
          ctx.moveTo(p.x + Math.cos(ang) * r * 0.35, p.y + Math.sin(ang) * r * 0.25)
          ctx.lineTo(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r * 0.7)
          ctx.stroke()
        }
      }
      // Powder kegs on the ground ahead: more barrels, more dollars waiting there.
      const ahead0 = uEnd
      const loudest: Partial<Record<'long' | 'short', LiqBucket>> = {}
      const kegged = new Set([...bd.buckets].sort((a, b) => b.usd - a.usd).slice(0, 6))
      for (const b of bd.buckets) {
        const v = vOf(b.price)
        const k = fuelMax > 0 ? b.usd / fuelMax : 0
        if (v <= 0.01 || v >= 0.99 || !kegged.has(b)) continue
        const inPlay = b.side === 'short' ? b.price > bs[tipI].c : b.price < bs[tipI].c
        if (inPlay && (!loudest[b.side] || b.usd > loudest[b.side]!.usd)) loudest[b.side] = b
        const kegs = 1 + Math.round(k * 3)
        for (let q = 0; q < kegs; q++) {
          const p = P(ahead0 + ((q + 1) * (1 - ahead0)) / (kegs + 1), v)
          const w = 3.2 * Math.max(0.6, p.s)
          const hgt = 8 * Math.max(0.6, p.s) * (0.35 + 0.65 * tilt)
          ctx.fillStyle = mix(FUEL, tk.bg, 0.45)
          ctx.fillRect(p.x - w, p.y - hgt, w * 2, hgt)
          ctx.fillStyle = FUEL
          ctx.fillRect(p.x - w, p.y - hgt, w * 2, 1.6)
          ctx.fillRect(p.x - w, p.y - hgt * 0.5, w * 2, 1)
        }
      }
      for (const side of ['short', 'long'] as const) {
        const b = loudest[side]
        if (!b) continue
        const e = P(1, vOf(b.price))
        text(`${side === 'short' ? 'SHORTS' : 'LONGS'} BREAK · ~${fmtUsdShort(b.usd)} · ${fmtPrice(b.price)}`, e.x - 8, e.y - 11, FUEL, { size: 9, align: 'right', plate: true })
      }

      // The player: one position, its entry and the line where it breaks.
      const pl = bd.player
      const ps = bd.pstate
      if (pl && ps) {
        const ve = vOf(pl.entry)
        const vl = vOf(ps.liq)
        if (ve > 0 && ve < 1) {
          const a = P(0, ve)
          const b = P(1, ve)
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.setLineDash([6, 5])
          ctx.strokeStyle = rgba(tk.accent, 0.7)
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.setLineDash([])
        }
        if (vl > 0 && vl < 1) {
          const a = P(0, vl)
          const b = P(1, vl)
          const hgt = 12 * tilt
          poly([a, b, { x: b.x, y: b.y - hgt * b.s }, { x: a.x, y: a.y - hgt * a.s }])
          ctx.fillStyle = rgba(tk.down, 0.3)
          ctx.fill()
          ctx.beginPath()
          ctx.moveTo(a.x, a.y - hgt * a.s)
          ctx.lineTo(b.x, b.y - hgt * b.s)
          ctx.strokeStyle = tk.down
          ctx.lineWidth = 1.4
          ctx.stroke()
          text(`YOUR ${pl.side.toUpperCase()} BREAKS ~${fmtPrice(ps.liq)}`, a.x + 6, a.y - hgt * a.s - 8, tk.fg, { size: 9, plate: true })
        }
        if (ve > 0 && ve < 1) {
          const p = P(ahead0 + (1 - ahead0) * 0.4, ve)
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
          const pnl = pl.atMarket ? '' : ` ${won ? '+' : '\u2212'}$${Math.abs(ps.pnlUsd).toFixed(2)}`
          text(`YOU · ${pl.live ? 'LIVE ' : ''}${pl.side.toUpperCase()} ${pl.leverage}x${pnl}`, p.x, p.y - 9 * k - 12, pl.atMarket ? tk.fg : won ? tk.up : tk.down, { size: 9, align: 'center', bold: true, plate: true })
        }
      }

      // Walls: the levels you drew, standing across the whole field.
      for (const l of ls) {
        if (l.kind !== 'h') continue
        const v = vOf(l.price)
        if (v <= 0 || v >= 1) continue
        const sell = l.action && (l.action.kind === 'sell' || l.action.kind === 'stop' || (l.action.kind === 'limit' && /sell/.test(l.action.ask)))
        const ink = l.action ? (sell ? tk.down : tk.up) : tk.muted
        const a = P(0, v)
        const b = P(1, v)
        const hgt = 10 * tilt
        poly([a, b, { x: b.x, y: b.y - hgt * b.s }, { x: a.x, y: a.y - hgt * a.s }])
        ctx.fillStyle = rgba(ink, 0.26)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(a.x, a.y - hgt * a.s)
        ctx.lineTo(b.x, b.y - hgt * b.s)
        ctx.strokeStyle = rgba(ink, 0.9)
        ctx.lineWidth = 1
        ctx.stroke()
        text(`${(l.label ?? (l.action ? l.action.kind : 'wall')).toUpperCase().slice(0, 18)} · ${fmtPrice(l.price)}`, a.x + 6, a.y - hgt * a.s - 8, tk.fg, { size: 9, plate: true })
      }

      // Flags: the furthest each side has pushed, and where you signed.
      const flag = (i: number, price: number, ink: string, label: string) => {
        if (tilt < 0.4) return
        const p = P(uc(i), vOf(price))
        const pole = 24 * Math.max(0.6, p.s) * tilt
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x, p.y - pole)
        ctx.strokeStyle = rgba(tk.fg, 0.8)
        ctx.lineWidth = 1.2
        ctx.stroke()
        const wave = reduced ? 0 : Math.sin(t / 380 + i) * 1.5
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - pole)
        ctx.lineTo(p.x + 11, p.y - pole + 3.5 + wave)
        ctx.lineTo(p.x, p.y - pole + 7)
        ctx.closePath()
        ctx.fillStyle = ink
        ctx.fill()
        const right = p.x > sz.w - 170
        // On a phone the calendar and the pressure meter own the sky: a flag's words stay under them.
        text(label, p.x + (right ? -6 : 15), Math.max(p.y - pole + 3, sz.w < 520 ? 74 : 0), tk.fg, { size: 9, align: right ? 'right' : 'left', plate: true })
      }
      const rec = fieldRecords(bs, tipI)
      if (rec && tipI > 4) {
        flag(rec.high, bs[rec.high].h, tk.up, `HIGH-WATER MARK ${fmtPrice(bs[rec.high].h)}`)
        if (rec.low !== rec.high) flag(rec.low, bs[rec.low].l, tk.down, `DEEPEST RAID ${fmtPrice(bs[rec.low].l)}`)
      }
      for (const f of fl ?? []) {
        if (f.t < bs[0].t || f.t > bs[tipI].t + barSec) continue
        const i = Math.max(0, Math.min(tipI, Math.floor((f.t - bs[0].t) / barSec)))
        const usd = f.usd != null && Number.isFinite(f.usd) ? ` $${f.usd >= 100 ? Math.round(f.usd) : f.usd.toFixed(2)}` : ''
        flag(i, bs[i].c, tk.accent, `YOU ${f.side === 'buy' ? 'BOUGHT' : 'SOLD'}${usd}`)
      }

      // The tip of the front: where the fighting is now.
      const tip = P(uc(tipI), vOf(bs[tipI].c))
      const sideInk = press?.side === 'bears' ? tk.down : press?.side === 'bulls' ? tk.up : tk.fg
      const pulse = reduced ? 0.4 : (t / 1400) % 1
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, 4 + pulse * 11, 0, Math.PI * 2)
      ctx.strokeStyle = rgba(sideInk, 0.75 * (1 - pulse))
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2)
      ctx.fillStyle = tk.fg
      ctx.fill()

      // The price scale, down the right edge of the table.
      for (const p of ticks) {
        const e = P(1, vOf(p))
        text(fmtPrice(p), e.x + 8, e.y, tk.muted2, { size: 10 })
      }
      const tag = P(1, vOf(bs[tipI].c))
      const tagText = fmtPrice(bs[tipI].c)
      ctx.font = `600 10px ${FONT}`
      const tagW = ctx.measureText(tagText).width + 10
      ctx.fillStyle = bs[tipI].c >= bs[tipI].o ? tk.up : tk.down
      ctx.fillRect(tag.x + 4, tag.y - 8, tagW, 16)
      text(tagText, tag.x + 9, tag.y + 0.5, tk.bg, { size: 10, bold: true })

      // The road: the calendar you march along.
      poly([P(0, ROAD_V), P(1, ROAD_V), P(1, -0.012), P(0, -0.012)])
      ctx.fillStyle = mix(tk.bg, tk.fg, 0.1)
      ctx.fill()
      const mid = ROAD_V * 0.54
      const ra = P(0, mid)
      const rb = P(1, mid)
      ctx.beginPath()
      ctx.moveTo(ra.x, ra.y)
      ctx.lineTo(rb.x, rb.y)
      ctx.setLineDash([9, 9])
      ctx.strokeStyle = rgba(tk.fg, 0.16)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      let lastSignX = -Infinity
      sc.bands.forEach((band) => {
        const u0 = band.from / slots
        const post = P(u0, -0.012)
        const postTop = post.y - 9 * tilt
        if (band.from > 0) {
          ctx.beginPath()
          ctx.moveTo(post.x, P(u0, ROAD_V).y)
          ctx.lineTo(post.x, postTop)
          ctx.strokeStyle = rgba(tk.fg, 0.4)
          ctx.lineWidth = 1
          ctx.stroke()
        }
        const c = P((band.from + band.to + 1) / 2 / slots, mid)
        ctx.font = `600 10px ${FONT}`
        const room = P((band.to + 1) / slots, mid).x - P(u0, mid).x
        const glyph = sc.byMonth ? 14 : 0
        // A narrow band drops the year ("JAN 2026" → "JAN") before it drops its sign.
        const label = [band.label, band.label.split(' ')[0]].find((s) => ctx.measureText(s).width + glyph + 10 <= room)
        if (!label) return
        const w = ctx.measureText(label).width + glyph
        if (c.x - w / 2 < lastSignX + 8) return
        lastSignX = c.x + w / 2
        const reached = band.from <= tipI
        const tx = c.x - w / 2 + glyph
        text(label, tx, c.y, rgba(tk.fg, reached ? 0.86 : 0.35), { size: 10, bold: true })
        if (sc.byMonth) seasonGlyph(ctx, band.season, c.x - w / 2 + 4.5, c.y, rgba(SEASON_INK[band.season].tree, reached ? 1 : 0.4))
      })
      // The supply truck: today, on the calendar, with its line up to the front.
      const truck = P(uc(tipI), mid)
      ctx.beginPath()
      ctx.moveTo(truck.x, P(uc(tipI), -0.012).y)
      ctx.lineTo(tip.x, tip.y)
      ctx.setLineDash([2, 4])
      ctx.strokeStyle = rgba(tk.fg, 0.3)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = tk.accent
      ctx.fillRect(truck.x - 7, truck.y - 11, 9, 7)
      ctx.fillRect(truck.x + 2, truck.y - 8, 5, 4)
      ctx.fillStyle = tk.fg
      ctx.beginPath()
      ctx.arc(truck.x - 4, truck.y - 3.5, 1.8, 0, Math.PI * 2)
      ctx.arc(truck.x + 4, truck.y - 3.5, 1.8, 0, Math.PI * 2)
      ctx.fill()
    },
    [box, reduced, tiltAt],
  )

  // ── The loop: ambient motion, the tilt, and the replay's march ──────────
  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let alive = true
    const frame = (now: number) => {
      if (!alive) return
      const dt = Math.min(64, now - prev)
      prev = now
      if (playing) {
        const count = sceneRef.current.bars.length
        tipRef.current = Math.min(count - 1, tipRef.current + (dt / REPLAY_MS) * count)
        const whole = Math.floor(tipRef.current)
        setTipIdx((cur) => (cur === whole ? cur : whole))
        if (tipRef.current >= count - 1) {
          setPlaying(false)
          setLive(true)
        }
      }
      draw(now)
      if (!reduced || playing) raf = requestAnimationFrame(frame)
    }
    // One frame now (a hidden tab holds its animation frames), then the loop.
    draw(performance.now())
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [draw, playing, reduced, scene, tokens, lines, fills, sma50, sma200, size, tipIdx, hover?.idx])

  // ── Pointer: a bar's report on hover, a jump in time on click ───────────
  const barAt = useCallback(
    (clientX: number, clientY: number): { idx: number; x: number; y: number; price: number } | null => {
      const el = wrapRef.current
      const sc = sceneRef.current.scene
      if (!el || n < 2 || !sc) return null
      const r = el.getBoundingClientRect()
      const x = clientX - r.left
      const y = clientY - r.top
      const { unproject } = fieldProjector(box(r.width, r.height), tiltAt(performance.now()))
      const g = unproject(x, y)
      if (g.u < 0 || g.u >= 1 || g.v < ROAD_V - 0.02 || g.v > 1.04) return null
      // Past the newest bar is the ground ahead: it reads as the newest bar.
      return { idx: Math.min(n - 1, Math.floor(g.u * sc.slots)), x, y, price: sc.scale.lo + Math.max(0, Math.min(1, g.v)) * (sc.scale.hi - sc.scale.lo) }
    },
    [box, n, tiltAt],
  )

  const jump = useCallback(
    (idx: number) => {
      const to = Math.max(0, Math.min(n - 1, idx))
      tipRef.current = to
      setTipIdx(to)
      setPlaying(false)
      setLive(to >= n - 1)
    },
    [n],
  )

  const replay = useCallback(() => {
    if (playing) {
      setPlaying(false)
      return
    }
    // From the start when the front is at (or near) the end; from here otherwise.
    if (tipRef.current >= n - 2) {
      tipRef.current = 0
      setTipIdx(0)
    }
    setLive(false)
    setPlaying(true)
  }, [playing, n])

  if (n < 2 || !scene) {
    return (
      <div ref={wrapRef} className="bf">
        <canvas ref={canvasRef} className="bf__canvas" aria-hidden="true" />
        <p className="bf__empty mono">Mustering the field…</p>
      </div>
    )
  }

  const tipBar = bars[Math.min(tipIdx, n - 1)]
  const date = fieldDate(tipBar.t, tf)
  const press = pressureAt(bars, Math.min(tipIdx, n - 1))
  const hoverBar = hover && hover.idx <= tipIdx ? bars[hover.idx] : null
  const report = hoverBar ? battleReport(hoverBar, symbol) : null
  const hoverDate = hoverBar ? fieldDate(hoverBar.t, tf) : null
  const stance = press?.side === 'bulls' ? 'Bulls advancing' : press?.side === 'bears' ? 'Bears advancing' : 'Stalemate'
  const share = Math.round((press?.bullShare ?? 0.5) * 100)
  const crowd = intel && intel.longShare !== null ? intel : null
  const longPct = crowd ? Math.round(crowd.longShare! * 100) : 0
  const atLive = tipAt >= n - 1
  // The order the player stands for: offered only while it is an at-market
  // what-if on a coin Hyperliquid lists, at a leverage the venue allows.
  const perpOk = pair.source === 'hyperliquid' || hasPerpCold(pair.symbol)
  const openAsk = (() => {
    if (!onAsk || !stored || livePos || stored.entry !== null || !perpOk || stored.leverage > maxLev || !atLive) return null
    const ask = composeExecAsk(pair, stored.side, { usd: stored.usd, leverage: stored.leverage })
    return ask && (canAsk ? canAsk(ask) : true) ? ask : null
  })()
  const levs = PLAYER_LEVERAGES.filter((l) => l <= maxLev)
  const cycle = <T,>(list: T[], cur: T): T => list[(Math.max(0, list.indexOf(cur)) + 1) % list.length]
  const addPlayer = (side: 'long' | 'short') => savePlayer({ side, leverage: levs.includes(3) ? 3 : levs[0] ?? 1, usd: 25, entry: null })

  return (
    <div
      ref={wrapRef}
      className={`bf${playing ? ' is-playing' : ''}${placing ? ' is-placing' : ''}`}
      onPointerMove={(e) => {
        if ((e.target as HTMLElement).closest('.bf__strip')) return setHover(null)
        setHover(barAt(e.clientX, e.clientY))
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.bf__strip')) return
        const hit = barAt(e.clientX, e.clientY)
        if (!hit) return
        // Placing: the click is the player's entry price. Otherwise it moves the front.
        if (placing && stored) {
          savePlayer({ ...stored, entry: Number(hit.price.toPrecision(5)) })
          setPlacing(false)
        } else jump(hit.idx)
      }}
    >
      <canvas
        ref={canvasRef}
        className="bf__canvas"
        role="img"
        aria-label={`${symbol} as a battlefield on ${date.month} ${date.day}, ${date.year}: ${stance.toLowerCase()}. ${press ? pressureLine(press) : ''}. Front line at ${fmtPrice(tipBar.c)} dollars.`}
      />

      {/* The date: a tear-off calendar that flips as the front moves through time. */}
      <div className="bf__date">
        <div className="bf__cal" key={`${date.month}${date.day}${date.time ?? ''}`}>
          <span className="bf__cal-m mono">{date.month}</span>
          <span className="bf__cal-d">{date.day}</span>
          <span className="bf__cal-y mono">{date.time ?? date.year}</span>
        </div>
        <div className="bf__day mono">
          <span>
            {tf === '1d' ? 'Day' : 'Bar'} {Math.min(tipIdx, n - 1) + 1}
            <i> / {n}</i>
          </span>
          <span className="bf__day-sub">{live && !playing ? 'the front, live' : playing ? 'replaying' : 'looking back'}</span>
        </div>
      </div>

      {/* Longs vs shorts when an exchange publishes it; the tape's own pressure otherwise. */}
      {crowd ? (
        <div className={`bf__press bf__press--${crowd.read.lean === 'up' ? 'bulls' : crowd.read.lean === 'down' ? 'bears' : 'stalemate'}`}>
          <span className="bf__press-k mono">Longs vs shorts · {derivs?.source} accounts</span>
          <span className="bf__press-v">{crowd.read.headline}</span>
          <span className="bf__meter" style={{ '--bf-share': `${longPct}%` } as CSSProperties} title={`${longPct}% of accounts with a position are net long (${derivs?.source})`}>
            <i />
          </span>
          <span className="bf__press-l mono">
            {longPct}% long · {100 - longPct}% short
            {atLive && derivs?.funding8h != null ? ` · funding ${fundingLine(derivs.funding8h)}` : ''}
          </span>
          {crowd.oiUsd != null || crowd.read.flow ? (
            <span className="bf__press-l bf__press-l2 mono">
              {crowd.oiUsd != null ? `open interest ${fmtUsdShort(crowd.oiUsd)}${crowd.oiChangePct != null ? ` (${crowd.oiChangePct >= 0 ? '+' : '\u2212'}${Math.abs(crowd.oiChangePct).toFixed(1)}% / 20 bars)` : ''}` : ''}
              {crowd.oiUsd != null && crowd.read.flow ? ' · ' : ''}
              {crowd.read.flow ? crowd.read.flow.split(': ')[1] : ''}
            </span>
          ) : null}
        </div>
      ) : (
        press && (
          <div className={`bf__press bf__press--${press.side}`}>
            <span className="bf__press-k mono">Market pressure</span>
            <span className="bf__press-v">{stance}</span>
            <span className="bf__meter" style={{ '--bf-share': `${share}%` } as CSSProperties} title={`${share}% of the stretch's volume traded on up bars`}>
              <i />
            </span>
            <span className="bf__press-l mono">{pressureLine(press)}</span>
          </div>
        )
      )}

      {report && hover && hoverDate && (
        <div
          className={`bf__tip bf__tip--${report.outcome}`}
          style={{ left: Math.max(8, Math.min(size.w - 268, hover.x + 16)), top: Math.max(8, Math.min(size.h - 150, hover.y - 20)) }}
          role="status"
        >
          <span className="bf__tip-k mono">
            Battle report · {hoverDate.month} {hoverDate.day}
            {hoverDate.time ? ` · ${hoverDate.time}` : `, ${hoverDate.year}`}
          </span>
          <strong>{report.headline}</strong>
          {report.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
          <span className="bf__tip-h mono">{placing ? `click to set your entry at ${fmtPrice(hover.price)}` : 'click to move the front here'}</span>
        </div>
      )}

      <div className="bf__strip">
        <div className="bf__row">
          <div className="bf__ctl">
            <button type="button" className="bf__play" onClick={replay} aria-label={playing ? 'Pause the replay' : 'Replay the campaign'} title={playing ? 'Pause' : 'Replay the campaign from the first bar'}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="mono">{playing ? 'Pause' : 'Replay'}</span>
            </button>
            <input
              className="bf__scrub"
              type="range"
              min={0}
              max={n - 1}
              step={1}
              value={Math.min(tipIdx, n - 1)}
              aria-label="Move the front through time"
              aria-valuetext={`${date.month} ${date.day}, ${date.year}${date.time ? ` ${date.time}` : ''}`}
              onChange={(e) => jump(Number(e.target.value))}
            />
            <button type="button" className={`bf__live mono${live && !playing ? ' is-live' : ''}`} onClick={() => jump(n - 1)} title="Back to the newest bar">
              <i aria-hidden="true" /> Live
            </button>
          </div>
          <p className="bf__legend mono">
            <span><i className="bf__sw bf__sw--up" />{crowd ? 'longs' : 'buyers'}</span>
            <span><i className="bf__sw bf__sw--down" />{crowd ? 'shorts' : 'sellers'}</span>
            {buckets.length && intel ? <span title="Estimated from open interest that appeared on each bar, across 5x to 50x. Where the fuel probably is, not where price will go."><i className="bf__sw bf__sw--fuel" />est. liquidations within 10%: {fmtUsdShort(intel.fuel.above)} shorts above · {fmtUsdShort(intel.fuel.below)} longs below</span> : null}
            {buckets.length ? null : <span>block height = volume</span>}
            {sma50 ? <span><i className="bf__sw bf__sw--50" />SMA 50</span> : null}
            {sma200 ? <span><i className="bf__sw bf__sw--200" />SMA 200</span> : null}
          </p>
        </div>

        {/* The player: a position on the board. A what-if until its order is opened. */}
        {pair.source !== 'robinhood' && (
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
                  {!player.atMarket ? <> · <b className={pstate.pnlUsd >= 0 ? 'is-up' : 'is-down'}>{pstate.pnlUsd >= 0 ? '+' : '\u2212'}${Math.abs(pstate.pnlUsd).toFixed(2)}</b></> : null}
                </span>
                {!player.live && stored && (
                  <button type="button" className={`bf__chip bf__chip--move mono${placing ? ' is-on' : ''}`} onClick={() => (stored.entry !== null && !placing ? savePlayer({ ...stored, entry: null }) : setPlacing((v) => !v))} title={stored.entry !== null ? 'Put the entry back at the market price' : 'Click the board to try another entry price'}>
                    {placing ? 'click the board…' : stored.entry !== null ? 'at market' : 'move entry'}
                  </button>
                )}
                {openAsk && onAsk && (
                  <button type="button" className="bf__open" onClick={() => onAsk(openAsk)} title={openAsk}>Open<span className="bf__player-wide">&nbsp;on Hyperliquid</span></button>
                )}
                {player.live && onAsk && atLive && (
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

/** A 9px mark for the month's season, beside its road sign. */
function seasonGlyph(ctx: CanvasRenderingContext2D, season: Season, x: number, y: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.2
  if (season === 'winter') {
    // A snowflake: three crossed strokes.
    for (let a = 0; a < 3; a++) {
      const ang = (a * Math.PI) / 3
      ctx.beginPath()
      ctx.moveTo(Math.cos(ang) * 4.5, Math.sin(ang) * 4.5)
      ctx.lineTo(-Math.cos(ang) * 4.5, -Math.sin(ang) * 4.5)
      ctx.stroke()
    }
  } else if (season === 'summer') {
    // A sun.
    ctx.beginPath()
    ctx.arc(0, 0, 2.4, 0, Math.PI * 2)
    ctx.fill()
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4
      ctx.beginPath()
      ctx.moveTo(Math.cos(ang) * 3.6, Math.sin(ang) * 3.6)
      ctx.lineTo(Math.cos(ang) * 5, Math.sin(ang) * 5)
      ctx.stroke()
    }
  } else if (season === 'spring') {
    // A sprout: a stem and two leaves.
    ctx.beginPath()
    ctx.moveTo(0, 4.5)
    ctx.lineTo(0, -1)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(-2.4, -2, 2.6, 1.5, -0.6, 0, Math.PI * 2)
    ctx.ellipse(2.4, -2.6, 2.6, 1.5, 0.6, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // A falling leaf.
    ctx.rotate(-0.5)
    ctx.beginPath()
    ctx.moveTo(0, -4.5)
    ctx.quadraticCurveTo(4, 0, 0, 4.5)
    ctx.quadraticCurveTo(-4, 0, 0, -4.5)
    ctx.fill()
  }
  ctx.restore()
}
