'use client'

// THE FLYOVER on /live (2026-10-15): fly over every market. Buys raise the
// land, sells sink it; color is the price move; every plot carries the
// sentence a wallet can sign. lib/flyover holds the rules (the ledger, the
// ladders, the layout, the board, the sentences); ./flyover-scene draws the
// world with three.js and is imported ONLY here, lazily, after mount — so the
// server bundle and the other four views never load three.
//
// This file is the shell: the subscription (Dune's firehose through our relay
// with its 5-minute backfill, so the land is populated at open; the venue's
// keyless socket when the relay has no key), the ledger in a ref (no React
// render per fill), a one-second hand that turns the ledger into heights,
// colors, labels and the leaderboard, the bar (window · lens · venues · fly
// to · pause · tour · fit · fullscreen), the HUD (status, leaderboard, sky
// log, the readout card), the legend, and the act door. Every chip is
// lib/tape followAsk's sentence, shown only when canTradeAsk passes, and runs
// through the connect-to-act door into the ask door's sheet — the world keeps
// flying behind the ticket. Nothing fires on its own; the signature is the gate.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Crosshair, Maximize2, Minimize2, Pause, Play, Plane, X } from 'lucide-react'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import { readTokens } from '@/components/markets/chart/chart-tokens'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import type { TradabilityMap } from '@/lib/tradability'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useMarketPick } from '@/lib/use-market-pick'
import { addToPick, MAX_PICK } from '@/lib/market-pick'
import { knownMarkets } from '@/lib/live-markets'
import { readArmyContexts } from '@/lib/battle-feed'
import { LIVE_VIEWS, type ArmyContext } from '@/lib/battle'
import { pulseStreamWanted, pulseVisibilityStep, type PulseVisibility } from '@/lib/pulse'
import { DEFAULT_LIVE_VENUES, DUNE_VENUES, type DuneVenueId } from '@/lib/dune'
import { FALLBACK_MARKETS, FOLLOW_USD, dexAskTicker, followAsk, pickTapeMarkets, type FollowAsk, type TapeFill, type TapeSource } from '@/lib/tape'
import { hlTapeFeed, openDuneTape, readTapeUniverse, type FeedHandlers, type FeedStatus } from '@/lib/tape-feed'
import {
  CONTINENTS,
  FLYOVER_WINDOWS,
  LENSES,
  LENS_HINT,
  LENS_LABEL,
  LEGEND_LINES,
  MOVE_CLAMP_PCT,
  WINDOW_SEC,
  boardByFor,
  boardHeads,
  censusDue,
  continentDef,
  continentOf,
  createLedger,
  flyoverSearch,
  fmtNet,
  fmtPctAscii,
  fmtUsd3,
  heightFor,
  ingest,
  isBigPrint,
  labelTier,
  layoutWorld,
  leaderboard,
  lensHasSea,
  meteorTag,
  moveT,
  parseFlyoverWindow,
  parseLens,
  plotAsks,
  plotChartHref,
  plotKey,
  plotName,
  plotSize,
  prune,
  pushSky,
  readoutLines,
  retract,
  selectPlots,
  sessionUsd,
  shouldRelayout,
  skyLine,
  sums,
  type BoardRow,
  type ContinentId,
  type FlyoverLens,
  type FlyoverWindow,
  type LayoutStamp,
  type PlotSums,
  type SkyRow,
  type WorldLayout,
} from '@/lib/flyover'
import type { FlyoverScene, SceneInks, SceneLabel } from './flyover-scene'

const HINT_KEY = 'pantessa.live.flyover.hint'
const HINT_MS = 6_000
/** Backfilled prints ingested per task. */
const BACKFILL_SLICE = 1_500
/** Drops one batch may spawn (a burst still reads; the frame stays cheap). */
const DROPS_PER_BATCH = 120
/** Venue toggles, in the bar's words. */
const VENUE_SHORT: Record<DuneVenueId, string> = { hypercore: 'HyperCore', lighter: 'Lighter', 'lighter-robinhood': 'Lighter RH', 'dex-base': 'Base', 'dex-ethereum': 'Ethereum', 'dex-arbitrum': 'Arbitrum' }

/** How long a click waits before opening a plot's page: one double-click's
 *  length, so a double-click still flies there instead. */
const OPEN_DELAY_MS = 240

interface PlotInfo {
  key: string
  market: string
  continent: ContinentId
  venue: TapeFill['venue']
  chainId: number | null
  sums: PlotSums
  session: number
  day: number | null
  size: number
}

interface Hud {
  /** Plots the ledger holds (markets that printed in 15 minutes). */
  markets: number
  drawn: number
  fillsPerSec: number
  board: { risers: BoardRow[]; sinkers: BoardRow[] }
  continents: { id: ContinentId; gross: number; net: number; count: number }[]
  pickRows: { key: string; market: string; sums: PlotSums }[]
  firstPrint: boolean
}

const EMPTY_HUD: Hud = { markets: 0, drawn: 0, fillsPerSec: 0, board: { risers: [], sinkers: [] }, continents: [], pickRows: [], firstPrint: false }

export interface FlyoverProps {
  tradable: TradabilityMap
  tabs?: ReactNode
  /** 'page' = /live (the frame, the Continents rail, the URL mirror); 'stage' =
   *  a channel on the splash's deck (components/home/Deck, 2026-10-15): the
   *  same world at the same size, the deck's bar and foot standing in for the
   *  title and the rail, and the URL left alone (it is the home page's). */
  seat?: 'page' | 'stage'
  /** The stage seat reports the feed to the deck's foot. */
  onReport?: (r: { status: FeedStatus; detail?: string; source: TapeSource; markets: number; hidden: boolean }) => void
  /** The deck's ladder follows the land's top HyperCore riser (pinned first). */
  onBookMarket?: (market: string | null) => void
  /** The home deck's stage keeps the window and the lens in `/`'s address (2026-10-20). */
  url?: boolean
}

export default function Flyover({ tradable, tabs, seat = 'page', onReport, onBookMarket, url = false }: FlyoverProps) {
  const onPage = seat === 'page'
  const params = useSearchParams()
  const [w, setW] = useState<FlyoverWindow>(() => parseFlyoverWindow(params?.get('w')))
  const [lens, setLens] = useState<FlyoverLens>(() => parseLens(params?.get('lens')))
  const [venues, setVenues] = useState<DuneVenueId[]>([...DEFAULT_LIVE_VENUES])
  const [source, setSource] = useState<TapeSource>('dune')
  const [relayNote, setRelayNote] = useState<string | null>(null)
  const [hlMarkets, setHlMarkets] = useState<string[] | null>(null)
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [sky, setSky] = useState<SkyRow[]>([])
  const [paused, setPaused] = useState(false)
  const [touring, setTouring] = useState(false)
  const [full, setFull] = useState(false)
  /** Where an element cannot go fullscreen (iPhone Safari; a refusal), the
   *  view fills the window instead: the same posture, by CSS. */
  const [fakeFull, setFakeFull] = useState(false)
  const [sceneState, setSceneState] = useState<'loading' | 'ready' | 'no-webgl'>('loading')
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [query, setQuery] = useState('')
  const [flyNote, setFlyNote] = useState<string | null>(null)
  const [vis, setVis] = useState<PulseVisibility | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [mounted, setMounted] = useState(false)

  const pick = useMarketPick({ seat })
  const ledgerRef = useRef(createLedger())
  const infoRef = useRef<Map<string, PlotInfo>>(new Map())
  const layoutRef = useRef<WorldLayout | null>(null)
  const stampRef = useRef<LayoutStamp | null>(null)
  const censusRef = useRef<number | null>(null)
  const openedRef = useRef(Date.now())
  const ctxRef = useRef<Map<string, ArmyContext>>(new Map())
  const sceneRef = useRef<FlyoverScene | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const fontProbeRef = useRef<HTMLSpanElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  const skyRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const reducedRef = useRef(false)
  const hiddenRef = useRef(false)
  const stateRef = useRef({ w, lens, pickMarkets: pick.markets, pinned, hover, pickReady: !!pick.ready })
  stateRef.current = { w, lens, pickMarkets: pick.markets, pinned, hover, pickReady: !!pick.ready }
  const secCounts = useRef({ sec: new Float64Array(16), n: new Uint32Array(16) })
  const userPinnedRef = useRef(false)
  const pointerRef = useRef<{ x: number; y: number; down: { x: number; y: number; t: number } | null; pending: boolean }>({ x: 0, y: 0, down: null, pending: false })

  useEffect(() => setMounted(true), [])

  // ── The URL: ?w= and ?lens= off their defaults, everything else kept ───
  useEffect(() => {
    if (typeof window === 'undefined' || !(onPage || url)) return
    const next = window.location.pathname + flyoverSearch(window.location.search, w, lens)
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', next)
  }, [w, lens, onPage, url])

  // ── Visibility: a hidden tab closes the stream after 15 s ──────────────
  useEffect(() => {
    const read = () => {
      hiddenRef.current = document.hidden
      setVis((prev) => pulseVisibilityStep(prev, document.hidden, Date.now()))
    }
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])
  const streamOn = vis ? pulseStreamWanted(vis, now) : false

  // ── Reduced motion ─────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const set = () => {
      reducedRef.current = mq.matches
      sceneRef.current?.setReducedMotion(mq.matches)
      if (mq.matches) setTouring(false)
    }
    set()
    mq.addEventListener('change', set)
    return () => mq.removeEventListener('change', set)
  }, [])

  // ── The venue's 24h volumes (HyperCore's own number for the footprint) ─
  useEffect(() => {
    const ac = new AbortController()
    const read = () =>
      readArmyContexts(ac.signal).then((m) => {
        if (!ac.signal.aborted && m.size) ctxRef.current = m
      })
    read()
    const id = setInterval(read, 60_000)
    return () => {
      ac.abort()
      clearInterval(id)
    }
  }, [])

  // ── The fallback's markets: the venue's busiest, once, if it is needed ─
  useEffect(() => {
    if (source !== 'hyperliquid' || hlMarkets) return
    const ac = new AbortController()
    readTapeUniverse(ac.signal).then(({ main, xyz }) => {
      if (ac.signal.aborted) return
      const picked = pickTapeMarkets(main, xyz)
      setHlMarkets(picked.length ? picked : [...FALLBACK_MARKETS])
    })
    return () => ac.abort()
  }, [source, hlMarkets])

  // ── Fills into the ledger (and the sky) ────────────────────────────────
  const batchMsRef = useRef(0)
  const onBatch = useCallback((fills: readonly TapeFill[], backfill: boolean) => {
    const t0 = performance.now()
    const ledger = ledgerRef.current
    const t = Date.now()
    const sc = sceneRef.current
    const animate = !backfill && !pausedRef.current && !reducedRef.current && !hiddenRef.current && !!sc
    let spawned = 0
    let bigs: TapeFill[] | null = null
    for (const f of fills) {
      const key = ingest(ledger, f, t)
      if (!key) continue
      if (!backfill) {
        const sec = Math.floor(t / 1000)
        const slot = sec % 16
        const c = secCounts.current
        if (c.sec[slot] !== sec) {
          c.sec[slot] = sec
          c.n[slot] = 0
        }
        c.n[slot]++
      }
      if (isBigPrint(f)) (bigs ??= []).push(f)
      if (!animate) continue
      if (isBigPrint(f)) sc!.meteor(key, f.side, f.usd, meteorTag(f))
      else if (spawned < DROPS_PER_BATCH) {
        sc!.drop(key, f.side, f.usd)
        spawned++
      }
    }
    if (bigs) {
      const add = bigs
      setSky((prev) => add.reduce((log, f) => pushSky(log, f), prev))
    }
    batchMsRef.current = Math.max(batchMsRef.current, performance.now() - t0)
  }, [])

  // The relay's backfill is thousands of prints at once (five minutes of every
  // venue): it lands in slices of BACKFILL_SLICE, one per task, so no slice
  // holds the main thread past the frame budget.
  const backfillRef = useRef<{ queue: TapeFill[][]; timer: ReturnType<typeof setTimeout> | null }>({ queue: [], timer: null })
  const onBackfill = useCallback(
    (fills: readonly TapeFill[]) => {
      const b = backfillRef.current
      for (let i = 0; i < fills.length; i += BACKFILL_SLICE) b.queue.push(fills.slice(i, i + BACKFILL_SLICE))
      const drain = () => {
        b.timer = null
        const next = b.queue.shift()
        if (!next) return
        onBatch(next, true)
        if (b.queue.length) b.timer = setTimeout(drain, 0)
      }
      if (!b.timer) b.timer = setTimeout(drain, 0)
    },
    [onBatch],
  )
  useEffect(
    () => () => {
      const b = backfillRef.current
      if (b.timer) clearTimeout(b.timer)
      b.queue = []
    },
    [],
  )

  // ── The stream. Reconnects itself; this effect only opens and closes it ─
  useEffect(() => {
    if (!streamOn) return
    const handlers: FeedHandlers = {
      onFills: (batch) => onBatch(batch, false),
      onBackfill: (fills) => onBackfill(fills),
      onRetract: (venue, block) => {
        retract(ledgerRef.current, venue, block)
      },
      onStatus: (s, d) => {
        if (s === 'unconfigured' && source === 'dune') {
          setRelayNote(d ?? 'the relay has no feed key')
          setSource('hyperliquid')
          return
        }
        setStatus(s)
        setDetail(d)
      },
    }
    if (source === 'dune') return openDuneTape([], handlers, { venues, filter: false, backfill: true }).close
    if (!hlMarkets) return
    return hlTapeFeed.connect(hlMarkets, handlers)
  }, [source, venues, hlMarkets, streamOn, onBatch, onBackfill])

  // ── The scene: three, lazily, after mount ──────────────────────────────
  const inksNow = useCallback((): SceneInks => {
    const t = readTokens()
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255
    }
    return { bg: t.bg, fg: t.fg, muted: t.muted, line: t.line, surf: t.surf, accent: t.accent, up: t.up, down: t.down, water: t.series[0] ?? t.accent, light: lum(t.bg) > 0.5 }
  }, [])

  useEffect(() => {
    let gone = false
    let scene: FlyoverScene | null = null
    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null
    import('./flyover-scene')
      .then((mod) => {
        if (gone || !canvasRef.current || !stageRef.current) return
        if (!mod.webglAvailable()) {
          setSceneState('no-webgl')
          return
        }
        const probe = fontProbeRef.current
        const fontMono = probe ? getComputedStyle(probe).fontFamily : 'ui-monospace, monospace'
        const fontUi = mainRef.current ? getComputedStyle(mainRef.current).fontFamily : 'system-ui, sans-serif'
        const narrow = window.innerWidth < 768
        try {
          scene = mod.createFlyoverScene(canvasRef.current, { inks: inksNow(), reducedMotion: reducedRef.current, dpr: Math.min(narrow ? 1.5 : 2, window.devicePixelRatio || 1), fontMono, fontUi })
        } catch {
          setSceneState('no-webgl')
          return
        }
        sceneRef.current = scene
        scene.onInteract(() => {
          setTouring(false)
          setHint(false)
        })
        ro = new ResizeObserver(() => scene?.resize())
        ro.observe(stageRef.current)
        mo = new MutationObserver(() => scene?.setInks(inksNow()))
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
        document.fonts?.ready.then(() => !gone && scene?.setInks(inksNow()))
        // Whatever the one-second hand already built lands now.
        if (layoutRef.current) scene.setWorld(layoutRef.current)
        scene.setSea(lensHasSea(stateRef.current.lens))
        if (!reducedRef.current) {
          scene.tour(true)
          setTouring(true)
        }
        setSceneState('ready')
      })
      .catch(() => {
        if (!gone) setSceneState('no-webgl')
      })
    return () => {
      gone = true
      ro?.disconnect()
      mo?.disconnect()
      scene?.dispose()
      sceneRef.current = null
    }
  }, [inksNow])

  useEffect(() => {
    sceneRef.current?.setSea(lensHasSea(lens))
  }, [lens, sceneState])

  // ── The HUD's footprint: the world centres in the space it leaves ──────
  useEffect(() => {
    if (sceneState !== 'ready') return
    const measure = () => {
      const sc = sceneRef.current
      const stage = stageRef.current
      const side = sideRef.current
      const skyEl = skyRef.current
      if (!sc || !stage) return
      const overlaid = !!side && getComputedStyle(side).position === 'absolute'
      if (!overlaid) {
        sc.setInsets(0, 0)
        return
      }
      const sr = stage.getBoundingClientRect()
      const right = side ? Math.max(0, sr.right - side.getBoundingClientRect().left) : 0
      const bottom = skyEl ? Math.min(140, Math.max(0, sr.bottom - skyEl.getBoundingClientRect().top) * 0.6) : 0
      sc.setInsets(right, bottom)
      // No label under a panel: the side column's own children (the board, the
      // readout), the sky log and the status pill, in canvas px.
      const rel = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return r.width && r.height ? { x0: r.left - sr.left - 4, y0: r.top - sr.top - 4, x1: r.right - sr.left + 4, y1: r.bottom - sr.top + 4 } : null
      }
      const panels = [...(side?.children ?? []), skyEl, stage.querySelector('.flyover__status')].map(rel).filter((r): r is { x0: number; y0: number; x1: number; y1: number } => r !== null)
      sc.setExclusions(panels)
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of [stageRef.current, sideRef.current, skyRef.current]) if (el) ro.observe(el)
    // The readout card comes and goes inside the side column: watch its children too.
    const mo = new MutationObserver(() => {
      for (const el of sideRef.current?.children ?? []) ro.observe(el)
      measure()
    })
    if (sideRef.current) mo.observe(sideRef.current, { childList: true })
    for (const el of sideRef.current?.children ?? []) ro.observe(el)
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [sceneState])

  // ── The hint, once per browser ─────────────────────────────────────────
  useEffect(() => {
    if (sceneState !== 'ready') return
    let seen = false
    try {
      seen = window.localStorage.getItem(HINT_KEY) === '1'
      if (!seen) window.localStorage.setItem(HINT_KEY, '1')
    } catch {
      // storage blocked: show it, it fades on its own
    }
    if (seen) return
    setHint(true)
    const id = setTimeout(() => setHint(false), HINT_MS)
    return () => clearTimeout(id)
  }, [sceneState])

  // ── The one-second hand: the ledger → the world, the board, the HUD ────
  const stepRef = useRef<((force?: boolean) => void) | null>(null)
  useEffect(() => {
    const step = (force = false) => {
      const tickStart = performance.now()
      const t = Date.now()
      setNow(t)
      const ledger = ledgerRef.current
      prune(ledger, t)
      const { w: win, lens: ln, pickMarkets, pinned: pin, hover: hov, pickReady } = stateRef.current
      const nowSec = Math.floor(t / 1000)
      const wSec = WINDOW_SEC[win]
      const pickSet = new Set(pickMarkets.map((m) => m.toLowerCase()))
      const info = new Map<string, PlotInfo>()
      for (const p of ledger.plots.values()) {
        const s = sums(p, nowSec, wSec)
        const session = sessionUsd(p, nowSec)
        const ctx = p.continent === 'hypercore' || p.continent === 'hypercore-xyz' ? ctxRef.current.get(p.market) : undefined
        const day = ctx && ctx.dayNtlVlm > 0 ? ctx.dayNtlVlm : null
        info.set(p.key, { key: p.key, market: p.market, continent: p.continent, venue: p.venue, chainId: p.chainId, sums: s, session, day, size: plotSize({ dayVolumeUsd: day, sessionUsd: session }) })
      }
      infoRef.current = info
      // The census: which plots hold land.
      let layout = layoutRef.current
      if (censusDue(censusRef.current, openedRef.current, t) && info.size) {
        censusRef.current = t
        const cands = [...info.values()].map((p) => ({ key: p.key, size: p.size, lastAt: ledger.plots.get(p.key)?.lastAt ?? 0, pick: pickSet.has(p.market.toLowerCase()) }))
        const keys = selectPlots(cands, t)
        const sizes = new Map(keys.map((k) => [k, info.get(k)!.size] as const))
        if (shouldRelayout(stampRef.current, { keys, sizes }, t)) {
          layout = layoutWorld(keys.map((k) => ({ key: k, continent: info.get(k)!.continent, size: sizes.get(k)! })))
          layoutRef.current = layout
          stampRef.current = { keys, sizes, at: t }
          sceneRef.current?.setWorld(layout)
        }
      }
      const drawn = layout ? layout.plots.filter((p) => info.has(p.key)) : []
      const rows: BoardRow[] = drawn.map((p) => {
        const s = info.get(p.key)!.sums
        return { key: p.key, market: p.market, continent: p.continent, netUsd: s.netUsd, grossUsd: s.grossUsd, movePct: s.movePct, count: s.count }
      })
      const board = leaderboard(rows, 5, boardByFor(ln))
      // The fills per second, over the last ten whole seconds.
      const c = secCounts.current
      let n = 0
      for (let i = 0; i < 16; i++) if (c.sec[i] < nowSec && c.sec[i] >= nowSec - 10) n += c.n[i]
      const continents = CONTINENTS.map((def) => {
        let gross = 0
        let net = 0
        let count = 0
        for (const p of info.values()) {
          if (p.continent !== def.id || p.sums.count === 0) continue
          gross += p.sums.grossUsd
          net += p.sums.netUsd
          count++
        }
        return { id: def.id, gross, net, count }
      }).filter((x) => x.count > 0 || layout?.continents.some((lc) => lc.id === x.id))
      const pickRows = pickMarkets
        .map((m) => {
          const key = plotKeyFor(m, layout, info)
          return key ? { key, market: info.get(key)!.market, sums: info.get(key)!.sums } : null
        })
        .filter((r): r is { key: string; market: string; sums: PlotSums } => r !== null)
      if (!pausedRef.current || force) {
        const sc = sceneRef.current
        if (sc && layout) {
          const heights = new Map<string, number>()
          const colors = new Map<string, number>()
          for (const p of drawn) {
            const s = info.get(p.key)!.sums
            heights.set(p.key, heightFor(ln, s, win))
            colors.set(p.key, moveT(s.movePct, win))
          }
          sc.setHeights(heights)
          sc.setColors(colors)
          // Labels: the top forty by area, the board, the pick, the hovered and the pinned.
          const totalArea = drawn.reduce((a, p) => a + p.rect.w * p.rect.d, 0) || 1
          const byArea = [...drawn].sort((a, b) => b.rect.w * b.rect.d - a.rect.w * a.rect.d)
          const onBoard = new Set([...board.risers, ...board.sinkers].map((r) => r.key))
          const pickKeys = new Set(pickRows.map((r) => r.key))
          const labels: SceneLabel[] = []
          byArea.forEach((p, i) => {
            const share = (p.rect.w * p.rect.d) / totalArea
            const flags = { board: onBoard.has(p.key), pick: pickKeys.has(p.key), hovered: p.key === hov, pinned: p.key === pin }
            if (labelTier(share, i + 1, flags) !== 'always') return
            const s = info.get(p.key)!.sums
            const sub = ln === 'flow' ? (s.count ? fmtNet(s.netUsd) : null) : ln === 'activity' ? (s.count ? fmtUsd3(s.grossUsd) : null) : s.movePct !== null ? fmtPctAscii(s.movePct) : null
            const sign = ln === 'move' ? (s.movePct ?? 0) : s.netUsd
            labels.push({
              key: p.key,
              title: plotName(p.market),
              sub,
              tone: sign > 0 ? 'up' : sign < 0 ? 'down' : 'flat',
              priority: (flags.board ? 600 : 0) + (flags.pick ? 400 : 0) + share * 1000,
              forced: flags.pinned || flags.hovered,
            })
          })
          sc.setLabels(labels)
          sc.setContinentLabels(
            continents.map((x) => {
              const def = continentDef(x.id)
              return { id: x.id, title: def.label, sub: `${fmtUsd3(x.gross)}/${win} · net ${fmtNet(x.net)} · ${x.count} mkt${x.count === 1 ? '' : 's'}` }
            }),
          )
          sc.setFlags([...board.risers.slice(0, 3).map((r) => ({ key: r.key, dir: 1 as const })), ...board.sinkers.slice(0, 3).map((r) => ({ key: r.key, dir: -1 as const }))])
          sc.setPick(pickRows.map((r) => r.key))
        }
        setHud({ markets: info.size, drawn: drawn.length, fillsPerSec: Math.round(n / 10), board, continents, pickRows, firstPrint: info.size > 0 })
      }
      // For the drive and for anyone debugging: what the world holds right now.
      const st = sceneRef.current?.stats()
      if (st && mainRef.current) {
        mainRef.current.dataset.plots = String(st.plots)
        mainRef.current.dataset.drops = String(st.drops)
        mainRef.current.dataset.labels = String(st.labels)
        mainRef.current.dataset.frames = String(st.frames)
        mainRef.current.dataset.camera = st.camera
        // The main-thread budget: this second's hand and the slowest live batch since the last.
        mainRef.current.dataset.tickMs = (performance.now() - tickStart).toFixed(2)
        mainRef.current.dataset.batchMs = batchMsRef.current.toFixed(2)
        batchMsRef.current = 0
      }
      // The first pick market is the default pinned readout, once, when it has a plot.
      // Six seconds in, so every venue's backfill has landed and the pick's home plot is drawn.
      if (!userPinnedRef.current && pickReady && !pin && pickRows.length && layout && t - openedRef.current >= 6_000) {
        userPinnedRef.current = true
        setPinned(pickRows[0].key)
        sceneRef.current?.setPinned(pickRows[0].key)
      }
    }
    stepRef.current = step
    step()
    const id = setInterval(step, 1000)
    return () => {
      clearInterval(id)
      stepRef.current = null
    }
  }, [])

  // A lens or window change shows at once (even on a held land), not on the next second.
  useEffect(() => {
    stepRef.current?.(true)
  }, [w, lens])

  // The stage seat's reports to the deck: the feed for its foot, and the market
  // its ladder follows (the top riser on HyperCore — the book the ladder reads).
  const onReportRef = useRef(onReport)
  onReportRef.current = onReport
  const onBookMarketRef = useRef(onBookMarket)
  onBookMarketRef.current = onBookMarket
  const hiddenNow = vis ? !vis.visible : false
  useEffect(() => {
    onReportRef.current?.({ status, detail, source, markets: hud.markets, hidden: hiddenNow })
  }, [status, detail, source, hud.markets, hiddenNow])
  const bookLead = hud.board.risers.find((r) => r.continent === 'hypercore' || r.continent === 'hypercore-xyz')?.market ?? null
  useEffect(() => {
    onBookMarketRef.current?.(bookLead)
  }, [bookLead])

  // ── The act door ───────────────────────────────────────────────────────
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })
  const chipsFor = useCallback(
    (key: string): FollowAsk[] => {
      const p = infoRef.current.get(key)
      if (!p) return []
      return plotAsks(p.market, p.sums, { venue: p.venue, chainId: p.chainId }).filter((a) => canTradeAsk(a.ask, tradable))
    },
    [tradable],
  )
  const skyChip = useCallback(
    (r: SkyRow): FollowAsk | null => {
      const f = followAsk({ market: r.market, side: r.side, venue: r.venue, chainId: r.chainId }, FOLLOW_USD)
      return f && canTradeAsk(f.ask, tradable) ? f : null
    },
    [tradable],
  )

  // ── Hover, pin, fly ────────────────────────────────────────────────────
  const pinKey = useCallback((key: string | null, by: 'hand' | 'auto' = 'hand') => {
    if (by === 'hand') userPinnedRef.current = true
    setPinned(key)
    sceneRef.current?.setPinned(key)
  }, [])
  const flyTo = useCallback(
    (key: string) => {
      sceneRef.current?.flyTo(key)
      setTouring(false)
      setHint(false)
      pinKey(key)
    },
    [pinKey],
  )
  const hoverKey = useCallback((key: string | null) => {
    setHover((prev) => (prev === key ? prev : key))
    sceneRef.current?.setHover(key)
  }, [])

  const placeHoverCard = useCallback(() => {
    const card = hoverCardRef.current
    const stage = stageRef.current
    if (!card || !stage) return
    const r = stage.getBoundingClientRect()
    const { x, y } = pointerRef.current
    const cw = card.offsetWidth || 260
    const ch = card.offsetHeight || 120
    let left = x - r.left + 16
    let top = y - r.top + 16
    if (left + cw > r.width - 8) left = x - r.left - cw - 16
    if (top + ch > r.height - 8) top = y - r.top - ch - 16
    card.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pointerRef.current
      p.x = e.clientX
      p.y = e.clientY
      if (e.pointerType !== 'mouse') return
      if (p.pending) return
      p.pending = true
      requestAnimationFrame(() => {
        p.pending = false
        const key = sceneRef.current?.pick(p.x, p.y) ?? null
        hoverKey(key)
        placeHoverCard()
      })
    },
    [hoverKey, placeHoverCard],
  )
  const onPointerLeave = useCallback(() => hoverKey(null), [hoverKey])
  // The hover card mounts after the hover lands: place it as it appears.
  useEffect(() => {
    if (hover) placeHoverCard()
  }, [hover, placeHoverCard])
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerRef.current.down = { x: e.clientX, y: e.clientY, t: performance.now() }
    setHint(false)
  }, [])
  // A click on a plot we chart opens its asset page; a plot we don't chart
  // pins its readout. The open waits one double-click's length so a
  // double-click still flies there; cmd/ctrl-click opens a new tab.
  const router = useRouter()
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelOpen = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])
  useEffect(() => cancelOpen, [cancelOpen])
  const hrefFor = useCallback((key: string | null) => {
    const p = key ? infoRef.current.get(key) : null
    return p ? plotChartHref(p.market, p.venue) : null
  }, [])
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = pointerRef.current.down
      pointerRef.current.down = null
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return
      const key = sceneRef.current?.pick(e.clientX, e.clientY) ?? null
      pinKey(key)
      cancelOpen()
      const href = hrefFor(key)
      if (!href || e.button !== 0) return
      if (e.metaKey || e.ctrlKey) {
        window.open(href, '_blank', 'noopener')
        return
      }
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null
        router.push(href)
      }, OPEN_DELAY_MS)
    },
    [pinKey, cancelOpen, hrefFor, router],
  )
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      cancelOpen()
      const key = sceneRef.current?.pick(e.clientX, e.clientY) ?? null
      if (key) flyTo(key)
    },
    [flyTo, cancelOpen],
  )
  // Warm the page a hovered plot would open, so the click lands fast.
  const hoverHref = hrefFor(hover)
  useEffect(() => {
    if (hoverHref) router.prefetch(hoverHref)
  }, [hoverHref, router])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const sc = sceneRef.current
      if (!sc || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const pan: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }
      if (pan[k]) {
        sc.nudge(pan[k][0], pan[k][1])
      } else if (k === 'q') sc.climb(-1)
      else if (k === 'e') sc.climb(1)
      else if (k === 'f') sc.fitAll()
      else if (k === 't') {
        const on = !sc.touring()
        sc.tour(on)
        setTouring(on && !reducedRef.current)
      } else if (k === 'escape') pinKey(null)
      else return
      e.preventDefault()
      setHint(false)
    },
    [pinKey],
  )

  // ── Fullscreen ─────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = useCallback(() => {
    const el = mainRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
      return
    }
    if (fakeFull) {
      setFakeFull(false)
      return
    }
    if (typeof el.requestFullscreen !== 'function') {
      setFakeFull(true)
      return
    }
    el.requestFullscreen().catch(() => setFakeFull(true))
  }, [fakeFull])
  useEffect(() => {
    if (!fakeFull) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setFakeFull(false)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [fakeFull])
  const isFull = full || fakeFull

  const togglePause = useCallback(() => {
    setPaused((p) => {
      pausedRef.current = !p
      return !p
    })
  }, [])
  const toggleTour = useCallback(() => {
    const sc = sceneRef.current
    if (!sc) return
    const on = !sc.touring()
    sc.tour(on)
    setTouring(on && !reducedRef.current)
  }, [])

  const toggleVenue = useCallback((id: DuneVenueId) => {
    setVenues((cur) => {
      const on = cur.includes(id)
      if (on && cur.length === 1) return cur // one venue at least
      const next = on ? cur.filter((v) => v !== id) : DUNE_VENUES.map((v) => v.id).filter((v) => v === id || cur.includes(v))
      // A venue switched off leaves the land at once.
      if (on) {
        const ledger = ledgerRef.current
        for (const [key, p] of ledger.plots) if (continentDef(p.continent).duneVenue === id) ledger.plots.delete(key)
        censusRef.current = null
      }
      return next
    })
  }, [])

  const flyToQuery = useCallback(
    (raw: string) => {
      const key = findPlot(raw, layoutRef.current, infoRef.current)
      if (key) {
        flyTo(key)
        setFlyNote(null)
        setQuery('')
        return
      }
      const t = raw.trim()
      const printing = [...infoRef.current.values()].some((p) => p.market.toLowerCase() === t.toLowerCase() || plotName(p.market).toLowerCase() === t.toLowerCase())
      setFlyNote(printing ? `${t.toUpperCase()} is printing, but too small to hold land right now` : `nothing called ${t.toUpperCase()} has printed here in 15 minutes`)
    },
    [flyTo],
  )
  useEffect(() => {
    if (!flyNote) return
    const id = setTimeout(() => setFlyNote(null), 6000)
    return () => clearTimeout(id)
  }, [flyNote])

  const addPick = useCallback(
    (market: string) => {
      const known = knownMarkets(pick.universe, new Set([...infoRef.current.values()].map((p) => p.market)))
      const r = addToPick(market, known, pick.markets)
      if (r.added.length) pick.set([...pick.markets, ...r.added], 'hand')
    },
    [pick],
  )

  // ── What the HUD reads ─────────────────────────────────────────────────
  const viewDef = LIVE_VIEWS.find((v) => v.id === 'flyover')!
  const live = status === 'live'
  const sourceWord = source === 'dune' ? 'Dune' : 'Hyperliquid'
  const statusLine = !mounted
    ? `${sourceWord} · connecting`
    : status === 'live'
      ? `${sourceWord} · live · ${hud.markets} market${hud.markets === 1 ? '' : 's'}${hud.drawn && hud.drawn < hud.markets ? ` (${hud.drawn} drawn)` : ''} · ${hud.fillsPerSec} fills/s · ${w}`
      : status === 'reconnecting'
        ? `${sourceWord} · reconnecting${detail ? ` ${detail}` : ''}`
        : status === 'closed'
          ? `${sourceWord} · ${streamOn ? 'closed' : 'paused while the tab is hidden'}${detail && streamOn ? ` · ${detail}` : ''}`
          : `${sourceWord} · connecting`
  const fallbackLine = source === 'hyperliquid' ? `Hyperliquid · venue socket · relay has no key${relayNote ? ` (${relayNote})` : ''}` : null
  const heads = boardHeads(lens)
  const pinnedInfo = pinned ? infoRef.current.get(pinned) ?? null : null
  const hoverInfo = hover && hover !== pinned ? infoRef.current.get(hover) ?? null : null
  const legend = useMemo(() => LEGEND_LINES(w, lens, source), [w, lens, source])
  const metric = (r: BoardRow) => (lens === 'flow' ? fmtNet(r.netUsd) : lens === 'activity' ? fmtUsd3(r.grossUsd) : fmtPctAscii(r.movePct))
  const second = (r: BoardRow) => (lens === 'move' ? fmtNet(r.netUsd) : fmtPctAscii(r.movePct))

  const card = (p: PlotInfo, mode: 'hover' | 'pinned') => {
    const lines = readoutLines({ market: p.market, continent: p.continent }, p.sums, w, now, { dayVolumeUsd: p.day, sessionUsd: p.session })
    const chips = mode === 'pinned' ? chipsFor(p.key) : []
    const href = plotChartHref(p.market, p.venue)
    const inPick = pick.markets.some((m) => m.toLowerCase() === p.market.toLowerCase())
    return (
      <>
        <header className="flyover__cardh">
          <span className="flyover__cardn">{plotName(p.market)}</span>
          <span className="flyover__cardv mono">{continentDef(p.continent).label}</span>
          {mode === 'pinned' && (
            <button type="button" className="flyover__x" onClick={() => pinKey(null)} aria-label="Close the readout" title="Close (Esc)" data-journey="Close the Flyover readout">
              <X size={13} strokeWidth={2.2} />
            </button>
          )}
        </header>
        <ul className="flyover__lines mono">
          {lines.slice(1).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {mode === 'hover' ? (
          <p className="flyover__cardfoot mono">{href ? 'click to open the chart' : 'click to pin'} · double-click to fly there</p>
        ) : (
          <>
            {chips.length > 0 ? (
              <div className="flyover__chips">
                {chips.map((c) => (
                  <button key={c.ask} type="button" className={`flyover__chip flyover__chip--${c.tone}`} onClick={() => act(c.ask)} title={c.ask} data-journey={`Flyover ${c.label}`}>
                    {c.label} <span className="flyover__chipusd">${FOLLOW_USD}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="flyover__cardfoot mono">no route here: nothing this chat can sign for {plotName(p.market)} on {continentDef(p.continent).label}</p>
            )}
            <div className="flyover__cardlinks">
              {href && (
                <Link href={href} prefetch={false} className="flyover__link" data-journey={`Flyover chart ${plotName(p.market)}`}>
                  Open the chart →
                </Link>
              )}
              {!inPick && pick.markets.length < MAX_PICK && (
                <button type="button" className="flyover__link" onClick={() => addPick(p.market)} data-journey={`Flyover add ${plotName(p.market)} to pick`}>
                  + Add to pick
                </button>
              )}
              <button type="button" className="flyover__link" onClick={() => sceneRef.current?.flyTo(p.key)} data-journey={`Flyover fly to ${plotName(p.market)}`}>
                Fly there
              </button>
            </div>
          </>
        )}
      </>
    )
  }

  const boardCol = (title: string, rows: BoardRow[], dir: 'up' | 'down') => (
    <div className={`flyover__col flyover__col--${dir}`}>
      <h3 className="flyover__colh mono">{title}</h3>
      <ol>
        {rows.length === 0 && <li className="flyover__dim mono">nothing yet</li>}
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              className={`flyover__row${pinned === r.key ? ' is-on' : ''}`}
              onMouseEnter={() => hoverKey(r.key)}
              onMouseLeave={() => hoverKey(null)}
              onFocus={() => hoverKey(r.key)}
              onBlur={() => hoverKey(null)}
              onClick={() => flyTo(r.key)}
              data-journey={`Flyover board ${plotName(r.market)}`}
              title={`${plotName(r.market)} on ${continentDef(r.continent).label}: fly there and pin it`}
            >
              <span className="flyover__rown">
                {plotName(r.market)}
                <span className="flyover__rowc mono">{continentDef(r.continent).label}</span>
              </span>
              <span className={`flyover__rowv mono ${dir}`}>{metric(r)}</span>
              <span className="flyover__rows mono">{second(r)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )

  const waiting = !hud.firstPrint
  // The page seat is /live's main column; the stage seat is a plain block in the deck.
  const Shell = (onPage ? 'main' : 'div') as 'main'
  return (
    <>
      <Shell ref={mainRef} className={`${onPage ? 'mkt-frame__main ' : ''}flyover${onPage ? '' : ' flyover--stage'}${fakeFull ? ' flyover--full' : ''}`} data-status={status} data-paused={paused || undefined} data-lens={lens} data-scene={sceneState} data-seat={seat}>
        {onPage && <h1 className="sr-only">{viewDef.label}</h1>}
        <span ref={fontProbeRef} className="mono flyover__fontprobe" aria-hidden>
          0
        </span>

        <div className={`${onPage ? 'mkt-frame__bar ' : ''}flyover__bar`}>
          {onPage && (
          <div className="flyover__title">
            <span className={`mk-dot ${live ? 'mk-dot--open' : 'mk-dot--closed'} flyover__pulse`} aria-hidden />
            <span className="flyover__h">{viewDef.label}</span>
            <span className="flyover__sub mono">{viewDef.blurb}</span>
          </div>
          )}
          {tabs}
          <div className="flyover__controls">
            <button type="button" className="flyover__btn" onClick={togglePause} aria-pressed={paused} title={paused ? 'Resume the land' : 'Hold the land (the ledger keeps filling)'} data-journey={`${paused ? 'Resume' : 'Hold'} the Flyover`}>
              {paused ? <Play size={13} strokeWidth={2.2} /> : <Pause size={13} strokeWidth={2.2} />}
              <span>{paused ? 'Resume' : 'Hold'}</span>
            </button>
            <button type="button" className="flyover__btn" onClick={toggleTour} aria-pressed={touring} disabled={sceneState !== 'ready'} title={touring ? 'Stop the tour (T)' : 'Tour: a slow orbit (T)'} data-journey={`${touring ? 'Stop' : 'Start'} the Flyover tour`}>
              <Plane size={13} strokeWidth={2.2} />
              <span>Tour</span>
            </button>
            <button type="button" className="flyover__btn" onClick={() => sceneRef.current?.fitAll()} disabled={sceneState !== 'ready'} title="Fit every continent (F)" data-journey="Fit the Flyover">
              <Crosshair size={13} strokeWidth={2.2} />
              <span>Fit</span>
            </button>
            <button type="button" className="flyover__btn" onClick={toggleFull} title={isFull ? 'Leave fullscreen' : 'Fullscreen'} data-journey={`${isFull ? 'Leave' : 'Open'} Flyover fullscreen`}>
              {isFull ? <Minimize2 size={13} strokeWidth={2.2} /> : <Maximize2 size={13} strokeWidth={2.2} />}
              <span>{isFull ? 'Exit' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>

        <div className="flyover__strip" role="toolbar" aria-label="Flyover controls">
          <div className="flyover__seg" role="group" aria-label="Window">
            {FLYOVER_WINDOWS.map((x) => (
              <button key={x} type="button" className={w === x ? 'is-on' : undefined} aria-pressed={w === x} onClick={() => setW(x)} title={`Height and color over the last ${x}`} data-journey={`Flyover window ${x}`}>
                {x}
              </button>
            ))}
          </div>
          <div className="flyover__seg" role="group" aria-label="Lens: what height means">
            {LENSES.map((l) => (
              <button key={l} type="button" className={lens === l ? 'is-on' : undefined} aria-pressed={lens === l} onClick={() => setLens(l)} title={`${LENS_LABEL[l]}: ${LENS_HINT[l]}`} data-journey={`Flyover lens ${l}`}>
                {LENS_LABEL[l]}
              </button>
            ))}
          </div>
          {source === 'dune' && (
            <div className="flyover__venues" role="group" aria-label="Venues">
              {DUNE_VENUES.map((v) => (
                <button key={v.id} type="button" className={`flyover__venue${venues.includes(v.id) ? ' is-on' : ''}`} aria-pressed={venues.includes(v.id)} onClick={() => toggleVenue(v.id)} title={v.label} data-journey={`Flyover venue ${v.id}`}>
                  {VENUE_SHORT[v.id]}
                </button>
              ))}
            </div>
          )}
          <form
            className="flyover__fly"
            onSubmit={(e) => {
              e.preventDefault()
              if (query.trim()) flyToQuery(query)
            }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="fly to … BTC, xyz:NVDA, ETH" aria-label="Fly to a market" autoComplete="off" spellCheck={false} />
            <button type="submit" className="flyover__flybtn" disabled={!query.trim()} data-journey="Flyover fly to a market">
              Fly
            </button>
          </form>
          {flyNote && (
            <span className="flyover__note mono" role="status">
              {flyNote}
            </span>
          )}
        </div>

        <section className="flyover__theater" aria-label="The Flyover: every market as land">
          <div
            className="flyover__stage"
            data-plot-link={hoverHref ? '' : undefined}
            ref={stageRef}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDown}
            onWheel={() => setHint(false)}
            aria-label="The world. Drag to orbit, scroll to zoom, click a plot to open its chart. Keys: WASD or arrows to fly, Q and E to descend and climb, F to fit, T to tour, Esc to unpin."
          >
            <canvas ref={canvasRef} className="flyover__canvas" role="img" aria-label={`${viewDef.label}: ${viewDef.blurb}`} />
            <div className="flyover__status mono" data-live={live || undefined}>
              <span className="flyover__statusdot" aria-hidden />
              <span>{fallbackLine ?? statusLine}</span>
              {paused && <span className="flyover__held">held</span>}
            </div>
            {(waiting || sceneState !== 'ready') && (
              <div className="flyover__empty mono" role="status">
                {sceneState === 'no-webgl'
                  ? 'This view needs WebGL. The leaderboard below still reads the live ledger.'
                  : sceneState === 'loading' && !waiting
                    ? 'Raising the land…'
                    : status === 'unconfigured' || (source === 'hyperliquid' && !hlMarkets)
                      ? 'Reaching the venue…'
                      : 'Waiting for the first print…'}
              </div>
            )}
            {hoverInfo && sceneState === 'ready' && (
              <div className="flyover__card flyover__card--hover" ref={hoverCardRef} role="tooltip">
                {card(hoverInfo, 'hover')}
              </div>
            )}
            {hint && (
              <div className="flyover__hint mono" role="note">
                drag to orbit · scroll to zoom · click a plot to open it · F fits · T tours
              </div>
            )}
          </div>

          <div className="flyover__hud" ref={hudRef}>
            <div className="flyover__side" ref={sideRef}>
              <aside className="flyover__board" aria-label="Leaderboard">
                {boardCol(heads.risers, hud.board.risers, 'up')}
                {boardCol(heads.sinkers, hud.board.sinkers, 'down')}
              </aside>
              {pinnedInfo && (
                <div className="flyover__card flyover__card--pinned" role="dialog" aria-label={`${plotName(pinnedInfo.market)} readout`}>
                  {card(pinnedInfo, 'pinned')}
                </div>
              )}
            </div>
            <div className="flyover__sky" aria-label="Big prints" ref={skyRef}>
              <h3 className="flyover__colh mono">Meteors · prints of $50K or more</h3>
              <ol aria-live="polite">
                {sky.length === 0 && <li className="flyover__dim mono">none yet</li>}
                {sky.map((r) => {
                  const chip = skyChip(r)
                  const key = plotKey(continentOf(r.venue, r.chainId, r.market) ?? 'hypercore', r.market)
                  return (
                    <li key={r.id} className={`flyover__skyrow flyover__skyrow--${r.side}`}>
                      <button type="button" className="flyover__skyt mono" onClick={() => layoutRef.current?.plots.some((p) => p.key === key) && flyTo(key)} data-journey="Flyover sky row" title="Fly there">
                        {skyLine(r, now)}
                      </button>
                      {chip && (
                        <button type="button" className={`flyover__chip flyover__chip--${chip.tone}`} onClick={() => act(chip.ask)} title={chip.ask} data-journey={`Flyover sky ${chip.label}`}>
                          {chip.label} <span className="flyover__chipusd">${FOLLOW_USD}</span>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        </section>

        <section className="flyover__legend" aria-label="How to read the land">
          <div className="flyover__ramp" aria-hidden>
            <span className="mono">{fmtPctAscii(-MOVE_CLAMP_PCT[w])}</span>
            <span className="flyover__rampbar" />
            <span className="mono">{fmtPctAscii(MOVE_CLAMP_PCT[w])}</span>
          </div>
          <ul className="mono">
            {legend.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      </Shell>

      {onPage && (
      <MarketsSide label="Continents">
        <div data-slot="flyover-rail" className="flyover__rail">
          <header className="flyover__rh">
            <span className="flyover__rk">Continents</span>
            <span className="flyover__rv mono">last {w}</span>
          </header>
          <p className="flyover__note2">One continent per venue. Fly to one; the plots on it are its markets.</p>
          <ol className="flyover__conts">
            {hud.continents.length === 0 && <li className="flyover__dim mono">{waiting ? 'waiting for the first print…' : 'no venue on'}</li>}
            {hud.continents.map((c) => (
              <li key={c.id}>
                <button type="button" className="flyover__cont" onClick={() => sceneRef.current?.flyToContinent(c.id)} disabled={sceneState !== 'ready'} data-journey={`Flyover continent ${c.id}`}>
                  <span className="flyover__contn">{continentDef(c.id).label}</span>
                  <span className="flyover__contb mono">{continentDef(c.id).blurb}</span>
                  <span className="flyover__contv mono">
                    {fmtUsd3(c.gross)} · <span className={c.net > 0 ? 'up' : c.net < 0 ? 'down' : ''}>net {fmtNet(c.net)}</span> · {c.count} markets
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <header className="flyover__rh">
            <span className="flyover__rk">Your pick</span>
            <span className="flyover__rv mono">beacons on the land</span>
          </header>
          <ol className="flyover__conts">
            {hud.pickRows.length === 0 && <li className="flyover__dim mono">{pick.markets.length ? 'none of your markets is printing here yet' : 'add a market from a readout'}</li>}
            {hud.pickRows.map((r) => (
              <li key={r.key}>
                <button type="button" className="flyover__cont" onClick={() => flyTo(r.key)} disabled={sceneState !== 'ready'} data-journey={`Flyover pick ${plotName(r.market)}`}>
                  <span className="flyover__contn">{plotName(r.market)}</span>
                  <span className="flyover__contv mono">
                    <span className={r.sums.netUsd > 0 ? 'up' : r.sums.netUsd < 0 ? 'down' : ''}>net {fmtNet(r.sums.netUsd)}</span> · {fmtPctAscii(r.sums.movePct)} · {r.sums.count} {r.sums.count === 1 ? 'fill' : 'fills'}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="flyover__note2">Every plot is a sentence your wallet can sign. Nothing here fires on its own.</p>
        </div>
      </MarketsSide>
      )}
      {door}
    </>
  )
}

/** A pick market's plot: its HyperCore spelling first, then any continent printing it, biggest first. */
function plotKeyFor(market: string, layout: WorldLayout | null, info: ReadonlyMap<string, PlotInfo>): string | null {
  if (!layout) return null
  const drawn = new Set(layout.plots.map((p) => p.key))
  const home = continentOf('hyperliquid', null, market)
  const k = home ? plotKey(home, market) : null
  if (k && drawn.has(k)) return k
  let best: PlotInfo | null = null
  for (const p of info.values()) {
    if (!drawn.has(p.key) || p.market.toLowerCase() !== market.toLowerCase()) continue
    if (!best || p.size > best.size) best = p
  }
  return best?.key ?? null
}

/** `btc` → BTC on HyperCore (the biggest plot of that name); `nvda` → xyz:NVDA; `eth` → WETH on a chain too. */
function findPlot(raw: string, layout: WorldLayout | null, info: ReadonlyMap<string, PlotInfo>): string | null {
  const t = raw.trim().toLowerCase()
  if (!t || !layout) return null
  const drawn = layout.plots.map((p) => info.get(p.key)).filter((p): p is PlotInfo => !!p)
  const best = (list: PlotInfo[]) => (list.length ? list.reduce((a, b) => (b.size > a.size ? b : a)).key : null)
  return (
    best(drawn.filter((p) => p.market.toLowerCase() === t)) ??
    best(drawn.filter((p) => plotName(p.market).toLowerCase() === t)) ??
    best(drawn.filter((p) => p.venue === 'dex' && dexAskTicker(p.market).toLowerCase() === t)) ??
    best(drawn.filter((p) => plotName(p.market).toLowerCase().startsWith(t)))
  )
}

