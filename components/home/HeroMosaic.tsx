'use client'

// THE HERO MOSAIC (2026-11-19; the table and its rules: lib/hero-mosaic).
// The stranger's hero on `/`: every market a tile, every dapp a tile, and the
// claim in the middle with ONE sentence that lights the tiles it would use.
//
//   • a MARKET tile is a link to its chart (looking needs no wallet);
//   • a DAPP tile wears the mark only and SENDS its sentence to the app
//     ("Stake $20 worth of ETH on Lido"), through the connect-to-act door;
//   • the BUY tile sends "Buy $25 of AAPL" the same way;
//   • the CALLED tile is a link to an account's chart calls (/x/<handle>);
//   • the middle sentence cycles by itself, follows the tile under the
//     pointer or the focus, and "Build it" sends whatever it says.
//
// components/home/SplashClaim wraps its (stateless, pinned) markup in this
// component, so the claim block itself still holds no state. The read's
// snapshot arrives by context (HeroReadSeed, mounted by HomeSurface) so the
// tiles are in the server HTML with the same numbers THE READ shows.
//
// An ask goes to the APP, out of band (lib/arrival-intent: same tab, one
// shot, never in the URL), exactly as the index's own row chips do. A
// returning visitor's page (`<html data-home="return">`) folds every tile
// away in CSS (./mosaic.css); nothing here reads the posture.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import LandingLink from '@/components/home/LandingLink'
import { getProtocolMark } from '@/components/protocol-marks'
import { ARRIVAL_APP_HREF, writeArrivalIntent } from '@/lib/arrival-intent'
import { ARRIVAL_MAX_MCPS } from '@/lib/arrival-fence'
import { askAppSlugs } from '@/lib/ask-apps'
import {
  HERO_BUY,
  HERO_CALLED,
  HERO_CYCLE,
  HERO_CYCLE_MS,
  HERO_TILES,
  heroAppAsk,
  heroAppFallbackHref,
  heroMoverSymbols,
  heroSay,
  type HeroAppTile,
  type HeroSay,
} from '@/lib/hero-mosaic'
import { fmtPct, fmtQuotePrice, useQuotes } from '@/lib/markets-quotes'
import { EMPTY_READ, fmtReadChange, fmtReadValue, readInstrument, readPageHref, readSpark, readTone, type ReadId, type ReadSnapshot } from '@/lib/read'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import './mosaic.css'

const ReadSeed = createContext<ReadSnapshot>(EMPTY_READ)

/** Hands the server's read snapshot to the hero (mounted by HomeSurface). */
export function HeroReadSeed({ value, children }: { value: ReadSnapshot; children: ReactNode }) {
  return <ReadSeed.Provider value={value}>{children}</ReadSeed.Provider>
}

interface Stage {
  say: HeroSay | null
  act: (ask: string) => void
}
const StageCtx = createContext<Stage>({ say: null, act: () => {} })

const SPARK_W = 120
const SPARK_H = 36
const toneClass = (tone: 'up' | 'down' | 'flat') => `is-${tone}`

/** The sentence in the middle of the mosaic, and the button that sends it. */
export function HeroComposer() {
  const { say, act } = useContext(StageCtx)
  return (
    <div className="hm-say" data-hero-say={say?.from ?? ''}>
      <span className="hm-say__text" key={say?.ask ?? 'none'}>
        {say?.ask ?? 'Say what you want to do'}
      </span>
      <button type="button" className="hm-say__go" disabled={!say} onClick={() => say && act(say.ask)} aria-label={say ? `Build it: ${say.ask}` : 'Build it'} data-ask={say?.ask} data-journey={`Hero build: ${say?.ask ?? ''}`}>
        Build it
      </button>
    </div>
  )
}

export default function HeroMosaic({ children }: { children: ReactNode }) {
  const snap = useContext(ReadSeed)
  const router = useRouter()
  const pathname = usePathname()
  const eth = snap.quotes.eth?.last ?? null
  const movers = useMemo(() => heroMoverSymbols(snap.movers), [snap.movers])
  const { quotes } = useQuotes(useMemo(() => [HERO_BUY.symbol, ...movers], [movers]))

  // ── The sentence: the cycle, or the tile under the pointer / the focus ──
  const cycle = useMemo(() => HERO_CYCLE.map((f) => heroSay(f, eth)).filter((s): s is HeroSay => !!s), [eth])
  const [idx, setIdx] = useState(0)
  const [held, setHeld] = useState<HeroSay | null>(null)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || held || cycle.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      if (!document.hidden) setIdx((i) => (i + 1) % cycle.length)
    }, HERO_CYCLE_MS)
    return () => window.clearInterval(id)
  }, [paused, held, cycle.length])
  const say = held ?? cycle[idx % Math.max(1, cycle.length)] ?? null
  const lit = say?.lit ?? []
  const isLit = (id: string) => lit.includes(id)

  // ── The send: to the app, out of band (the index's own row-chip path) ──
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const handOff = useCallback(
    (ask: string) => {
      const mcps = askAppSlugs(ask).slice(0, ARRIVAL_MAX_MCPS)
      const handed = writeArrivalIntent({ text: ask, from: pathname ?? '', ...(mcps.length ? { mcps } : {}) })
      router.push(handed ? ARRIVAL_APP_HREF : promptHref(ask))
    },
    [pathname, router, promptHref],
  )
  const { act, door } = useConnectToAct({ run: handOff, redirectFor: promptHref })
  const stage = useMemo(() => ({ say, act }), [say, act])

  const hold = (s: HeroSay | null) => () => setHeld(s)
  const release = () => setHeld(null)

  let n = 0
  return (
    <StageCtx.Provider value={stage}>
      <div
        className="hm"
        data-hero-mosaic
        data-lit={lit.join(' ')}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => {
          setPaused(false)
          setHeld(null)
        }}
      >
        <div className="hm__centre">{children}</div>
        <div className="hm__tiles">
          {HERO_TILES.map((t) => {
            const i = n++
            const delay = { '--hm-i': i } as React.CSSProperties
            if (t.kind === 'market') return <MarketTile key={t.id} id={t.id} snap={snap} lit={isLit(t.id)} style={delay} />
            if (t.kind === 'mover') {
              const sym = movers[t.slot]
              const q = quotes[sym]
              const tone = readTone(q?.chgPct)
              return (
                <LandingLink key={`mover-${t.slot}`} href={`/t/${sym}`} prefetch={false} className={`hm__tile hm__tile--mkt hm__tile--stock ${toneClass(tone)}`} style={delay} data-hero-tile={`stock:${sym}`} data-journey={`Hero tile: open ${sym}`}>
                  <span className="hm__label">
                    {sym}
                    <span className="hm__tag mono">Stock</span>
                  </span>
                  <span className="hm__big mono">{q ? fmtPct(q.chgPct) : '—'}</span>
                  <span className="hm__val mono">{q ? `$${fmtQuotePrice(q.last)}` : '—'}</span>
                </LandingLink>
              )
            }
            if (t.kind === 'app') return <AppTile key={t.id} tile={t} ask={heroAppAsk(t.id, eth)} lit={isLit(t.id)} onHold={hold(heroSay(t.id, eth))} onRelease={release} act={act} style={delay} />
            if (t.kind === 'buy') {
              const q = quotes[HERO_BUY.symbol]
              const mine = heroSay('aapl', eth)
              return (
                <button
                  key="buy"
                  type="button"
                  className={`hm__tile hm__tile--buy${isLit('aapl') ? ' is-lit' : ''}`}
                  style={delay}
                  onClick={() => act(HERO_BUY.ask)}
                  onPointerEnter={hold(mine)}
                  onFocus={hold(mine)}
                  onBlur={release}
                  data-hero-tile="buy"
                  data-ask={HERO_BUY.ask}
                  data-journey={`Hero tile: ${HERO_BUY.ask}`}
                >
                  <span className="hm__eyebrow mono">Stocks, around the clock</span>
                  <span className="hm__title">{HERO_BUY.label}</span>
                  <span className="hm__foot mono">
                    <span>
                      {HERO_BUY.symbol} {q ? `$${fmtQuotePrice(q.last)}` : ''} {q ? fmtPct(q.chgPct) : ''}
                    </span>
                    <span className="hm__arrow" aria-hidden>
                      →
                    </span>
                  </span>
                </button>
              )
            }
            return (
              <LandingLink key="called" href={HERO_CALLED.href} prefetch={false} className="hm__tile hm__tile--called" style={delay} data-hero-tile="called" data-journey={`Hero tile: called ${HERO_CALLED.handle}`}>
                <span className="hm__eyebrow mono">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
                    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
                  </svg>
                  {HERO_CALLED.eyebrow}
                </span>
                <span className="hm__title">{HERO_CALLED.name}</span>
                <span className="hm__foot">
                  <span>{HERO_CALLED.line}</span>
                  <span className="hm__arrow" aria-hidden>
                    →
                  </span>
                </span>
              </LandingLink>
            )
          })}
        </div>
      </div>
      {door}
    </StageCtx.Provider>
  )
}

function MarketTile({ id, snap, lit, style }: { id: ReadId; snap: ReadSnapshot; lit: boolean; style: React.CSSProperties }) {
  const inst = readInstrument(id)
  const q = snap.quotes[id]
  const tone = readTone(q?.chg, inst.unit)
  const spark = q ? readSpark(q.points, SPARK_W, SPARK_H, 40) : ''
  const cls = `hm__tile hm__tile--mkt ${toneClass(tone)}${lit ? ' is-lit' : ''}`
  const body = (
    <>
      <span className="hm__label">{inst.label}</span>
      <svg className="hm__spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden>
        {spark && <path d={spark} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="hm__nums mono">
        <span className="hm__val">{fmtReadValue(inst, q?.last)}</span>
        <span className="hm__chg">{fmtReadChange(inst, q?.chg)}</span>
      </span>
    </>
  )
  const href = readPageHref(inst)
  if (!href) {
    return (
      <div className={cls} style={style} data-hero-tile={`market:${id}`}>
        {body}
      </div>
    )
  }
  return (
    <LandingLink href={href} prefetch={false} className={cls} style={style} data-hero-tile={`market:${id}`} data-journey={`Hero tile: open ${inst.label}`}>
      {body}
    </LandingLink>
  )
}

function AppTile({ tile, ask, lit, onHold, onRelease, act, style }: { tile: HeroAppTile; ask: string | null; lit: boolean; onHold: () => void; onRelease: () => void; act: (ask: string) => void; style: React.CSSProperties }) {
  const Mark = getProtocolMark(tile.slug, tile.name)
  const mark = (
    <span className="hm__mark" aria-hidden>
      {Mark ? <Mark size={40} /> : tile.name.slice(0, 1)}
    </span>
  )
  const cls = `hm__tile hm__tile--app${lit ? ' is-lit' : ''}`
  // No sentence right now (the CoW limit with no price): the app, with this dapp on.
  if (!ask) {
    return (
      <LandingLink href={heroAppFallbackHref(tile)} prefetch={false} className={cls} style={style} aria-label={tile.name} title={tile.name} data-hero-tile={`app:${tile.id}`} data-journey={`Hero tile: app ${tile.name}`}>
        {mark}
      </LandingLink>
    )
  }
  return (
    <button type="button" className={cls} style={style} onClick={() => act(ask)} onPointerEnter={onHold} onFocus={onHold} onBlur={onRelease} aria-label={`${tile.name}: ${ask}`} title={ask} data-hero-tile={`app:${tile.id}`} data-ask={ask} data-journey={`Hero tile: ${ask}`}>
      {mark}
    </button>
  )
}
