'use client'

// U4 — the desk conversation, made visible. A replayable strip of a REAL
// two-agent exchange (scripts/desk-demo.ts, run 2026-08-17 — the M7 loop:
// negotiate → handoff → the human signs → the agent hears back). Lines land
// sequentially like a terminal session; replay restarts it. Static content,
// no network: the point is that a stranger GETS the product in ten seconds.
//
// Launch-clip pass (squad visuals, 2026-08-18): this strip IS the clip's
// storyboard, so it has to read like one — the agent's opening ask TYPES
// (the hook), the desk answers after a thinking beat, the human's lines
// wait a little longer (a person is doing things), and "signed ✓" is THE
// beat: a held pause, then the line lands with a pulse and the desk's
// SIGNED status turns the done colour. It starts when it scrolls into view
// (never finished before anyone looks), can be paused, and reduced-motion
// readers get the whole session at once. Pure CSS + timers, no deps.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'

type Who = 'agent' | 'desk' | 'human'

type Line = {
  who: Who
  text: string
  /** Extra hold before this line lands (ms) — the pause is the drama. */
  hold?: number
  /** Type the line character by character (the agent speaking). */
  type?: boolean
  /** The signed moment — the strip's beat. */
  beat?: boolean
  /** The desk's verdict after the beat — rendered in the done colour. */
  done?: boolean
}

const LINES: Line[] = [
  { who: 'agent', text: 'I need this done for my human: "Buy $15 of AAPL"', type: true },
  { who: 'desk', text: "Pantessa's swap layer will compile this deterministically — no model writes calldata — and guard-check the whole path before anyone signs.", hold: 500 },
  { who: 'desk', text: 'options: proceed · walk away · (funding routes appear when the wallet is short)' },
  { who: 'agent', text: 'quote accepted — proceed as asked', type: true, hold: 300 },
  { who: 'desk', text: 'sign link minted: pantessa.com/i/5xuv45jq', hold: 400 },
  { who: 'agent', text: 'handing the link to my human…', type: true },
  { who: 'human', text: 'opened the link — the ask and the guardrail contract, in plain words', hold: 700 },
  { who: 'human', text: 'connected a wallet — the guarded build runs', hold: 500 },
  { who: 'human', text: 'signed ✓', hold: 1300, beat: true },
  { who: 'desk', text: 'status: SIGNED — moved through the guarded path', hold: 350, done: true },
  { who: 'agent', text: 'my human signed — the loop is closed, and I never touched a transaction byte.', type: true, hold: 300 },
]

/* Role inks are theme-aware tokens, never dark-only utilities: sky-400 and
   amber-400 read ~1.8:1 on paper. Light values are the deep kin of the same
   hues (see the html[data-theme='light'] block in x402-design.css). */
const TAG: Record<Who, { label: string; cls: string }> = {
  agent: { label: 'agent', cls: 'desktx__who--agent' },
  desk: { label: 'desk', cls: 'desktx__who--desk' },
  human: { label: 'human', cls: 'desktx__who--human' },
}

const BASE_GAP = 420 // ms between whole lines, before per-line holds
const READ_MS_PER_CHAR = 7 // reading time for the line that just landed
const TYPE_MS_PER_CHAR = 22 // the agent's typing speed

export default function DeskTranscript() {
  // shown = lines fully on screen; partial = chars of the line being typed.
  const [shown, setShown] = useState(0)
  const [partial, setPartial] = useState(0)
  const [run, setRun] = useState(0)
  const [paused, setPaused] = useState(false)
  const [armed, setArmed] = useState(false) // scrolled into view once
  const [reduced, setReduced] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The scheduler's own cursor (state is for paint; refs drive the clock so
  // pause/resume never double-schedules).
  const cursor = useRef({ line: 0, char: 0 })

  const total = LINES.length
  const finished = shown >= total

  // Reduced motion: the whole session, at once, forever.
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Arm on first sight — a strip that ran while it was below the fold is a
  // strip nobody saw. Falls open immediately without IntersectionObserver.
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
    // Insurance: a viewport that never reports intersection (a 0-height
    // headless pane, a hidden iframe) must not leave an empty terminal
    // forever — arm anyway after a beat.
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

  // One step of the clock: either type the next char of a typed line, or
  // land the next whole line after its hold + the previous line's read time.
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
    // Land the line.
    cursor.current = { line: line + 1, char: 0 }
    setShown(line + 1)
    setPartial(0)
    const next = LINES[line + 1]
    if (!next) return
    let delay = BASE_GAP + (next.hold ?? 0) + Math.min(cur.text.length * READ_MS_PER_CHAR, 700)
    if (next.type) delay = Math.max(240, delay - 200) // typing IS the wait
    timer.current = setTimeout(step, delay)
  }, [])

  // The clock: (re)starts on run, holds while paused, and is skipped
  // entirely for reduced-motion readers (everything shown, static).
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
    // First landing waits a breath so the viewer sees an empty terminal
    // become a session; a typed first line starts typing right away.
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
  const beatLanded = shown > LINES.findIndex((l) => l.beat)

  return (
    <div
      ref={root}
      className={`desktx rounded-2xl border border-[var(--line)] overflow-hidden${beatLanded ? ' desktx--signed' : ''}`}
      data-desk-transcript
      data-desk-state={reduced ? 'static' : finished ? 'done' : paused ? 'paused' : armed ? 'playing' : 'armed'}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2">
        <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] truncate">
          A real desk session — two agents, one human signature
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
      {/* The run's arc as a line — .yprog is the site's ONE progress vocabulary. */}
      <div aria-hidden className={`yprog rounded-none ${finished || reduced ? 'yprog--full' : ''}`} style={{ height: '1px' }}>
        <div className="yprog__fill" style={{ width: `${progress}%` }} />
      </div>
      <div ref={box} className="max-h-[22rem] overflow-y-auto px-4 py-3 space-y-1.5" aria-live="polite">
        {LINES.slice(0, shown).map((l, i) => (
          <p
            key={`${run}-${i}`}
            className={`desktx__line mono text-[12.5px] leading-relaxed text-[color:var(--muted)]${
              l.beat ? ' desktx__line--beat' : ''
            }${l.done ? ' desktx__line--done' : ''}`}
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
