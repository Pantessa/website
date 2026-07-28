'use client'

// THE MACHINE — the landing's centerpiece. Not a screenshot of the product:
// a runnable model of it. Pick one of four real house asks and watch the
// sentence walk the stages the runtime actually walks — read, scan, plan,
// build, guard, sign, settle — with the artifacts printing as they land.
//
// Three rules this component keeps:
//   1. Truthful endings. A buy ends in a receipt, a stop ends ARMED, a DCA
//      ends SCHEDULED. The scripts live in lib/machine-runs.ts and each CTA
//      opens the seeded /i/<slug> that runs THAT ask for real.
//   2. It never lies about being live. The footer says so, and the CTA to the
//      real link sits right next to it.
//   3. It idles until seen (IntersectionObserver), pauses when the tab is
//      hidden, and renders every stage complete-and-still under
//      prefers-reduced-motion — the whole story is readable with zero motion.
//
// The clock is one rAF loop over elapsed-ms so a background tab can't
// desync it (setInterval drift + the document.hidden freeze both bite here).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Play, RotateCcw } from 'lucide-react'
import { getProtocolMark } from '@/components/protocol-marks'
import { getChainMark } from '@/components/chain-marks'
import { MACHINE_RUNS, runDuration, type MachineRun, type StageTone } from '@/lib/machine-runs'

/** Elapsed ms → { stage index, ms into that stage }. */
function locate(run: MachineRun, elapsed: number) {
  let acc = 0
  for (let i = 0; i < run.stages.length; i++) {
    const end = acc + run.stages[i].ms
    if (elapsed < end) return { idx: i, into: elapsed - acc, done: false }
    acc = end
  }
  return { idx: run.stages.length - 1, into: run.stages[run.stages.length - 1].ms, done: true }
}

/** How many artifact lines of the active stage have printed. Lines land on an
 *  even beat across the stage's first 70%, so the last one is readable before
 *  the stage hands over. */
function linesShown(total: number, into: number, ms: number) {
  if (total === 0) return 0
  const per = (ms * 0.7) / total
  return Math.min(total, Math.floor(into / per) + 1)
}

function Marks({ keys }: { keys: string[] }) {
  const marks = keys.map((k) => ({ k, M: getProtocolMark(k) })).filter((m) => m.M)
  if (!marks.length) return null
  return (
    <span className="mach__marks" aria-hidden>
      {marks.map((m, i) => (
        <span className="mach__mark" key={m.k} style={{ zIndex: marks.length - i }}>
          {m.M ? <m.M size={13} /> : null}
        </span>
      ))}
    </span>
  )
}

/** A node badge — chain mark first (Base/Arbitrum/Robinhood are chains, not
 *  MCPs), protocol mark second, lettermark last. */
function NodeMark({ mark, name }: { mark?: string; name: string }) {
  const Chain = getChainMark(mark ?? null)
  const Proto = Chain ? null : getProtocolMark(mark)
  if (Chain) return <Chain size={19} />
  if (Proto) return <Proto size={19} />
  return <span className="mach__nodeletter">{name.slice(0, 1)}</span>
}

/** The route, assembling. Every reveal is keyed off which stage TONE the run
 *  has reached, so a run with no SCAN (cross-chain) or no SIGN never waits on
 *  a stage it doesn't have. The whole thing is inert markup + CSS classes —
 *  no rAF of its own, and it reads correctly frozen at any stage. */
function RouteDiagram({ run, reached }: { run: MachineRun; reached: (t: StageTone) => boolean }) {
  const g = run.graph
  const on = {
    bal: reached('scan') || reached('plan') || reached('build'),
    plan: reached('plan') || reached('build'),
    built: reached('build'),
    guard: reached('guard'),
    sign: reached('sign'),
    done: reached('settle'),
  }
  return (
    <div
      className={`mach__route${on.bal ? ' r-bal' : ''}${on.plan ? ' r-plan' : ''}${on.built ? ' r-built' : ''}${on.guard ? ' r-guard' : ''}${on.sign ? ' r-sign' : ''}${on.done ? ' r-done' : ''}`}
      aria-hidden
    >
      <div className="mach__routetop mono">
        <span>THE PATH</span>
        <span className="mach__routestate">
          {on.done ? 'settled' : on.sign ? 'signing' : on.built ? 'built' : on.plan ? 'planned' : 'scanning'}
        </span>
      </div>
      <div className="mach__nodes">
        <div className="mach__node">
          <span className="mach__nodeicon">
            <NodeMark mark={g.from.mark} name={g.from.name} />
          </span>
          <span className="mach__nodename">{g.from.name}</span>
          <span className="mach__nodesub mono">{g.from.sub}</span>
        </div>

        <div className="mach__legs">
          {g.legs.map((l, i) => (
            <div className="mach__leg" key={l.label} style={{ ['--i' as string]: i }}>
              <span className="mach__legwire">
                <span className="mach__legspark" />
              </span>
              <span className="mach__leglabel mono">{l.label}</span>
            </div>
          ))}
          <span className="mach__shield mono">
            <span className="mach__shieldring" />
            guardrails
          </span>
        </div>

        <div className="mach__node mach__node--to">
          <span className="mach__nodeicon">
            <NodeMark mark={g.to.mark} name={g.to.name} />
          </span>
          <span className="mach__nodename">{g.to.name}</span>
          <span className="mach__nodesub mono">{g.to.sub}</span>
          <span className="mach__stampchip mono">{g.terminal}</span>
        </div>
      </div>
      <p className="mach__routefoot mono">
        {on.done
          ? 'Receipted. The tx hash is public.'
          : on.guard
            ? 'Nothing crosses the gate unproven.'
            : 'Money is somewhere. The ask needs it somewhere else.'}
      </p>
    </div>
  )
}

/** Word-level tokenizer: highlight the pill phrases in the ask WITHOUT ever
 *  matching inside a word. A naive `/HYPE/i` lights up the "Hype" in
 *  "Hyperliquid"; `\b` can't help because pills start with `$` and end with
 *  `%`. So walk whole words instead and compare phrase-by-phrase. */
function markUp(ask: string, pills: { t: string; k: string }[]) {
  const words = ask.split(/(\s+)/) // keeps the separators as odd entries
  const bare = (s: string) => s.replace(/[.,;:!?]+$/, '').toLowerCase()
  const out: { text: string; k?: string }[] = []
  let i = 0
  while (i < words.length) {
    if (/^\s+$/.test(words[i])) {
      out.push({ text: words[i] })
      i++
      continue
    }
    const hit = pills.find((p) => {
      const parts = p.t.split(/\s+/)
      const slice: string[] = []
      for (let n = 0, j = i; n < parts.length && j < words.length; j++) {
        if (/^\s+$/.test(words[j])) continue
        slice.push(words[j])
        n++
      }
      return slice.length === parts.length && bare(slice.join(' ')) === bare(p.t)
    })
    if (hit) {
      const n = hit.t.split(/\s+/).length
      let taken = 0
      const chunk: string[] = []
      while (i < words.length && taken < n) {
        if (!/^\s+$/.test(words[i])) taken++
        chunk.push(words[i])
        i++
      }
      out.push({ text: chunk.join(''), k: hit.k })
    } else {
      out.push({ text: words[i] })
      i++
    }
  }
  return out
}

/** The ask, with the parsed phrases lit up — and the spec they became,
 *  landing as chips underneath. (The keys used to float above each word;
 *  adjacent tokens collided into "LEVERAGESIDE". A chip row can't collide.) */
function Sentence({ run, read }: { run: MachineRun; read: boolean }) {
  const parts = useMemo(() => markUp(run.ask, run.pills), [run])
  return (
    <>
      <p className="mach__ask">
        <span className="mach__quote" aria-hidden>
          “
        </span>
        {parts.map((p, i) =>
          p.k ? (
            <span className={`mach__tok${read ? ' is-read' : ''}`} key={i}>
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        <span className="mach__quote" aria-hidden>
          ”
        </span>
      </p>
      <div className={`mach__spec${read ? ' is-read' : ''}`} aria-hidden>
        {run.pills.map((p, i) => (
          <span className="mach__chip mono" key={p.k} style={{ ['--d' as string]: `${i * 90}ms` }}>
            <b>{p.k}</b>
            {p.t}
          </span>
        ))}
      </div>
    </>
  )
}

export default function IntentMachine() {
  const [runIdx, setRunIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** Set once the section has been seen — the machine never runs off-screen. */
  const [armed, setArmed] = useState(false)
  const [still, setStill] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const run = MACHINE_RUNS[runIdx]
  const total = runDuration(run)
  const { idx, into, done } = still
    ? { idx: run.stages.length - 1, into: 99999, done: true }
    : locate(run, elapsed)
  const stage = run.stages[idx]

  // Reduced motion: render the whole run complete and still. The story is the
  // copy, not the animation — it must survive with the animation removed.
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setStill(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Arm on first sight, and auto-start the first run there — the machine
  // should already be mid-thought when you arrive at it.
  useEffect(() => {
    const el = sectionRef.current
    if (!el || armed) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setArmed(true)
          setPlaying(true)
          io.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [armed])

  // The clock. One rAF over wall-clock deltas; hidden tabs and off-screen
  // scroll both park it rather than racing ahead.
  useEffect(() => {
    if (!playing || still) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(80, now - last)
      last = now
      if (!document.hidden) {
        setElapsed((e) => {
          const next = e + dt
          if (next >= total) {
            setPlaying(false)
            return total
          }
          return next
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, still, total])

  // Keep the newest artifact line in view inside the log column.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [idx, elapsed])

  const pick = useCallback((i: number) => {
    setRunIdx(i)
    setElapsed(0)
    setPlaying(true)
  }, [])

  const jump = useCallback(
    (target: number) => {
      let acc = 0
      for (let i = 0; i < target; i++) acc += run.stages[i].ms
      setElapsed(acc)
      setPlaying(true)
    },
    [run],
  )

  const shown = still ? stage.lines.length : linesShown(stage.lines.length, into, stage.ms)
  const pct = still ? 100 : Math.min(100, (elapsed / total) * 100)
  const readDone = still || idx > 0 || into > run.stages[0].ms * 0.45
  /** Has the run walked past (or into) a stage of this tone yet? The route
   *  diagram reveals off tones, not indices, so runs with different stage
   *  sets stay in step. */
  const reached = useCallback(
    (t: StageTone) => {
      if (still) return true
      const at = run.stages.findIndex((s) => s.tone === t)
      return at !== -1 && idx >= at
    },
    [run, idx, still],
  )

  return (
    <section className="mach" id="machine" ref={sectionRef}>
      <div className="mach__head">
        <span className="mach__eyebrow mono">THE MACHINE</span>
        <h2 className="mach__h2">
          Watch a sentence <span className="x-grad">become multiple transactions.</span>
        </h2>
        <p className="mach__sub">
          Almost nothing worth asking for is one transaction. Pick an ask and the same stages your
          users walk run right here — the wallet scan, the funding plan, the pinned builder, the
          guardrails that fail closed, the signatures that are only ever theirs. Four asks, four
          different endings. That difference is the whole product.
        </p>
      </div>

      {/* the four real asks */}
      <div className="mach__tabs" role="tablist" aria-label="Choose an ask to run">
        {MACHINE_RUNS.map((r, i) => (
          <button
            key={r.slug}
            role="tab"
            aria-selected={i === runIdx}
            className={`mach__tab${i === runIdx ? ' is-on' : ''}`}
            onClick={() => pick(i)}
          >
            <Marks keys={r.marks} />
            <span className="mach__tabname">{r.tab}</span>
          </button>
        ))}
      </div>

      <div className="mach__console">
        {/* ── the ask, parsed in place ─────────────────────────── */}
        <div className="mach__top">
          <Sentence run={run} read={readDone} />
          <p className="mach__premise mono">{run.premise}</p>
        </div>

        <div className="mach__bar" aria-hidden>
          <span className="mach__barfill" style={{ width: `${pct}%` }} />
        </div>

        <div className="mach__body">
          {/* ── the stage rail ─────────────────────────────────── */}
          <ol className="mach__rail">
            {run.stages.map((s, i) => (
              <li
                key={s.key}
                className={`mach__stage${i === idx ? ' is-live' : ''}${i < idx || (done && i === idx) ? ' is-done' : ''} mach__stage--${s.tone}`}
              >
                <button className="mach__stagebtn" onClick={() => jump(i)}>
                  <span className="mach__dot" aria-hidden />
                  <span className="mach__stagekey mono">{s.key}</span>
                </button>
              </li>
            ))}
          </ol>

          {/* ── what just happened ─────────────────────────────── */}
          <div className={`mach__panel mach__panel--${stage.tone}`}>
            <p className="mach__headline" key={`${runIdx}-${idx}`}>
              {stage.head}
            </p>
            <div className="mach__log" ref={logRef}>
              {stage.lines.map((l, i) => {
                const warn = l.startsWith('!')
                const ok = l.startsWith('✓')
                return (
                  <p
                    key={`${runIdx}-${idx}-${i}`}
                    className={`mach__line mono${warn ? ' is-warn' : ''}${ok ? ' is-ok' : ''}${i < shown ? ' is-in' : ''}`}
                  >
                    {l}
                  </p>
                )
              })}
            </div>
            {(done || still) && (
              <div className="mach__outcome mono">
                <span className="mach__stamp">{run.outcome}</span>
                <span className="mach__stampsub">
                  and it never held a key of yours to do it
                </span>
              </div>
            )}
          </div>

          {/* ── the route, assembling ──────────────────────────── */}
          <RouteDiagram run={run} reached={reached} />
        </div>

        <div className="mach__foot">
          <span className="mono mach__disclose">
            A model of the turn — not a live wallet. The link runs it for real.
          </span>
          <div className="mach__acts">
            <button
              className="mach__ctl mono"
              onClick={() => {
                setElapsed(0)
                setPlaying(true)
              }}
            >
              {playing ? <RotateCcw size={13} /> : <Play size={13} />}{' '}
              {playing ? 'Replay' : elapsed >= total ? 'Run it again' : 'Play'}
            </button>
            <Link className="mach__cta" href={`/i/${run.slug}`}>
              Open the real link <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
