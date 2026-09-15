'use client'

// THE HERO (mk2 LANDING, 2026-09-15): a real chart, live, executing. Left,
// the claim; right, the engine itself (ChartMount on a live symbol) with a
// HUD that REHEARSES the product on a loop — an ask types itself, the route
// draws across dapps, a guard check ticks, and it ends on a receipt or an
// ARMED stop. No wallet is needed to watch. The chart follows the ask (ETH
// → ETH → HYPE). Fills are illustrative and the HUD says so: a rehearsal
// never impersonates a receipt.
//
// "Do it for real" is one click: the act row (EXEC's ExecStrip slot) and the
// rehearsal's own button run through lib/use-connect-to-act — a connected
// wallet runs the ask in the site-wide ask door, a stranger gets the
// connect-only door and the held ask runs when a wallet lands (rule 6; the
// signature is the gate). Reduced motion → the last beat, complete and still.

import './landing.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import SpineLink from '@/components/SpineLink'
import ChartMount, { type ChartStats } from '@/components/markets/chart/ChartMount'
import ExecStrip from '@/components/markets/slots/ExecStrip'
import { getProtocolMark } from '@/components/protocol-marks'
import { fmtPrice } from '@/components/CandleChart'
import { chartPairFor } from '@/lib/charts'
import { HERO_LINE, HERO_REEL, LANDING_EYEBROW, LANDING_LEDE, REEL_STAMP, type ReelBeat } from '@/lib/markets-copy'
import { symbolName } from '@/lib/markets'
import { useAskDoor } from '@/lib/ask-door'
import { useConnectToAct } from '@/lib/use-connect-to-act'

const promptHref = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

/** One rehearsal, as phases. `typed` is how much of the ask is on screen. */
type Phase = 'typing' | 'route' | 'guard' | 'end' | 'wipe'
interface ReelState { beat: number; phase: Phase; typed: number; legs: number; guards: number }

const TYPE_MS = 46
const LEG_MS = 650
const GUARD_MS = 520
const END_HOLD_MS = 3200
const WIPE_MS = 500

function useReel(reduce: boolean): ReelState {
  const last = HERO_REEL.length - 1
  const [s, setS] = useState<ReelState>(() =>
    reduce
      ? { beat: last, phase: 'end', typed: HERO_REEL[last].ask.length, legs: HERO_REEL[last].legs.length, guards: HERO_REEL[last].guard.length }
      : { beat: 0, phase: 'typing', typed: 0, legs: 0, guards: 0 },
  )
  useEffect(() => {
    if (reduce) return
    const b = HERO_REEL[s.beat]
    let delay = TYPE_MS
    let next: ReelState = s
    if (s.phase === 'typing') {
      if (s.typed < b.ask.length) next = { ...s, typed: s.typed + 1 }
      else { next = { ...s, phase: 'route' }; delay = 500 }
    } else if (s.phase === 'route') {
      if (s.legs < b.legs.length) { next = { ...s, legs: s.legs + 1 }; delay = LEG_MS }
      else { next = { ...s, phase: 'guard' }; delay = 250 }
    } else if (s.phase === 'guard') {
      if (s.guards < b.guard.length) { next = { ...s, guards: s.guards + 1 }; delay = GUARD_MS }
      else { next = { ...s, phase: 'end' }; delay = END_HOLD_MS }
    } else if (s.phase === 'end') {
      next = { ...s, phase: 'wipe' }; delay = WIPE_MS
    } else {
      next = { beat: (s.beat + 1) % HERO_REEL.length, phase: 'typing', typed: 0, legs: 0, guards: 0 }
      delay = 200
    }
    const t = setTimeout(() => setS(next), delay)
    return () => clearTimeout(t)
  }, [s, reduce])
  return s
}

function LegMark({ venue }: { venue: string }) {
  const Mark = getProtocolMark(venue)
  return <span className="lh__legmark">{Mark ? <Mark size={14} /> : <b>{venue[0]}</b>}</span>
}

function Hud({ beat, state }: { beat: ReelBeat; state: ReelState }) {
  const wiping = state.phase === 'wipe'
  return (
    <div className="lh__hud" style={{ opacity: wiping ? 0 : 1, transition: 'opacity .4s ease' }} aria-hidden="true">
      <div className="lh__hudask">
        {beat.ask.slice(0, state.typed)}
        {state.phase === 'typing' && <i className="lh__caret" />}
      </div>
      <ul className="lh__legs">
        {beat.legs.map((l, i) => (
          <li key={l.venue} className={`lh__leg${i < state.legs ? ' is-in' : ''}`}>
            <LegMark venue={l.venue} />
            <span>
              <span className="lh__legname">{l.venue}</span>
              <span className="lh__legchain mono">{l.chain}</span>
              <span className="lh__legwhat mono">{l.what}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="lh__guard mono">
        {beat.guard.map((g, i) => (
          <li key={g} className={i < state.guards ? 'is-in' : ''}>{g}</li>
        ))}
      </ul>
      <div className={`lh__end mono${state.phase === 'end' || state.phase === 'wipe' ? ' is-in' : ''}${beat.ending.kind === 'armed' ? ' lh__end--armed' : ''}`}>
        <i /> {beat.ending.line}
      </div>
      <div className="lh__stamp mono">{REEL_STAMP}</div>
    </div>
  )
}

export default function LandingHero() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => setReduce(matchMedia('(prefers-reduced-motion: reduce)').matches), [])
  const state = useReel(reduce)
  const beat = HERO_REEL[state.beat]
  const symbol = beat.symbol
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const [stats, setStats] = useState<ChartStats | null>(null)
  const onStats = useCallback((s: ChartStats) => setStats(s), [])

  // Do it for real: the site-wide ask door runs the sentence (chip-send);
  // a stranger is asked for a wallet AT the action.
  const openDoor = useAskDoor((s) => s.openDoor)
  const { act, door } = useConnectToAct({
    run: (ask) => openDoor(ask, { send: true }),
    redirectFor: (ask) => promptHref(ask),
  })

  const chg = stats?.changePct24h ?? null
  return (
    <section className="lh" data-landing-hero>
      <div className="lh__in">
        <div className="lh__copy">
          <div className="lh__eyebrow mono">{LANDING_EYEBROW}</div>
          <h1 className="lh__h1">{HERO_LINE}</h1>
          <p className="lh__lede">{LANDING_LEDE}</p>
          <div className="lh__ctas">
            <SpineLink className="btn btn--solid" href="/markets">
              Open Markets
            </SpineLink>
            <SpineLink className="btn btn--ghost" href={`/t/${symbol}`}>
              See the {symbol} chart <ArrowRight className="w-3.5 h-3.5" />
            </SpineLink>
          </div>
          <p className="lh__ask" aria-label="Example asks">
            <span className="lh__asklabel mono">say it</span>
            <span className="lh__typed">
              &ldquo;{beat.ask.slice(0, state.typed)}
              {!reduce && state.phase === 'typing' && <i className="lh__caret" aria-hidden="true" />}&rdquo;
            </span>
          </p>
          <div className="lh__quiet mono">
            <span><b>no custody</b> · your wallet signs</span>
            <span><b>no sign-up</b> to look</span>
            <span><b>unlimited</b> watchlists · alerts</span>
          </div>
        </div>

        <div className="lh__stage" data-landing-stage>
          <div className="lh__bar">
            <div className="lh__sym">
              <span className="lh__symname">{symbol} / USD</span>
              <span className="lh__symsrc mono">{symbolName(symbol)}{pair ? ` · ${pair.source === 'hyperliquid' ? 'Hyperliquid perps' : 'Coinbase spot'}` : ''}</span>
            </div>
            <div className="lh__px">
              {stats?.last != null && <span className="lh__last mono">${fmtPrice(stats.last)}</span>}
              {chg != null && (
                <span className={`lh__chg mono${chg >= 0 ? ' is-up' : ' is-down'}`}>
                  {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
                </span>
              )}
              <span className="lh__live mono">LIVE</span>
            </div>
          </div>
          <div className="lh__chart">
            <ChartMount symbol={symbol} height={380} defaultTf="1h" onStats={onStats} onAsk={act} />
            <Hud beat={beat} state={state} />
          </div>
          <div className="lh__strip">
            {pair && <ExecStrip symbol={symbol} pair={pair} onAsk={act} />}
          </div>
          <div className="lh__doit">
            <span>
              Watched it. <b>Now for real:</b> the same sentence, your wallet, a guarded card to sign.
            </span>
            <button type="button" className="btn btn--sm" onClick={() => act(beat.ask)}>
              Do it for real
            </button>
          </div>
        </div>
      </div>
      {door}
    </section>
  )
}
