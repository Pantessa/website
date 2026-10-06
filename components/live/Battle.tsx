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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import type { TradabilityMap } from '@/lib/tradability'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import {
  ARMY_SLOTS,
  DEFAULT_PICK,
  FALLBACK_ARMIES,
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
  parseFrontTokens,
  parseFrontWindow,
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
import { FOLLOW_USD, fmtClock, fmtPrice, fmtUsd, followAsk, mergeFills, type FollowAsk, type TapeFill, type TapeSide } from '@/lib/tape'
import { hlTapeFeed, readTapeUniverse, type FeedStatus } from '@/lib/tape-feed'
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

export default function Battle({ view, tradable, tabs }: { view: BattleView; tradable: TradabilityMap; tabs?: ReactNode }) {
  const urlArmies = useMemo(() => initialArmies(), [])
  const [armies, setArmies] = useState<string[]>(urlArmies)
  const [since, setSince] = useState<FrontWindow>(() => initialWindow())
  const [pickMode, setPickMode] = useState<PickMode>(() => initialPick())
  const [status, setStatus] = useState<FeedStatus>('idle')
  const [universe, setUniverse] = useState<string[]>([])
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [tick, setTick] = useState(0)
  const [ctxTick, setCtxTick] = useState(0)
  const [log, setLog] = useState<WarEvent[]>([])
  const [draft, setDraft] = useState('')

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
  const pickedRef = useRef(urlArmies.length > 0)

  const mainRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  // ── URL ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(liveUrl(view, armies, since, window.location.pathname), window.location.origin)
    if (pickMode !== 'gainers') url.searchParams.set('pick', pickMode)
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }, [view, armies, since, pickMode])

  // ── The universe (for the add box) ────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()
    readTapeUniverse(ac.signal).then(({ main, xyz }) => {
      if (ac.signal.aborted) return
      setUniverse([...main, ...xyz].filter((r) => !r.delisted).sort((a, b) => b.volumeUsd - a.volumeUsd).map((r) => r.name))
    })
    return () => ac.abort()
  }, [])

  // ── Contexts: mark, OI, funding, 24h; the opening pick ────────────────
  useEffect(() => {
    const ac = new AbortController()
    const read = () => readArmyContexts(ac.signal).then((m) => {
      if (ac.signal.aborted || !m.size) return
      ctxRef.current = m
      setCtxTick((t) => t + 1)
      if (!pickedRef.current) {
        pickedRef.current = true
        const top = pickList(m, parsePickMode(new URLSearchParams(window.location.search).get('pick'))).slice(0, DEFAULT_PICK).map((r) => r.market)
        setArmies(top.length ? top : [...FALLBACK_ARMIES])
      }
    })
    read()
    const id = setInterval(read, 30_000)
    const fallback = setTimeout(() => {
      if (!pickedRef.current) {
        pickedRef.current = true
        setArmies([...FALLBACK_ARMIES])
      }
    }, 6000)
    return () => {
      ac.abort()
      clearInterval(id)
      clearTimeout(fallback)
    }
  }, [])

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

  // ── Fills: the stream ─────────────────────────────────────────────────
  useEffect(() => {
    if (!armies.length) return
    const close = hlTapeFeed.connect(armies, {
      onFills: (batch) => {
        const now = Date.now()
        fillsRef.current = mergeFills(fillsRef.current, batch, now)
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
      onStatus: (s) => setStatus(s),
    })
    return close
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
      if (fresh.length) setLog((prev) => [...fresh.sort((x, y) => y.at - x.at), ...prev].slice(0, LOG_ROWS))
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [chipFor])

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
      const input = {
        view,
        armies,
        since,
        now: pausedAtRef.current ?? Date.now(),
        openedAt: openedAtRef.current,
        samples: samplesRef.current,
        fills: fillsRef.current,
        contexts: ctxRef.current,
        particles: particlesRef.current,
        range: rangeRef.current,
        hover: hoverRef.current,
        inks: inksRef.current,
        reduced: reducedRef.current,
        paused: pausedAtRef.current !== null,
      }
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
  }, [view, armies, since])

  const onMove = useCallback((e: React.MouseEvent) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
  }, [])
  const onLeave = useCallback(() => {
    hoverRef.current = null
  }, [])

  // ── Armies: pick, add, remove ─────────────────────────────────────────
  const toggleArmy = useCallback((m: string) => {
    setArmies((prev) => {
      if (prev.includes(m)) return prev.length > 1 ? prev.filter((x) => x !== m) : prev
      if (prev.length >= MAX_ARMIES) return prev
      return [...prev, m]
    })
  }, [])
  const addDraft = useCallback(() => {
    const [m] = parseFrontTokens(draft)
    if (!m) return
    setArmies((prev) => (prev.includes(m) || prev.length >= MAX_ARMIES ? prev : [...prev, m]))
    setDraft('')
  }, [draft])
  const pickTop = useCallback((mode: PickMode) => {
    setPickMode(mode)
    const top = pickList(ctxRef.current, mode).slice(0, DEFAULT_PICK).map((r) => r.market)
    if (top.length) setArmies(top)
  }, [])

  // ── The scoreboard reads the last frame ───────────────────────────────
  const frames = framesRef.current
  const ranked = useMemo(() => rankArmies(frames, (a) => a.pct), [frames, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const picks = useMemo(() => pickList(ctxRef.current, pickMode), [pickMode, ctxTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const unit = unitRef.current
  const minutes = windowMinutes(since)
  const viewDef = LIVE_VIEWS.find((v) => v.id === view)!
  const custom = armies.filter((m) => !picks.some((p) => p.market === m))
  const slotOf = (m: string) => ARMY_SLOTS[armies.indexOf(m)] ?? 1

  return (
    <>
      <main ref={mainRef} className="mkt-frame__main battle" data-view={view} data-status={status} data-paused={paused || undefined}>
        <h1 className="sr-only">{viewDef.label}</h1>

        <div className="mkt-frame__bar battle__bar">
          <div className="battle__title">
            <span className={`mk-dot ${status === 'live' ? 'mk-dot--open' : 'mk-dot--closed'} battle__pulse`} aria-hidden />
            <span className="battle__h">{viewDef.label}</span>
            <span className="battle__sub mono">{viewDef.blurb}</span>
          </div>
          {tabs}
          <div className="battle__controls">
            <div className="battle__since" role="group" aria-label="Ground is measured since">
              {FRONT_WINDOWS.map((w) => (
                <button key={w.id} type="button" className={since === w.id ? 'is-on' : undefined} aria-pressed={since === w.id} onClick={() => setSince(w.id)}>
                  {w.label}
                </button>
              ))}
            </div>
            <button type="button" className="battle__btn" onClick={togglePause} aria-pressed={paused} title={paused ? 'Resume the field' : 'Hold the field'}>
              {paused ? <Play size={13} strokeWidth={2.2} /> : <Pause size={13} strokeWidth={2.2} />}
              <span>{paused ? 'Resume' : 'Hold'}</span>
            </button>
            <button type="button" className="battle__btn" onClick={toggleFull} title={full ? 'Leave fullscreen' : 'Fullscreen'}>
              {full ? <Minimize2 size={13} strokeWidth={2.2} /> : <Maximize2 size={13} strokeWidth={2.2} />}
              <span>{full ? 'Exit' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>

        {/* ── The picker: one to five armies ── */}
        <div className="battle__picker" role="group" aria-label="Armies">
          <div className="battle__pickhead">
            <div className="battle__modes" role="group" aria-label="Pick from">
              {PICK_MODES.map((m) => (
                <button key={m.id} type="button" className={pickMode === m.id ? 'is-on' : undefined} aria-pressed={pickMode === m.id} onClick={() => pickTop(m.id)} title={m.hint}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="battle__count mono">
              {armies.length} of {MAX_ARMIES} armies · click to add or drop
            </span>
          </div>
          <div className="battle__chips">
            {picks.map((p) => {
              const on = armies.includes(p.market)
              const fullUp = !on && armies.length >= MAX_ARMIES
              return (
                <button
                  key={p.market}
                  type="button"
                  className={`battle__pick${on ? ' is-on' : ''}`}
                  style={on ? ({ ['--army-ink' as string]: `var(--army-${slotOf(p.market)})` } as React.CSSProperties) : undefined}
                  aria-pressed={on}
                  disabled={fullUp}
                  onClick={() => toggleArmy(p.market)}
                  title={fullUp ? 'Five armies is the field — drop one first' : on ? 'Drop this army' : 'Add this army'}
                >
                  {on && <span className="battle__army-dot" aria-hidden />}
                  <span className="battle__pick-n">{armyLabel(p.market)}</span>
                  <span className={`battle__pick-v mono ${pickMode === 'gainers' ? (p.dayPct !== null && p.dayPct >= 0 ? 'up' : 'down') : ''}`}>{pickMode === 'gainers' ? fmtPct(p.dayPct) : fmtUsd(p.oiUsd)}</span>
                </button>
              )
            })}
            {custom.map((m) => (
              <button key={m} type="button" className="battle__pick is-on" style={{ ['--army-ink' as string]: `var(--army-${slotOf(m)})` } as React.CSSProperties} aria-pressed onClick={() => toggleArmy(m)} title="Drop this army">
                <span className="battle__army-dot" aria-hidden />
                <span className="battle__pick-n">{armyLabel(m)}</span>
                <span className="battle__pick-v mono">yours</span>
              </button>
            ))}
            <form
              className="battle__add"
              onSubmit={(e) => {
                e.preventDefault()
                addDraft()
              }}
            >
              <input id="battle-add" list="battle-universe" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={armies.length >= MAX_ARMIES ? 'field is full' : '+ your own (BTC, xyz:NVDA…)'} aria-label="Add a token" autoComplete="off" disabled={armies.length >= MAX_ARMIES} />
              <datalist id="battle-universe">
                {universe.slice(0, 400).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </form>
          </div>
        </div>

        <div className="battle__stage" ref={stageRef} onMouseMove={onMove} onMouseLeave={onLeave}>
          <canvas ref={canvasRef} className="battle__canvas" role="img" aria-label={`${viewDef.label}: ${viewDef.blurb}`} />
          {frames.every((a) => a.track.length === 0) && <div className="battle__empty mono">{armies.length === 0 ? 'picking the armies…' : status === 'live' ? 'first prices landing…' : 'reaching the venue…'}</div>}
        </div>
        <p className="battle__legend mono">
          <span><b>ground</b> = % move {minutes === null ? 'since the page opened' : `since ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} ago`} · horizon = 0%</span>
          {view === 'map' ? <span><b>land</b> = open interest share</span> : <span><b>territory</b> = ground gained or lost</span>}
          <span><b className="up">▲</b> = {fmtUsd(unit)} bought in 60s · <b className="down">▼</b> = {fmtUsd(unit)} sold</span>
          <span><b>burst</b> = a fill ≥ {fmtUsd(unit * 4)}, where it hit</span>
          <span><b>tracers</b> = every fill as it lands</span>
        </p>

        <section className="battle__board" aria-label="Scoreboard">
          <table className="battle__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Army</th>
                <th className="num">Ground</th>
                <th className="num">Price</th>
                <th>Backers · 60s</th>
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
                      {day !== null && <span className="battle__partial mono">24h {fmtPct(day)}</span>}
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
                          <button type="button" className="battle__chip battle__chip--buy" onClick={() => act(long.ask)} title={long.ask}>
                            {long.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                          </button>
                        )}
                        {short && (
                          <button type="button" className="battle__chip battle__chip--sell" onClick={() => act(short.ask)} title={short.ask}>
                            {short.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                          </button>
                        )}
                        {!long && !short && <span className="battle__dim mono">no route here</span>}
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
        <p className="battle__legend mono" style={{ marginTop: 10 }}>
          Percent price move is percent market-cap move over a window this short. Every glyph is a measured fill; nothing on this field is estimated. A recruit chip is the sentence that joins the army at ${FOLLOW_USD}; your wallet signs it.
        </p>
      </main>

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
                  <button type="button" className={`battle__chip battle__chip--${e.follow.tone}`} style={{ marginTop: 6 }} onClick={() => act(e.follow!.ask)} title={e.follow.ask}>
                    {e.follow.label} <span className="battle__chip-usd">${FOLLOW_USD}</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      </MarketsSide>
      {door}
    </>
  )
}

// ── Initial state from the URL ────────────────────────────────────────────────

function initialArmies(): string[] {
  if (typeof window === 'undefined') return []
  return parseFrontTokens(new URLSearchParams(window.location.search).get('t'))
}

function initialWindow(): FrontWindow {
  if (typeof window === 'undefined') return parseFrontWindow(null)
  return parseFrontWindow(new URLSearchParams(window.location.search).get('since'))
}

function initialPick(): PickMode {
  if (typeof window === 'undefined') return 'gainers'
  return parsePickMode(new URLSearchParams(window.location.search).get('pick'))
}

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
