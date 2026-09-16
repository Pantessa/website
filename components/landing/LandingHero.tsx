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
type Phase = 'typing' | 'route' | 'end' | 'wipe'
interface ReelState { beat: number; phase: Phase; typed: number; legs: number }

const TYPE_MS = 46
const LEG_MS = 700
const END_HOLD_MS = 3200
const WIPE_MS = 500

/** SSR paints beat 0 COMPLETE (a crawler and the first frame read a real
 *  sentence + its receipt); after mount the loop wipes and types beat 1. */
const complete = (i: number): ReelState => ({ beat: i, phase: 'end', typed: HERO_REEL[i].ask.length, legs: HERO_REEL[i].legs.length })

function useReel(reduce: boolean): ReelState {
  const last = HERO_REEL.length - 1
  const [s, setS] = useState<ReelState>(() => complete(0))
  // The preference is read after mount (SSR can't know it): when it flips
  // on, park on the last beat, complete and still — never mid-typing.
  useEffect(() => {
    if (reduce) setS(complete(last))
  }, [reduce, last])
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
      else { next = { ...s, phase: 'end' }; delay = END_HOLD_MS }
    } else if (s.phase === 'end') {
      next = { ...s, phase: 'wipe' }; delay = WIPE_MS
    } else {
      next = { beat: (s.beat + 1) % HERO_REEL.length, phase: 'typing', typed: 0, legs: 0 }
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

/** The receipt strip: bottom-left inside the chart frame, over the volume
 *  pane, never the price action. One line per leg, each appearing as it
 *  lands; the ending line closes it; the stamp keeps it honest. */
function Hud({ beat, state }: { beat: ReelBeat; state: ReelState }) {
  const wiping = state.phase === 'wipe'
  const ended = state.phase === 'end' || wiping
  return (
    <div className={`lh__rcpt mono${wiping ? ' is-wiping' : ''}`} aria-hidden="true" data-reel-beat={state.beat}>
      <div className="lh__rcptask">
        <span className="lh__rcptq">›</span> {beat.ask.slice(0, state.typed)}
        {state.phase === 'typing' && <i className="lh__caret" />}
      </div>
      {beat.legs.map((l, i) => (
        <div key={l.venue} className={`lh__rcptleg${i < state.legs ? ' is-in' : ''}`}>
          <LegMark venue={l.venue} />
          <span>{l.line}</span>
        </div>
      ))}
      <div className={`lh__rcptend${ended ? ' is-in' : ''}${beat.ending.kind === 'armed' ? ' lh__rcptend--armed' : ''}`}>
        {beat.ending.kind === 'armed' ? '◆' : '✓'} {beat.ending.line}
      </div>
      <div className="lh__rcptstamp">{REEL_STAMP}</div>
    </div>
  )
}

// The payoff word wears the site's gradient italic: "The chart" / "that
// executes." — split on the first " that ", the string itself untouched
// (HOME_TITLE pins it; the SSR h1 text is still the full line).
const HERO_SPLIT = HERO_LINE.match(/^(.+?) (that .+)$/)
const heroLead = HERO_SPLIT ? HERO_SPLIT[1] : ''
const heroTail = HERO_SPLIT ? HERO_SPLIT[2] : HERO_LINE

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
          <h1 className="lh__h1">{heroLead ? `${heroLead} ` : ''}{heroLead && <br />}<em>{heroTail}</em></h1>
          <p className="lh__lede">{LANDING_LEDE}</p>
          <div className="lh__ctas">
            <SpineLink className="btn btn--solid" href="/markets">
              Open Markets
            </SpineLink>
            <SpineLink className="btn btn--ghost" href={`/t/${symbol}`}>
              See the {symbol} chart <ArrowRight className="w-3.5 h-3.5" />
            </SpineLink>
          </div>
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
