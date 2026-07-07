'use client'

// The pivot hero — "every dapp, one chat". Left: the claim. Right: the merge
// stage — MCP chips stream animated beams into a browser frame where one
// agent runs a multi-MCP turn. The frame REPLAYS a real session by default
// (zero cost) and swaps to the LIVE /embed iframe on click ("Try it live"),
// dogfooding yeetful/embed inline mode on our own homepage. The iframe is
// same-origin (/embed serves frame-ancestors *), scoped to the live free
// MCPs; the click gate keeps drive-by house-wallet spend near zero.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const EMBED_SRC = '/embed?mcps=uniswap-free,snapshot-free&theme=dark'

/** The staged replay — mirrors turns proven E2E on the embed forks. */
type Step = { kind: 'user' | 'plan' | 'agent' | 'guard' | 'sign' | 'receipt'; text: string }
const SCENES: Step[][] = [
  [
    { kind: 'user', text: 'Quote 1 WETH → USDC, and any active aave.eth proposals?' },
    { kind: 'plan', text: 'uniswap-free · quote  +  snapshot-free · proposals' },
    {
      kind: 'agent',
      text: '1 WETH ≈ 1,778.79 USDC on Base (v3, best pool). aave.eth has 3 active proposals — the treasury vote closes in 2 days.',
    },
    { kind: 'receipt', text: '✓ 2 MCPs · one turn · $0.00 · receipted' },
  ],
  [
    { kind: 'user', text: 'Swap 2 USDC for WETH, then vote FOR the treasury proposal' },
    { kind: 'plan', text: 'uniswap-free · build_swap  →  snapshot-free · vote' },
    { kind: 'guard', text: 'Guardrails: under your $5/day cap · approve → swap re-quoted per step' },
    { kind: 'sign', text: 'Signs in YOUR wallet, on the host page — keys never leave it' },
  ],
]

const CHIPS = [
  { glyph: '◇', name: 'Uniswap' },
  { glyph: '▤', name: 'Snapshot' },
  { glyph: '◆', name: 'CoW + docs' },
  { glyph: '+', name: 'your MCP', dashed: true },
]

// Beam geometry — chip anchors converge on the frame's agent port. Rendered
// with preserveAspectRatio="none" so the coords track the stage width.
const BEAMS = [
  'M 50 8 C 50 52, 170 60, 196 86',
  'M 150 8 C 150 48, 186 58, 198 86',
  'M 250 8 C 250 48, 214 58, 202 86',
  'M 350 8 C 350 52, 230 60, 204 86',
]

function Replay() {
  const [scene, setScene] = useState(0)
  const [shown, setShown] = useState(1)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      // no message-by-message theater — show the first scene whole
      setScene(0)
      setShown(SCENES[0].length)
      return
    }
    const steps = SCENES[scene]
    let t: ReturnType<typeof setTimeout>
    if (shown < steps.length) {
      t = setTimeout(() => setShown((s) => s + 1), shown === 1 ? 1100 : 1300)
    } else {
      t = setTimeout(() => {
        setScene((sc) => (sc + 1) % SCENES.length)
        setShown(1)
      }, 4200)
    }
    return () => clearTimeout(t)
  }, [scene, shown])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [shown])

  return (
    <div className="mhero__replay" ref={bodyRef} aria-label="Replay of a real chat session">
      {SCENES[scene].slice(0, shown).map((s, i) => (
        <div className={`mhero__msg mhero__msg--${s.kind}`} key={`${scene}-${i}`}>
          {s.kind === 'plan' && <span className="mhero__msgtag mono">picks tools</span>}
          {s.kind === 'guard' && <span className="mhero__msgtag mhero__msgtag--guard mono">policy gate</span>}
          {s.text}
        </div>
      ))}
    </div>
  )
}

export default function HomeHero() {
  const [live, setLive] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const goLive = () => {
    setLive(true)
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section className="mhero">
      <div className="mhero__glow" aria-hidden="true" />
      <div className="mhero__grid">
        <div className="mhero__copy">
          <div className="mhero__eyebrow mono">
            Compose MCPs <span>·</span> one agent <span>·</span> <b>embed anywhere</b>
          </div>
          <h1 className="mhero__h1">
            Every dapp.
            <br />
            <span className="mhero__em">One chat.</span>
          </h1>
          <p className="mhero__lede">
            Pick a few MCPs — <strong>Uniswap, Snapshot, CoW, or your own</strong> — and Yeetful
            merges them into one agent that swaps, votes, and answers from your docs. Every
            transaction is built with guardrails, <strong>signed by the user&rsquo;s own wallet</strong>,
            and receipted. Embed it on any site in five lines.
          </p>
          <div className="mhero__ctas">
            <button className="btn btn--solid" onClick={goLive}>
              Try it live
            </button>
            <Link className="btn btn--ghost" href="/docs/embed">
              Get the embed
            </Link>
          </div>
          <div className="mhero__proof mono">
            <div className="mhero__pitem">
              <div className="mhero__pnum">70+</div>
              <div className="mhero__plbl">MCPs to compose</div>
            </div>
            <div className="mhero__psep" />
            <div className="mhero__pitem">
              <div className="mhero__pnum">5</div>
              <div className="mhero__plbl">lines to embed</div>
            </div>
            <div className="mhero__psep" />
            <div className="mhero__pitem">
              <div className="mhero__pnum">$0</div>
              <div className="mhero__plbl">to try · free MCPs</div>
            </div>
          </div>
        </div>

        <div className="mhero__stage" ref={stageRef}>
          <div className="mhero__chips" aria-hidden="true">
            {CHIPS.map((c) => (
              <span className={`mhero__chip mono${c.dashed ? ' mhero__chip--dashed' : ''}`} key={c.name}>
                <i>{c.glyph}</i> {c.name}
              </span>
            ))}
          </div>

          <svg
            className="mhero__beams"
            viewBox="0 0 400 90"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {BEAMS.map((d, i) => (
              <path className="mhero__beam" d={d} key={i} id={`mhb-${i}`} />
            ))}
            {BEAMS.map((_, i) => (
              <circle className="mhero__pulse" r="2.6" key={`p-${i}`}>
                <animateMotion dur={`${2.6 + i * 0.5}s`} begin={`${i * 0.65}s`} repeatCount="indefinite">
                  <mpath href={`#mhb-${i}`} />
                </animateMotion>
              </circle>
            ))}
          </svg>

          <div className="mhero__frame">
            <div className="mhero__framebar">
              <span className="mhero__framedots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="mhero__frameurl mono">yourdapp.xyz</span>
              <span className="mhero__framebadge mono">
                <i /> Yeetful chat
              </span>
            </div>
            <div className="mhero__framebody">
              {live ? (
                <iframe
                  className="mhero__iframe"
                  src={EMBED_SRC}
                  title="Yeetful chat — live"
                  allow="clipboard-write"
                />
              ) : (
                <Replay />
              )}
            </div>
            {!live && (
              <button className="mhero__go" onClick={() => setLive(true)}>
                <span className="mhero__goplay" aria-hidden="true">
                  ▶
                </span>
                Try it live — real answers, free MCPs
              </button>
            )}
          </div>
          <div className="mhero__stagecap mono">
            {live
              ? 'Live — the same /embed any site can iframe. Uniswap + Snapshot, one agent.'
              : 'Replay of a real session. Press play to ask it yourself.'}
          </div>
        </div>
      </div>
    </section>
  )
}
