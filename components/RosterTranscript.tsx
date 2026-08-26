'use client'

// RosterTranscript — the QA proof session (squad-overnight-2026-08-25/
// DEMO-PROOF.md, 10 beats over HTTP on the integration build), rendered as a
// replayable strip. DeskTranscript's exact discipline: lines land like a
// terminal session, typed cadence for the actors, the pauses are the drama,
// Pause/Replay, starts on first sight, reduced-motion readers get the whole
// session at once. Facts only — every request/response line below is the real
// text from the proof run (canonical mandate recompose, the badge, the inbox
// row, and the refusals verbatim). The strip's two beats: the HIRE signature,
// and the over-cap proposal refused BY NAME + benched.
//
// One editorial liberty, disclosed: the proof ran stacking (beat 10) on a
// fresh slot; the strip splices it into story position (after the ignored
// card, before the bench) so one slot's chronology reads straight. Every
// string is still the run's own.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'

type Who = 'wallet' | 'roster' | 'agent'

type Line = {
  who: Who
  text: string
  /** Extra hold before this line lands (ms) — the pause is the drama. */
  hold?: number
  /** Type the line character by character (someone speaking/typing). */
  type?: boolean
  /** A beat — held pause, then the line lands with a pulse. */
  beat?: boolean
  /** Rendered in the done colour (a signature landed / a safe terminal). */
  done?: boolean
  /** Rendered in the refusal colour (a fence held, by name). */
  wall?: boolean
}

const LINES: Line[] = [
  // 1 · the mandate is a sentence
  { who: 'wallet', text: 'keep me 60/40 ETH/USDC — cap it at $100', type: true },
  {
    who: 'roster',
    text: 'slot pending · kind: shape · stored canonical: "tile my wallet 60% ETH, 40% USDC" — the executor\'s own grammar round-trips it or the mandate refuses. Drafts stay private.',
    hold: 500,
  },
  // 2 · hiring is a signature (beat one)
  {
    who: 'roster',
    text: 'hire consent minted: slot id + agent hash + mandate hash + $100 cap + nonce — never the sentence, never a raw key',
    hold: 400,
  },
  { who: 'wallet', text: 'signed ✓ — hired', hold: 1200, beat: true },
  { who: 'roster', text: 'status: HIRED — the slot is public on the roster', hold: 300, done: true },
  // 3 · the hired agent proposes through the desk
  { who: 'agent', text: 'broker_open: "Swap $40 of USDC to ETH on Base"', type: true, hold: 400 },
  {
    who: 'roster',
    text: 'hired slot found · $40 under the $100 cap · addressed to the employer\'s inbox wearing the badge: Shape · "tile my wallet 60% ETH, 40% USDC" · $100 cap',
    hold: 450,
  },
  // 4 · the card lands
  { who: 'wallet', text: 'inbox: "Swap $40 of USDC to ETH on Base · from Rebalancer · Review & sign"', hold: 600 },
  // 6 · declining is free
  { who: 'wallet', text: '…busy. The card just sits — ignoring it is free, and the slot stays HIRED', hold: 700 },
  // 10 · stacking walls (spliced into story position — see header note)
  { who: 'agent', text: 'broker_open, three more $30 proposals…', type: true, hold: 300 },
  {
    who: 'roster',
    text: 'the 4th: "This slot already has 3 undecided proposals — the wallet owner decides those first. Stacking more is refused." — a wall, never a bench',
    hold: 500,
    wall: true,
  },
  // 7 · probing the cap benches the agent (beat two)
  { who: 'agent', text: 'broker_open: "Swap $150 of USDC to ETH on Base"', type: true, hold: 400 },
  {
    who: 'roster',
    text: 'Refused at open: this slot caps proposals at $100; this one prices at ~$150. Over-cap proposals bench the agent — ask the wallet owner to raise the cap instead.',
    hold: 1000,
    beat: true,
    wall: true,
  },
  { who: 'roster', text: 'status: BENCHED — no inbox card was created', hold: 300, wall: true },
  // 8 · firing is instant, nothing to withdraw
  { who: 'wallet', text: 'fire consent — signed ✓', hold: 900 },
  {
    who: 'roster',
    text: 'status: FIRED — the unsigned card vanished (its link now 404s). There is nothing to withdraw.',
    hold: 400,
    done: true,
  },
  // 9 · fired is terminal
  { who: 'agent', text: 'broker_open: "Swap $40 of USDC to ETH on Base"', type: true, hold: 300 },
  {
    who: 'roster',
    text: 'Refused at open: this desk identity was FIRED from its mandate slot. Fired is terminal — a new hire is a new slot, signed by the wallet owner. Nothing was proposed.',
    hold: 500,
    wall: true,
  },
]

/* Role inks reuse the desk transcript's theme-aware vocabulary: the wallet is
   the human (amber), the roster surface is the desk (accent), the agent is
   the agent (sky). Same classes, both themes free. */
const TAG: Record<Who, { label: string; cls: string }> = {
  wallet: { label: 'wallet', cls: 'desktx__who--human' },
  roster: { label: 'roster', cls: 'desktx__who--desk' },
  agent: { label: 'agent', cls: 'desktx__who--agent' },
}

const BASE_GAP = 420
const READ_MS_PER_CHAR = 7
const TYPE_MS_PER_CHAR = 22

export default function RosterTranscript() {
  const [shown, setShown] = useState(0)
  const [partial, setPartial] = useState(0)
  const [run, setRun] = useState(0)
  const [paused, setPaused] = useState(false)
  const [armed, setArmed] = useState(false)
  const [reduced, setReduced] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursor = useRef({ line: 0, char: 0 })

  const total = LINES.length
  const finished = shown >= total

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setArmed(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    const late = setTimeout(() => setArmed(true), 4000)
    return () => {
      io.disconnect()
      clearTimeout(late)
    }
  }, [])

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const step = useCallback(() => {
    const { line, char } = cursor.current
    if (line >= LINES.length) return
    const cur = LINES[line]
    if (cur.type && char < cur.text.length) {
      cursor.current = { line, char: char + 1 }
      setPartial(char + 1)
      timer.current = setTimeout(step, TYPE_MS_PER_CHAR + (cur.text[char] === ' ' ? 18 : 0))
      return
    }
    cursor.current = { line: line + 1, char: 0 }
    setShown(line + 1)
    setPartial(0)
    const next = LINES[line + 1]
    if (!next) return
    let delay = BASE_GAP + (next.hold ?? 0) + Math.min(cur.text.length * READ_MS_PER_CHAR, 700)
    if (next.type) delay = Math.max(240, delay - 200)
    timer.current = setTimeout(step, delay)
  }, [])

  useEffect(() => {
    clear()
    if (reduced) {
      cursor.current = { line: LINES.length, char: 0 }
      setShown(LINES.length)
      setPartial(0)
      return
    }
    if (!armed || paused) return
    if (cursor.current.line >= LINES.length) return
    timer.current = setTimeout(step, cursor.current.line === 0 && cursor.current.char === 0 ? 350 : 200)
    return clear
  }, [run, armed, paused, reduced, step])

  const replay = () => {
    clear()
    cursor.current = { line: 0, char: 0 }
    setShown(0)
    setPartial(0)
    setPaused(false)
    setArmed(true)
    setRun((r) => r + 1)
  }

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [shown, partial, reduced])

  const typing = !finished && shown < total && LINES[shown]?.type && partial > 0
  const progress = reduced ? 100 : Math.round(((shown + (typing ? 0.5 : 0)) / total) * 100)
  // The strip wears the done glow once the HIRE signature (the first beat) lands.
  const hireLanded = shown > LINES.findIndex((l) => l.beat)

  return (
    <div
      ref={root}
      className={`desktx rounded-2xl border border-[var(--line)] overflow-hidden${hireLanded ? ' desktx--signed' : ''}`}
      data-roster-transcript
      data-roster-state={reduced ? 'static' : finished ? 'done' : paused ? 'paused' : armed ? 'playing' : 'armed'}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
        <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] truncate">
          The Roster loop — a real proof session, one slot end to end
        </span>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!reduced && !finished && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="inline-flex items-center gap-1 mono text-[11px] uppercase tracking-wider text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
              aria-label={paused ? 'Resume the session' : 'Pause the session'}
              aria-pressed={paused}
            >
              {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {paused ? 'Play' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            onClick={replay}
            className={`inline-flex items-center gap-1 mono text-[11px] uppercase tracking-wider transition-colors hover:text-[color:var(--fg)] ${
              finished && !reduced ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted)]'
            }`}
            aria-label="Replay the session"
          >
            <RotateCcw className="w-3 h-3" /> Replay
          </button>
        </div>
      </div>
      <div aria-hidden className={`yprog rounded-none ${finished || reduced ? 'yprog--full' : ''}`} style={{ height: '1px' }}>
        <div className="yprog__fill" style={{ width: `${progress}%` }} />
      </div>
      <div ref={box} className="max-h-[24rem] overflow-y-auto px-4 py-3 space-y-1.5" aria-live="polite">
        {LINES.slice(0, shown).map((l, i) => (
          <p
            key={`${run}-${i}`}
            className={`desktx__line mono text-[12.5px] leading-relaxed text-[color:var(--muted)]${
              l.beat ? ' desktx__line--beat' : ''
            }${l.done ? ' desktx__line--done' : ''}${l.wall ? ' desktx__line--wall' : ''}`}
          >
            <span className={`desktx__who ${TAG[l.who].cls} select-none`}>[{TAG[l.who].label}]</span> {l.text}
          </p>
        ))}
        {typing && (
          <p className="desktx__line mono text-[12.5px] leading-relaxed text-[color:var(--muted)]" aria-hidden>
            <span className={`desktx__who ${TAG[LINES[shown].who].cls} select-none`}>[{TAG[LINES[shown].who].label}]</span>{' '}
            {LINES[shown].text.slice(0, partial)}
            <span className="desktx__caret">▍</span>
          </p>
        )}
        {!typing && !finished && !reduced && (
          <p className="mono text-[12.5px] text-[color:var(--muted-2)] select-none" aria-hidden>
            <span className={`desktx__caret${paused ? ' desktx__caret--held' : ''}`}>▍</span>
          </p>
        )}
      </div>
    </div>
  )
}
