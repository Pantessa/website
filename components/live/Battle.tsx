'use client'

// The battle views on /live (2026-10-06): the live tape as a war for ground,
// drawn three ways (lib/battle for the rules, battle-draw.ts for the
// projections, lib/battle-feed + lib/tape-feed for the venue). This file is
// the shared body: the picker (one to five armies from the top gainers or
// the biggest, or your own), the anchor, a canvas redrawn every frame from
// refs the feeds write into (no React render per fill), a scoreboard
// refreshed once a second, and a war log in the rail. Every act goes
// through the connect-to-act door into the ask door's sheet, so the field
// keeps running behind the ticket.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import type { TradabilityMap } from '@/lib/tradability'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useSession } from '@/lib/session'
import {
  ARMY_SLOTS,
  DEFAULT_PICK,
  FRONT_WINDOWS,
  LIVE_VIEWS,
  MAX_ARMIES,
  PICK_MODES,
  armyLabel,
  dayChangePct,
  fmtFunding,
  fmtPct,
  liveUrl,
  mergeSamples,
  oiUsd,
  parseFrontWindow,
  resolveMarket,
  parsePickMode,
  pickList,
  pushSample,
  rankArmies,
  windowMinutes,
  type ArmyContext,
  type BattleView,
  type FrontWindow,
  type PctRange,
  type PickMode,
  type PricePoint,
} from '@/lib/battle'
import { midsFeed, readArmyContexts, readFrontCandles } from '@/lib/battle-feed'
import { FOLLOW_USD, fmtClock, fmtPrice, fmtUsd, followAsk, mergeFills, type FollowAsk, type TapeFill, type TapeSide, type TapeSource } from '@/lib/tape'
import { connectTape, type FeedStatus } from '@/lib/tape-feed'
import { PERP_VENUES } from '@/lib/dune'
import { useMarketPick } from '@/lib/use-market-pick'
import { deckBattleSearch } from '@/lib/deck'
import { MAX_PICK, armiesOf, armySliceNote, pickSourceWord } from '@/lib/market-pick'
import PickSheet from '@/components/live/PickSheet'
import ArmAlert from '@/components/live/ArmAlert'
import { buildScene, drawFront, drawMap, drawSiege, type ArmyFrame, type Inks, type Particle } from './battle-draw'

const MAX_PARTICLES = 400
const LOG_ROWS = 40
const KEEP_MS = 25 * 3600_000

interface WarEvent {
  id: string
  at: number
  market: string
  kind: 'burst' | 'lead'
  text: string
  side: TapeSide
  follow: FollowAsk | null
}

export interface BattleProps {
  view: BattleView
  tradable: TradabilityMap
  tabs?: ReactNode
  /** Where the field sits: its own page on /live (the default — the URL carries
   *  the armies and the window, the war log rides the rail) or THE DECK's
   *  stage on `/` (components/home/Deck, 2026-10-13: no title, no URL, no
   *  rail, a shorter field; the deck hears the feed's state, the buffer and
   *  the leader). The hand-set memory is shared: the deck is another map. */
  seat?: 'page' | 'stage'
  onReport?: (r: { status: FeedStatus; detail?: string; source: TapeSource; markets: number; hidden: boolean }) => void
  /** The merged buffer after every batch (newest first) — the deck's ladder lands the prints. */
  onFills?: (buffer: readonly TapeFill[]) => void
  /** The army holding the most ground, as it changes. */
  onLeader?: (market: string | null) => void
  /** The home deck's stage keeps this view's window and pick mode in `/`'s
   *  address (2026-10-20); the deck writes the view and the pick itself. */
  url?: boolean
}

export default function Battle({ view, tradable, tabs, seat = 'page', onReport, onFills, onLeader, url = false }: BattleProps) {
  const onPage = seat === 'page'
  const readsUrl = onPage || url
  // THE ONE PICK (GTM squad 2026-10-13): lane PICK makes `armies` follow it; ARENA's sheet reads it.
  const pick = useMarketPick({ seat })
  // The armies are the pick's first five (lib/market-pick armiesOf): the URL,
  // the memory, the watchlist, the wallet and the venue's gainers are the
  // store's to decide (lib/use-market-pick) — the page seat reads `?t=`, the
  // deck's stage reads none of it (`/?t=` is nobody's).
  const armies = useMemo(() => armiesOf(pick.markets), [pick.markets])
  const universe = pick.universe
  const [since, setSince] = useState<FrontWindow>(() => (readsUrl ? initialWindow() : parseFrontWindow(null)))
  // Which venue list the chips show; a "fill from" press writes the pick by hand.
  const [pickMode, setPickMode] = useState<PickMode>(() => (readsUrl ? initialPick() : 'gainers'))
  const onReportRef = useRef(onReport)
  onReportRef.current = onReport
  const onFillsRef = useRef(onFills)
  onFillsRef.current = onFills
  const onLeaderRef = useRef(onLeader)
  onLeaderRef.current = onLeader
  const tapeSourceRef = useRef<TapeSource>('dune')
  const reportedLeaderRef = useRef<string | null>(null)
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [tick, setTick] = useState(0)
  const [ctxTick, setCtxTick] = useState(0)
  const [log, setLog] = useState<WarEvent[]>([])
  const [draft, setDraft] = useState('')
  const [addNote, setAddNote] = useState<{ text: string; tone: 'warn' | 'dim' } | null>(null)

  const openedAtRef = useRef(Date.now())
  const samplesRef = useRef<Map<string, PricePoint[]>>(new Map())
  const fillsRef = useRef<TapeFill[]>([])
  const particlesRef = useRef<Particle[]>([])
  const ctxRef = useRef<Map<string, ArmyContext>>(new Map())
  const unitRef = useRef(1e4)
  const rangeRef = useRef<PctRange>({ lo: -0.25, hi: 0.25 })
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const inksRef = useRef<Inks | null>(null)
  const seenRef = useRef(new Set<string>())
  const leaderRef = useRef<string | null>(null)
  const framesRef = useRef<ArmyFrame[]>([])
  const reducedRef = useRef(false)

  const mainRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The second hand reads these without re-arming on every render.
  const stateRef = useRef({ view, armies, since })
  stateRef.current = { view, armies, since }

  const inputFor = useCallback(
    (now: number) => ({
      view: stateRef.current.view,
      armies: stateRef.current.armies,
      since: stateRef.current.since,
      now,
      openedAt: openedAtRef.current,
      samples: samplesRef.current,
      fills: fillsRef.current,
      contexts: ctxRef.current,
      particles: particlesRef.current,
      range: rangeRef.current,
      hover: hoverRef.current,
      inks: inksRef.current!,
      reduced: reducedRef.current,
      paused: pausedAtRef.current !== null,
    }),
    [],
  )

  // ── The act door ──────────────────────────────────────────────────────
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })
  const chipFor = useCallback(
    (market: string, side: TapeSide): FollowAsk | null => {
      const f = followAsk({ market, side }, FOLLOW_USD)
      return f && canTradeAsk(f.ask, tradable) ? f : null
    },
    [tradable],
  )

  // ── URL (the page's alone — the deck's stage never rewrites `/`) ─────
  // `?t=` carries the whole pick (lib/use-market-pick mirrors the same
  // value); nothing is written until the pick has painted.
  useEffect(() => {
    if (!onPage || typeof window === 'undefined' || !pick.ready) return
    const url = new URL(liveUrl(view, pick.markets, since, window.location.pathname), window.location.origin)
    if (pickMode !== 'gainers') url.searchParams.set('pick', pickMode)
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }, [onPage, view, pick.markets, pick.ready, since, pickMode])
  // The home deck's stage: only this view's own keys, beside the deck's.
  useEffect(() => {
    if (onPage || !url || typeof window === 'undefined') return
    const next = window.location.pathname + deckBattleSearch(window.location.search, since, pickMode)
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', next)
  }, [onPage, url, since, pickMode])

  // ── The universe (for the add box) is the store's (pick.universe) ─────

  // ── Contexts: mark, OI, funding, 24h (the scoreboard, the chips) ──────
  useEffect(() => {
    const ac = new AbortController()
    const read = () => readArmyContexts(ac.signal).then((m) => {
      if (ac.signal.aborted || !m.size) return
      ctxRef.current = m
      setCtxTick((t) => t + 1)
    })
    read()
    const id = setInterval(read, 30_000)
    return () => {
      ac.abort()
      clearInterval(id)
    }
  }, [])

  // ── The opening pick is the store's (lib/use-market-pick: the URL, the
  // memory, the watchlist, the wallet held ≤4s, the venue's gainers, the
  // fallback trio after 6s). Only a hand writes the memory, and that is the
  // store's too — this file writes none.
  const { signedOut } = useSession()
  // The stage's waiting words are decided after mount: the server knows no
  // URL, no memory and no wallet, and React leaves a mismatched single text
  // child as the server wrote it, so a word computed during hydration would
  // sit stale until the overlay unmounts (found 2026-10-07, hidden pane).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const waitingForWallet = mounted && !pick.ready && !signedOut

  // ── Candles: the ground before the page opened ────────────────────────
  useEffect(() => {
    const ac = new AbortController()
    const minutes = Math.max(windowMinutes(since) ?? 15, 15)
    for (const m of armies) {
      readFrontCandles(m, minutes, ac.signal).then((pts) => {
        if (ac.signal.aborted || !pts.length) return
        const prev = samplesRef.current.get(m) ?? []
        samplesRef.current.set(m, mergeSamples(prev, pts, Date.now() - KEEP_MS))
      })
    }
    return () => ac.abort()
  }, [armies, since])

  // ── Fills: the stream (Dune's perp feeds through the relay for these
  // armies — HyperCore spells a market as the venue does, so an army name
  // is the filter; the venue's keyless socket when the relay has no key) ──
  useEffect(() => {
    if (!armies.length) return
    const handle = connectTape(armies, {
      onSource: (s) => {
        tapeSourceRef.current = s
      },
      onRetract: (venue, block) => {
        fillsRef.current = fillsRef.current.filter((f) => !(f.venue === venue && f.block === block))
      },
      onFills: (batch) => {
        const now = Date.now()
        fillsRef.current = mergeFills(fillsRef.current, batch, now)
        onFillsRef.current?.(fillsRef.current)
        const reduced = reducedRef.current
        for (const f of batch) {
          const arr = samplesRef.current.get(f.market) ?? []
          pushSample(arr, { t: f.at, p: f.price })
          samplesRef.current.set(f.market, arr)
          if (reduced || pausedAtRef.current !== null) continue
          particlesRef.current.push({ market: f.market, side: f.side, usd: f.usd, t0: now, dx: (Math.random() - 0.5) * 60, dy: 50 + Math.random() * 50 })
        }
        if (particlesRef.current.length > MAX_PARTICLES) particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES)
      },
      onStatus: (s, d) => {
        setStatus(s)
        onReportRef.current?.({ status: s, detail: d, source: tapeSourceRef.current, markets: stateRef.current.armies.length, hidden: false })
      },
    }, { venues: PERP_VENUES, filter: true })
    return handle.close
  }, [armies])

  // ── Mids: the front moves between fills ───────────────────────────────
  useEffect(() => {
    if (!armies.length) return
    return midsFeed(armies, (m, p, at) => {
      const arr = samplesRef.current.get(m) ?? []
      pushSample(arr, { t: at, p })
      samplesRef.current.set(m, arr)
    })
  }, [armies])

  // ── Reduced motion ────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const set = () => (reducedRef.current = mq.matches)
    set()
    mq.addEventListener('change', set)
    return () => mq.removeEventListener('change', set)
  }, [])

  // ── Fullscreen ────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = useCallback(() => {
    const el = mainRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  const togglePause = useCallback(() => {
    setPaused((p) => {
      pausedAtRef.current = p ? null : Date.now()
      return !p
    })
  }, [])

  // ── The second hand: HUD refresh, pruning, the war log ────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const floor = now - KEEP_MS
      for (const [m, arr] of samplesRef.current) {
        let i = 0
        while (i < arr.length && arr[i].t < floor) i++
        if (i > 0) samplesRef.current.set(m, arr.slice(i))
      }
      if (fillsRef.current.length && fillsRef.current[fillsRef.current.length - 1].at < now - 180_000) fillsRef.current = mergeFills(fillsRef.current, [], now)
      if (mainRef.current) inksRef.current = readInks(mainRef.current)
      // A hidden tab has no frames: the scene is still built once a second
      // so the scoreboard and the war log keep moving behind the tab.
      if (document.hidden && inksRef.current) {
        const scene = buildScene(inputFor(pausedAtRef.current ?? now))
        unitRef.current = scene.unit
        framesRef.current = scene.frames
      }
      const fresh: WarEvent[] = []
      const frames = framesRef.current
      for (const a of frames) {
        for (const b of a.bursts) {
          if (seenRef.current.has(b.id)) continue
          seenRef.current.add(b.id)
          fresh.push({ id: b.id, at: b.t, market: a.market, kind: 'burst', side: b.side, follow: chipFor(a.market, b.side), text: `${fmtUsd(b.usd)} ${b.side === 'buy' ? 'bought' : 'sold'} on ${armyLabel(a.market)} in one fill at ${fmtPrice(b.price)}.` })
        }
      }
      const ranked = rankArmies(frames, (a) => a.pct)
      const leader = ranked[0] && ranked[0].pct !== null ? ranked[0].army.market : null
      if (leader && leaderRef.current && leader !== leaderRef.current && frames.length > 1) {
        const second = ranked[1]
        fresh.push({ id: `lead:${leader}:${Math.floor(now / 1000)}`, at: now, market: leader, kind: 'lead', side: 'buy', follow: chipFor(leader, 'buy'), text: `${armyLabel(leader)} takes the lead at ${fmtPct(ranked[0].pct)}${second && second.pct !== null ? `, ahead of ${armyLabel(second.army.market)} at ${fmtPct(second.pct)}` : ''}.` })
      }
      if (leader) leaderRef.current = leader
      if (leader !== reportedLeaderRef.current) {
        reportedLeaderRef.current = leader
        onLeaderRef.current?.(leader)
      }
      if (fresh.length) setLog((prev) => [...fresh.sort((x, y) => y.at - x.at), ...prev].slice(0, LOG_ROWS))
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [chipFor, inputFor])

  // ── The canvas ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const main = mainRef.current
    if (!canvas || !stage || !main) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    inksRef.current = readInks(main)
    let raf = 0
    let w = 0
    let h = 0
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = stage.clientWidth
      h = stage.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const ro = new ResizeObserver(size)
    ro.observe(stage)
    size()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || !inksRef.current) return
      const input = inputFor(pausedAtRef.current ?? Date.now())
      const scene = buildScene(input)
      unitRef.current = scene.unit
      framesRef.current = scene.frames
      if (view === 'front') drawFront(ctx, w, h, input, scene)
      else if (view === 'map') drawMap(ctx, w, h, input, scene)
      else drawSiege(ctx, w, h, input, scene)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [view, armies, since, inputFor])

  const onMove = useCallback((e: React.MouseEvent) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])
  const onLeave = useCallback(() => {
    hoverRef.current = null
  }, [])

  // ── Armies: pick, add, remove — every one a hand on THE pick ──────────
  // The field marches the pick's first five; the chips add to (or drop from)
  // the one pick every live surface reads, so a market set here is on the
  // pulse, the tape and the deck too. The last army never drops from here
  // (the field needs one); the pulse's × can clear the row.
  const toggleArmy = useCallback(
    (m: string) => {
      const cur = pick.markets
      if (cur.includes(m)) {
        if (cur.length > 1) pick.remove(m)
        return
      }
      if (cur.length >= MAX_PICK) return
      pick.set([...cur, m], 'hand')
    },
    [pick],
  )
  // Your own armies: several at once (commas or spaces), each resolved to
  // the venue's spelling; a name the venue lists no market for is said so.
  const addOwn = useCallback(
    (raw: string) => {
      const r = pick.add(raw)
      if (r.unknown.length) setAddNote({ text: `Hyperliquid lists no market called ${r.unknown.map((u) => u.toUpperCase()).join(', ')}`, tone: 'warn' })
      else if (r.full.length) setAddNote({ text: `your pick holds ${MAX_PICK} — drop one to add ${r.full.map(armyLabel).join(', ')}`, tone: 'dim' })
      else setAddNote(null)
      setDraft(r.unknown.join(', '))
    },
    [pick],
  )
  useEffect(() => {
    if (!addNote) return
    const id = setTimeout(() => setAddNote(null), 6000)
    return () => clearTimeout(id)
  }, [addNote])
  // "Fill from": the venue's top three of that list become your pick, by hand.
  const pickTop = useCallback(
    (mode: PickMode) => {
      setPickMode(mode)
      const top = pickList(ctxRef.current, mode).slice(0, DEFAULT_PICK).map((r) => r.market)
      if (top.length) pick.set(top, 'hand')
    },
    [pick],
  )

  // ── The scoreboard reads the last frame ───────────────────────────────
  const frames = framesRef.current
  const ranked = useMemo(() => rankArmies(frames, (a) => a.pct), [frames, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const picks = useMemo(() => pickList(ctxRef.current, pickMode), [pickMode, ctxTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const unit = unitRef.current
  const minutes = windowMinutes(since)
  const viewDef = LIVE_VIEWS.find((v) => v.id === view)!
  const custom = pick.markets.filter((m) => !picks.some((p) => p.market === m))
  const slotOf = (m: string) => ARMY_SLOTS[armies.indexOf(m)] ?? 1
  const sourceWord = pick.ready ? pickSourceWord(pick.source) : null
  const sliceNote = armySliceNote(pick.markets)
  const fieldName = viewDef.label.replace(/^The /, '')
  const pickFull = pick.markets.length >= MAX_PICK

  const sinceEl = (
    <div className="battle__since" role="group" aria-label="Ground is measured since">
      {FRONT_WINDOWS.map((w) => (
        <button key={w.id} type="button" className={since === w.id ? 'is-on' : undefined} aria-pressed={since === w.id} onClick={() => setSince(w.id)} data-journey={`Measure ${fieldName} since ${w.label}`}>
          {w.label}
        </button>
      ))}
    </div>
  )
  const holdEl = (
    <button type="button" className="battle__btn" onClick={togglePause} aria-pressed={paused} title={paused ? 'Resume the field' : 'Hold the field'} data-journey={`${paused ? 'Resume' : 'Hold'} ${fieldName}`}>
      {paused ? <Play size={13} strokeWidth={2.2} /> : <Pause size={13} strokeWidth={2.2} />}
      <span>{paused ? 'Resume' : 'Hold'}</span>
    </button>
  )

  // The field's body, the same on the page and on the deck's stage; the
  // page adds its title bar, its legends and the war log, the stage a
  // one-line bar of the window and the hold.
  const body = (
    <>
        {onPage ? (
          <>
        <h1 className="sr-only">{viewDef.label}</h1>

        <div className="mkt-frame__bar battle__bar">
          <div className="battle__title">
            <span className={`mk-dot ${status === 'live' ? 'mk-dot--open' : 'mk-dot--closed'} battle__pulse`} aria-hidden />
            <span className="battle__h">{viewDef.label}</span>
            <span className="battle__sub mono">{viewDef.blurb}</span>
          </div>
          {tabs}
          <div className="battle__controls">
            {sinceEl}
            {holdEl}
            <button type="button" className="battle__btn" onClick={toggleFull} title={full ? 'Leave fullscreen' : 'Fullscreen'} data-journey={`${full ? 'Leave' : 'Open'} ${fieldName} fullscreen`}>
              {full ? <Minimize2 size={13} strokeWidth={2.2} /> : <Maximize2 size={13} strokeWidth={2.2} />}
              <span>{full ? 'Exit' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>
          </>
        ) : (
          <div className="battle__stagebar">
            <span className="battle__sub mono">{viewDef.blurb}</span>
            <div className="battle__controls">
              {sinceEl}
              {holdEl}
            </div>
          </div>
        )}

        {/* ── The picker: one to five armies ── */}
        <div className="battle__picker" role="group" aria-label="Armies">
          <div className="battle__pickhead">
            <div className="battle__modes" role="group" aria-label="Fill from">
              {PICK_MODES.map((m) => (
                <button key={m.id} type="button" className={pickMode === m.id ? 'is-on' : undefined} aria-pressed={pickMode === m.id} onClick={() => pickTop(m.id)} title={`Fill your pick from ${m.label.toLowerCase()} — ${m.hint}`} data-journey={`Fill ${fieldName} from ${m.id === 'gainers' ? 'top gainers' : 'biggest'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="battle__count mono">
              {armies.length} of {MAX_ARMIES} armies{sourceWord ? ` · ${sourceWord}` : ''}{sliceNote ? ` · ${sliceNote}` : ''} · click to add or drop
            </span>
            <PickSheet pick={pick} seat="battle" />{/* seat: ARENA (GTM squad 2026-10-13) */}
            <ArmAlert seat="strip" market="" markets={pick.markets} />{/* seat: ALERTS "Watch these" — one consent over the pick (GTM squad 2026-10-13) */}
          </div>
          <div className="battle__chips">
            {picks.map((p) => {
              const on = pick.markets.includes(p.market)
              const marching = armies.includes(p.market)
              const fullUp = !on && pickFull
              return (
                <button
                  key={p.market}
                  type="button"
                  className={`battle__pick${on ? ' is-on' : ''}`}
                  style={marching ? ({ ['--army-ink' as string]: `var(--army-${slotOf(p.market)})` } as React.CSSProperties) : undefined}
                  aria-pressed={on}
                  disabled={fullUp}
                  onClick={() => toggleArmy(p.market)}
                  title={fullUp ? `Your pick holds ${MAX_PICK} — drop one first` : on ? (marching ? 'Drop this army' : `In your pick — the first ${MAX_ARMIES} march`) : 'Add this army'}
                  data-journey={`${on ? 'Drop' : 'Add'} ${armyLabel(p.market)} on ${fieldName}`}
                >
                  {marching && <span className="battle__army-dot" aria-hidden />}
                  <span className="battle__pick-n">{armyLabel(p.market)}</span>
                  <span className={`battle__pick-v mono ${pickMode === 'gainers' ? (p.dayPct !== null && p.dayPct >= 0 ? 'up' : 'down') : ''}`}>{pickMode === 'gainers' ? fmtPct(p.dayPct) : fmtUsd(p.oiUsd)}</span>
                </button>
              )
            })}
            {custom.map((m) => (
              <button key={m} type="button" className="battle__pick is-on" style={armies.includes(m) ? ({ ['--army-ink' as string]: `var(--army-${slotOf(m)})` } as React.CSSProperties) : undefined} aria-pressed onClick={() => toggleArmy(m)} title={armies.includes(m) ? 'Drop this army' : `In your pick — the first ${MAX_ARMIES} march`} data-journey={`Drop ${armyLabel(m)} on ${fieldName}`}>
                {armies.includes(m) && <span className="battle__army-dot" aria-hidden />}
                <span className="battle__pick-n">{armyLabel(m)}</span>
                <span className="battle__pick-v mono">yours</span>
              </button>
            ))}
          </div>
          {/* The add box sits after the chips, not in them (PHONE, 2026-10-13: on a phone the armies become one
              scrolling row and the box must never scroll away with them). */}
          <form
              className="battle__add"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault()
                if (draft.trim()) addOwn(draft)
              }}
            >
              <input
                id="battle-add"
                list="battle-universe"
                value={draft}
                onChange={(e) => {
                  const v = e.target.value
                  setDraft(v)
                  // A pick from the suggestion list lands at once; typing waits for Add.
                  const picked = (e.nativeEvent as InputEvent).inputType === 'insertReplacementText'
                  if (picked && resolveMarket(v, universe)) addOwn(v)
                }}
                placeholder={pickFull ? 'your pick is full' : '+ your own · near, pepe, nvda'}
                aria-label="Add your own tokens, several with commas"
                autoComplete="off"
                disabled={pickFull}
              />
              <datalist id="battle-universe">
                {universe.slice(0, 400).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button type="submit" className="battle__addbtn" disabled={pickFull || !draft.trim()} data-journey={`Add markets on ${fieldName}`}>
                Add
              </button>
              {addNote ? (
                <span className={`battle__addnote mono battle__addnote--${addNote.tone}`} role="status">
                  {addNote.text}
                </span>
              ) : (
                <span className="battle__addnote mono battle__addnote--dim">commas add several</span>
              )}
            </form>
        </div>

        <div className="battle__stage" ref={stageRef} onMouseMove={onMove} onMouseLeave={onLeave}>
          <canvas ref={canvasRef} className="battle__canvas" role="img" aria-label={`${viewDef.label}: ${viewDef.blurb}`} />
          {frames.every((a) => a.track.length === 0) && <div className="battle__empty mono">{!mounted || !pick.ready ? (waitingForWallet ? 'reading your wallet…' : 'picking the armies…') : armies.length === 0 ? 'add a market above' : status === 'live' ? 'first prices landing…' : 'reaching the venue…'}</div>}
        </div>
        {onPage && (
        <p className="battle__legend mono">
          <span><b>ground</b> = % move {minutes === null ? 'since the page opened' : `since ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} ago`} · horizon = 0%</span>
          {view === 'map' ? <span><b>land</b> = open interest share</span> : view === 'siege' ? <span><b>sector</b> = one army · time sweeps it from the camp to now · <b>nearer the hill</b> = more ground</span> : <span><b>territory</b> = ground gained or lost</span>}
          <span><b className="up">▲</b> = {fmtUsd(unit)} bought in 60s · <b className="down">▼</b> = {fmtUsd(unit)} sold</span>
          <span><b>burst</b> = a fill ≥ {fmtUsd(unit * 4)}, where it hit</span>
          <span><b>tracers</b> = every fill as it lands</span>
        </p>
        )}

        <section className="battle__board" aria-label="Scoreboard">
          <table className="battle__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Army</th>
                <th className="num">Ground</th>
                <th className="num">Price</th>
                <th>
                  Backers<span className="battle__th-sub"> · 60s</span>
                </th>
                <th className="num">Open interest</th>
                <th className="num">Funding</th>
                <th>Recruit</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ army, pct, rank }) => {
                const c = ctxRef.current.get(army.market)
                const s = army.strength
                const long = chipFor(army.market, 'buy')
                const short = chipFor(army.market, 'sell')
                const day = c ? dayChangePct(c) : null
                return (
                  <tr key={army.market}>
                    <td className="battle__rank mono">{pct === null ? '—' : rank}</td>
                    <td>
                      <span className="battle__name" style={{ ['--army-ink' as string]: `var(--army-${slotOf(army.market)})` } as React.CSSProperties}>
                        <span className="battle__army-dot" aria-hidden />
                        {armyLabel(army.market)}
                      </span>
                      {day !== null && <span className="battle__day mono">24h {fmtPct(day)}</span>}
                    </td>
                    <td className={`num mono battle__pct ${pct === null ? '' : pct >= 0 ? 'up' : 'down'}`}>
                      {fmtPct(pct)}
                      {army.anchor?.partial && <span className="battle__partial" title="The first price we hold sits inside the window; ground is measured from it.">from first</span>}
                    </td>
                    <td className="num mono">{army.last !== null ? fmtPrice(army.last) : <span className="battle__dim">—</span>}</td>
                    <td>
                      <div className="battle__flow mono">
                        <span className="up">{fmtUsd(s.buyUsd)}</span>
                        <div className="battle__flowbar" aria-hidden>
                          <span style={{ width: `${s.buyPct ?? 50}%` }} />
                        </div>
                        <span className="down">{fmtUsd(s.sellUsd)}</span>
                      </div>
                    </td>
                    <td className="num mono">{c ? fmtUsd(oiUsd(c)) : <span className="battle__dim">—</span>}</td>
                    <td className="num mono">{c ? fmtFunding(c.funding) : <span className="battle__dim">—</span>}</td>
                    <td>
                      <div className="battle__recruit">
                        {long && (
                          <button type="button" className="battle__chip battle__chip--buy" onClick={() => act(long.ask)} title={long.ask} data-journey={`Recruit long ${armyLabel(army.market)} on ${fieldName}`}>
                            {long.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                          </button>
                        )}
                        {short && (
                          <button type="button" className="battle__chip battle__chip--sell" onClick={() => act(short.ask)} title={short.ask} data-journey={`Recruit short ${armyLabel(army.market)} on ${fieldName}`}>
                            {short.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                          </button>
                        )}
                        {!long && !short && <span className="battle__dim mono">no route here</span>}
                        <ArmAlert market={army.market} seat="scoreboard" />{/* seat: ALERTS (GTM squad 2026-10-13) */}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={8} className="battle__dim mono" style={{ textAlign: 'center', padding: 18 }}>
                    pick an army above
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        {onPage && (
        <p className="battle__legend mono" style={{ marginTop: 10 }}>
          Percent price move is percent market-cap move over a window this short. Every glyph is a measured fill; nothing on this field is estimated. A recruit chip is the sentence that joins the army at ${FOLLOW_USD}; your wallet signs it.
        </p>
        )}
    </>
  )

  return (
    <>
      {onPage ? (
        <main ref={mainRef} className="mkt-frame__main battle" data-view={view} data-status={status} data-paused={paused || undefined} data-seat="page">
          {body}
        </main>
      ) : (
        <div ref={mainRef as RefObject<HTMLDivElement>} className="battle battle--stage" data-view={view} data-status={status} data-paused={paused || undefined} data-seat="stage">
          {body}
        </div>
      )}

      {onPage && (
      <MarketsSide label="War log">
        <div data-slot="war-log" className="battle__rail">
          <header className="battle__rh">
            <span className="battle__rk">War log</span>
            <span className="battle__rv mono">bursts · lead changes</span>
          </header>
          <p className="battle__note">A burst is a single fill of {fmtUsd(unit * 4)} or more. The lead changes when another army holds more ground. Nothing here fires on its own.</p>
          <ol className="battle__log" aria-live="polite">
            {log.length === 0 && <li className="battle__ev battle__ev--empty mono">Quiet so far.</li>}
            {log.map((e) => (
              <li key={e.id} className="battle__ev" style={{ ['--ev-ink' as string]: e.kind === 'lead' ? `var(--army-${slotOf(e.market)})` : e.side === 'buy' ? 'var(--battle-up)' : 'var(--battle-down)' } as React.CSSProperties}>
                <div className="battle__evh mono">
                  <span>{e.kind === 'lead' ? 'Lead' : 'Burst'}</span>
                  <span>{fmtClock(e.at).slice(0, 8)}</span>
                </div>
                <p className="battle__evt">{e.text}</p>
                {e.follow && (
                  <button type="button" className={`battle__chip battle__chip--${e.follow.tone}`} style={{ marginTop: 6 }} onClick={() => act(e.follow!.ask)} title={e.follow.ask} data-journey={`Follow the war log on ${armyLabel(e.market)}`}>
                    {e.follow.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      </MarketsSide>
      )}
      {door}
    </>
  )
}

// ── Initial state from the URL ────────────────────────────────────────────────

function initialWindow(): FrontWindow {
  if (typeof window === 'undefined') return parseFrontWindow(null)
  return parseFrontWindow(new URLSearchParams(window.location.search).get('since'))
}

function initialPick(): PickMode {
  if (typeof window === 'undefined') return 'gainers'
  return parsePickMode(new URLSearchParams(window.location.search).get('pick'))
}

// ── The memory of a hand-set field is lib/market-pick's (one key for every
// live surface; the old army key is read once and carried over there). ─────

// ── Inks from the page's tokens ──────────────────────────────────────────────

function readInks(el: HTMLElement): Inks {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    army: ARMY_SLOTS.map((n) => v(`--army-${n}`, '#e6b84a')),
    up: v('--battle-up', '#3ecf8e'),
    down: v('--battle-down', '#ff5d64'),
    grid: v('--battle-grid', 'rgba(255,255,255,0.07)'),
    horizon: v('--battle-horizon', 'rgba(255,255,255,0.2)'),
    gain: v('--battle-ground-gain', 'rgba(62,207,142,0.1)'),
    loss: v('--battle-ground-loss', 'rgba(255,93,100,0.1)'),
    fg: v('--fg', '#fff'),
    muted: v('--muted', '#999'),
    bg: v('--bg', '#000'),
    surface: v('--surf-1', '#111'),
    mono: v('--mk-font-mono', 'ui-monospace, monospace'),
    ui: v('--mk-font-ui', 'system-ui, sans-serif'),
  }
}
