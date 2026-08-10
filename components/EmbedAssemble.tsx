'use client'

// THE INSTALL, ASSEMBLING — the same grammar as the machine, applied to the
// five lines. The snippet types itself line by line, and each line BUILDS
// something in the host window beside it: `mode` puts the bubble on the page,
// `mcps` loads the marks into it, `wallet: 'auto'` wires it to the wallet the
// host page already has. The last beat runs a turn through the finished thing.
//
// The point is causality: you can see which line bought which capability.
// A static code block can't say that, and the docs' EmbedDemo (still used at
// /docs) shows the widget's behaviour rather than its install.
//
// One rAF over elapsed-ms, IntersectionObserver-gated, and under
// prefers-reduced-motion it renders fully assembled and still — the snippet
// is the same five real lines either way.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { UniswapMark, SnapshotMark, YeetfulMark } from '@/components/protocol-marks'

/** The real install, split so each line can own a beat. Line 0 (the import)
 *  lands with the panel; the rest each buy something visible. */
const LINES: string[] = [
  "import { mountPantessaChat } from 'pantessa/embed'",
  '',
  'mountPantessaChat({',
  "  mode: 'bubble',",
  "  mcps: ['uniswap-free', 'snapshot-free'],",
  "  wallet: 'auto', // the host page's wallet signs",
  '})',
]

/** Beat → what it just bought you, and how far down the snippet it has typed. */
const BEATS: { upto: number; ms: number; note: string }[] = [
  { upto: 3, ms: 1500, note: 'the package, and one call' },
  { upto: 4, ms: 1800, note: 'a bubble, bottom-right of your page' },
  { upto: 5, ms: 2000, note: 'the set it answers with — swaps and votes, live' },
  { upto: 6, ms: 2200, note: 'the wallet your page already has. Signatures pop there.' },
  { upto: 7, ms: 3200, note: 'and it moves money. Receipted, on your site.' },
]
const TOTAL = BEATS.reduce((n, b) => n + b.ms, 0)

export default function EmbedAssemble() {
  const [t, setT] = useState(0)
  const [still, setStill] = useState(false)
  const [live, setLive] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setStill(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => setLive(es.some((e) => e.isIntersecting)), {
      threshold: 0.2,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!live || still) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(80, now - last)
      last = now
      if (!document.hidden) setT((x) => (x + dt) % (TOTAL + 1800))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live, still])

  // Which beat we're on. The loop's tail (past TOTAL) holds the finished
  // state for a moment before restarting — a build that snaps back to empty
  // the instant it completes reads as a stutter.
  let beat = 0
  if (still) beat = BEATS.length - 1
  else {
    let acc = 0
    for (let i = 0; i < BEATS.length; i++) {
      acc += BEATS[i].ms
      if (t < acc) {
        beat = i
        break
      }
      beat = BEATS.length - 1
    }
  }
  const upto = BEATS[beat].upto
  const on = (n: number) => beat >= n

  return (
    <div className="asm" ref={ref}>
      {/* the five lines, typing */}
      <div className="asm__code">
        <div className="asm__codebar mono">
          <span>npm i pantessa</span>
          <span className="asm__ver">v0.9</span>
        </div>
        <pre className="asm__pre mono">
          {LINES.map((l, i) => (
            <span className={`asm__line${i < upto ? ' is-in' : ''}`} key={i}>
              {l || ' '}
            </span>
          ))}
        </pre>
        <p className="asm__note mono" key={beat}>
          <b>↳</b> {BEATS[beat].note}
        </p>
        <Link href="/docs/embed" className="asm__docs mono">
          Read the embed docs →
        </Link>
      </div>

      {/* the host page, gaining an agent */}
      <div className="asm__host" aria-hidden>
        <div className="asm__chrome">
          <span className="asm__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="asm__url mono">your-app.com</span>
          <span className={`asm__wallet mono${on(3) ? ' is-on' : ''}`}>
            {on(3) ? '0x5E…55a0 · connected' : 'connect wallet'}
          </span>
        </div>

        <div className="asm__page">
          <span className="asm__sk asm__sk--h" />
          <span className="asm__sk asm__sk--a" />
          <span className="asm__sk asm__sk--b" />
          <span className="asm__sk asm__sk--c" />
          <span className="asm__sk asm__sk--d" />

          {/* the wire from the host wallet down to the bubble */}
          <span className={`asm__wire${on(3) ? ' is-on' : ''}`} />

          {/* the turn, once everything is wired */}
          <div className={`asm__turn${on(4) ? ' is-on' : ''}`}>
            <span className="asm__ask">Swap $50 of USDC for ETH</span>
            <span className="asm__built mono">
              ⇄ built on Uniswap · ✓ guardrails · ✍ sign in your wallet
            </span>
            <span className="asm__receipt mono">✓ receipted · tx 0x9f2e…41c7 ↗</span>
          </div>

          <div className={`asm__bubble${on(1) ? ' is-on' : ''}`}>
            <span className={`asm__marks${on(2) ? ' is-on' : ''}`}>
              <i>
                <UniswapMark size={13} />
              </i>
              <i>
                <SnapshotMark size={13} />
              </i>
            </span>
            <span className="asm__bubbleicon">
              <YeetfulMark size={17} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
