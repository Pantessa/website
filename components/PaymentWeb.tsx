'use client'

// The Payment Web — the hero's signature visual. One agent wallet (hub) pays
// any MCP server (nodes) per call over x402. Emerald beams travel hub→node
// and settle (402→200); ~a third of spawns target an over-cap server, hit the
// budget guardrail partway, turn red, and bounce back to the wallet — money
// the guardrail saved, not spent. Static scene is declarative SVG; beams run
// on a rAF loop; the particle field is compositor-driven CSS. Design package:
// SPEC/IMPLEMENTATION in the "Yeetful hero" handoff (2026-06-13).

import { useEffect, useRef, type RefObject } from 'react'

// [name, glyph, category, per-call price, x, y, depth-scale]
const SERVERS: [string, string, string, number, number, number, number][] = [
  ['Pinata', 'P', 'Infra', 0.001, 868, 150, 0.92],
  ['Helius', '⬢', 'Infra', 0.0008, 1182, 206, 0.66],
  ['2Captcha', 'C', 'Infra', 0.01, 1006, 300, 0.86],
  ['Replicate', 'R', 'Inference', 0.009, 760, 252, 0.8],
  ['Venice', 'V', 'Inference', 0.001, 944, 402, 0.92],
  ['StablePhone', 'S', 'Infra', 0.05, 1238, 402, 0.72],
  ['DeepSeek', '◇', 'Inference', 0.001, 1066, 492, 0.84],
  ['Hunter', 'H', 'Data', 0.03, 1286, 558, 0.66],
  ['Melis', 'M', 'Data', 0.005, 874, 540, 0.74],
  ['Minifetch', 'm', 'Data', 0.001, 742, 470, 0.7],
  ['Tavily', 'T', 'Data', 0.002, 992, 612, 0.6],
  ['Firecrawl', 'F', 'Data', 0.004, 1150, 640, 0.56],
]
// High per-call price = "unproductive overspend" — these routes are capped.
const BLOCKED = new Set(['StablePhone', 'Hunter', '2Captcha'])
const HUB = { x: 640, y: 412 }
const START_BAL = 34.3269
const SVGNS = 'http://www.w3.org/2000/svg'

interface Beam {
  i: number
  t: number
  dir: 1 | -1
  isBlock: boolean
  reach: number
  hit: boolean
  el: SVGCircleElement
}

export default function PaymentWeb({
  proofSpentRef,
  proofBlockedRef,
}: {
  /** Proof-row "$ settled" span in the hero copy — kept in sync with the HUD. */
  proofSpentRef: RefObject<HTMLSpanElement | null>
  /** Proof-row "$ over-cap" span in the hero copy. */
  proofBlockedRef: RefObject<HTMLSpanElement | null>
}) {
  const particlesRef = useRef<HTMLDivElement>(null)
  const netgRef = useRef<SVGGElement>(null)
  const beamLayerRef = useRef<SVGGElement>(null)
  const nodeRefs = useRef<(SVGGElement | null)[]>([])
  const edgeRefs = useRef<(SVGLineElement | null)[]>([])
  const balRef = useRef<HTMLElement>(null)
  const callsRef = useRef<HTMLDivElement>(null)
  const spentRef = useRef<HTMLSpanElement>(null)
  const declinedRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── background particle field (pure CSS animation, built once) ──
    const pc = particlesRef.current
    if (pc) {
      const N = Math.round(Math.min(84, window.innerWidth / 17))
      let h = ''
      for (let i = 0; i < N; i++) {
        const size = (Math.random() * 2.4 + 0.7).toFixed(2)
        const left = (Math.random() * 100).toFixed(2)
        const dur = Math.random() * 26 + 16
        const delay = (-Math.random() * dur).toFixed(1)
        const op = Math.random() * 0.4 + 0.1
        const drift = (Math.random() * 64 - 32).toFixed(0)
        const bg = Math.random() < 0.22 ? `background:rgba(52,227,160,${(op * 1.15).toFixed(2)})` : ''
        h += `<span class="pw-pt" style="left:${left}%;width:${size}px;height:${size}px;opacity:${op.toFixed(2)};--drift:${drift}px;animation-duration:${dur.toFixed(1)}s;animation-delay:${delay}s;${bg}"></span>`
      }
      pc.innerHTML = h
    }

    // ── live counters (direct DOM writes — no React re-render per beam) ──
    let calls = 0
    let spent = 0
    let declined = 0
    let blockedAmt = 0
    const set = (el: Element | null, txt: string) => {
      if (el) el.textContent = txt
    }

    const flash = (el: SVGGElement | null, cls: string) => {
      if (!el) return
      el.classList.remove(cls)
      void el.getBoundingClientRect() // restart the CSS animation
      el.classList.add(cls)
      setTimeout(() => el.classList.remove(cls), 1500)
    }

    const success = (i: number) => {
      const [name, , cat, price] = SERVERS[i]
      calls++
      spent += price
      flash(nodeRefs.current[i], 'is-settle')
      const edge = edgeRefs.current[i]
      if (edge) {
        edge.classList.add('is-hot')
        setTimeout(() => edge.classList.remove('is-hot'), 600)
      }
      set(callsRef.current, String(calls))
      set(spentRef.current, spent.toFixed(2))
      set(balRef.current, (START_BAL - spent).toFixed(4))
      set(proofSpentRef.current, spent.toFixed(2))
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">${name}</span> ${cat} <span class="pw-amt">−$${price.toFixed(4)}</span><br/><span class="pw-ok">402→200</span> settled · no key`
    }

    const decline = (i: number) => {
      const [name, , cat, price] = SERVERS[i]
      declined++
      blockedAmt += price // money NOT spent — the guardrail caught it
      flash(nodeRefs.current[i], 'is-declined')
      set(declinedRef.current, String(declined))
      set(proofBlockedRef.current, blockedAmt.toFixed(2))
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">${name}</span> ${cat} <span class="pw-amt pw-amt--red">blocked</span><br/><span class="pw-decl">DECLINED</span> · over budget cap`
    }

    // ── guardrail beam system ──
    const beams: Beam[] = []
    const allowed: number[] = []
    const capped: number[] = []
    SERVERS.forEach(([name], i) => (BLOCKED.has(name) ? capped : allowed).push(i))

    const el = (n: string, a: Record<string, string | number>) => {
      const e = document.createElementNS(SVGNS, n)
      for (const k in a) e.setAttribute(k, String(a[k]))
      return e
    }

    const spawnBeam = () => {
      const layer = beamLayerRef.current
      if (!layer || document.hidden || beams.length > 40) return
      let i: number
      let isBlock: boolean
      if (capped.length && Math.random() < 0.34) {
        i = capped[(Math.random() * capped.length) | 0]
        isBlock = true
      } else {
        i = allowed[(Math.random() * allowed.length) | 0]
        isBlock = false
      }
      const c = el('circle', { class: 'pw-beam', r: 3.6, cx: HUB.x, cy: HUB.y }) as SVGCircleElement
      layer.appendChild(c)
      beams.push({ i, t: 0, dir: 1, isBlock, reach: isBlock ? 0.5 + Math.random() * 0.12 : 1, hit: false, el: c })
    }

    // Red ring "ping" where a blocked beam hits the budget barrier.
    const ping = (x: number, y: number) => {
      const layer = beamLayerRef.current
      if (!layer) return
      const ring = el('circle', { class: 'pw-barrier', cx: x, cy: y, r: 4, opacity: 0.9 })
      layer.appendChild(ring)
      ring.appendChild(el('animate', { attributeName: 'r', from: 4, to: 17, dur: '0.5s', fill: 'freeze' }))
      ring.appendChild(el('animate', { attributeName: 'opacity', from: 0.9, to: 0, dur: '0.5s', fill: 'freeze' }))
      setTimeout(() => ring.remove(), 520)
    }

    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      const dt = Math.min(60, now - last) / 1000
      last = now
      for (let b = beams.length - 1; b >= 0; b--) {
        const beam = beams[b]
        const [, , , , nx, ny] = SERVERS[beam.i]
        beam.t += dt * 0.9 * beam.dir
        if (beam.dir > 0 && beam.t >= beam.reach) {
          if (beam.isBlock) {
            beam.t = beam.reach
            beam.dir = -1 // bounce back to the wallet
            if (!beam.hit) {
              beam.hit = true
              beam.el.classList.add('is-red')
              ping(HUB.x + (nx - HUB.x) * beam.reach, HUB.y + (ny - HUB.y) * beam.reach)
              decline(beam.i)
            }
          } else {
            success(beam.i)
            beam.el.remove()
            beams.splice(b, 1)
            continue
          }
        }
        if (beam.dir < 0 && beam.t <= 0) {
          beam.el.remove()
          beams.splice(b, 1)
          continue
        }
        beam.el.setAttribute('cx', String(HUB.x + (nx - HUB.x) * beam.t))
        beam.el.setAttribute('cy', String(HUB.y + (ny - HUB.y) * beam.t))
      }
      raf = requestAnimationFrame(loop)
    }

    // Seed a couple of events so the hero reads instantly, before the first beam lands.
    if (allowed[0] !== undefined) success(allowed[0])
    if (allowed[2] !== undefined) success(allowed[2])
    if (capped[0] !== undefined) decline(capped[0])

    const spawnTimer = setInterval(spawnBeam, reduce ? 1300 : 560)
    raf = requestAnimationFrame(loop)

    // gentle mouse parallax on the whole network
    const onMove = (e: MouseEvent) => {
      const g = netgRef.current
      if (!g) return
      const dx = e.clientX / window.innerWidth - 0.5
      const dy = e.clientY / window.innerHeight - 0.5
      g.style.transform = `translate(${dx * 22}px,${dy * 16}px)`
    }
    if (!reduce) window.addEventListener('mousemove', onMove)

    return () => {
      clearInterval(spawnTimer)
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      beams.forEach((b) => b.el.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div ref={particlesRef} className="heroweb__particles" aria-hidden="true" />
      <svg className="heroweb__net" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g ref={netgRef} className="pw-g">
          {SERVERS.map(([name, , , , x, y], i) => (
            <line
              key={name}
              ref={(n) => {
                edgeRefs.current[i] = n
              }}
              className={BLOCKED.has(name) ? 'pw-edge is-capped' : 'pw-edge'}
              x1={HUB.x}
              y1={HUB.y}
              x2={x}
              y2={y}
            />
          ))}
          {SERVERS.map(([name, glyph, , price, x, y, z], i) => {
            const r = 13 + 9 * z
            const nf = Math.round(11 + 3 * z)
            const pf = Math.round(9 + 2 * z)
            const blocked = BLOCKED.has(name)
            return (
              <g
                key={name}
                ref={(n) => {
                  nodeRefs.current[i] = n
                }}
                className={blocked ? 'pw-node is-blocked' : 'pw-node'}
                transform={`translate(${x},${y})`}
              >
                <circle className="pw-halo" r={r + 5} />
                <circle className="pw-body" r={r} />
                <text className="pw-gly" fontSize={Math.round(9 + 5 * z)}>
                  {glyph}
                </text>
                <text className="pw-nm" x={r + 11} y={-4} fontSize={nf}>
                  {name}
                </text>
                {blocked ? (
                  <text className="pw-capt" x={r + 11} y={nf - 1} fontSize={pf}>
                    ⊘ over cap
                  </text>
                ) : (
                  <text className="pw-pr" x={r + 11} y={nf - 1} fontSize={pf}>
                    ${price.toFixed(4)}
                  </text>
                )}
                <text className="pw-rcpt" y={-(r + 12)} fontSize={12}>
                  402→200
                </text>
                <text className="pw-rdecl" y={-(r + 12)} fontSize={12}>
                  DECLINED
                </text>
              </g>
            )
          })}
          <circle className="pw-hubring" cx={HUB.x} cy={HUB.y} r={18} />
          <circle className="pw-hubring pw-hubring--b" cx={HUB.x} cy={HUB.y} r={18} />
          <circle className="pw-hubcore" cx={HUB.x} cy={HUB.y} r={19} />
          <circle className="pw-hubdot" cx={HUB.x} cy={HUB.y} r={6} />
          <text className="pw-hubname" x={HUB.x} y={HUB.y + 40}>
            NANSEN
          </text>
          <text className="pw-hubsub" x={HUB.x} y={HUB.y + 56}>
            your agent · 1 wallet
          </text>
          <g ref={beamLayerRef} />
        </g>
      </svg>
      <div className="heroweb__veil heroweb__veil--frame" aria-hidden="true" />
      <div className="heroweb__veil heroweb__veil--left" aria-hidden="true" />

      <div className="heroweb__hud" aria-hidden="true">
        <div className="pw-hudtop">
          <div className="pw-hudlive">
            <i /> x402 runner
          </div>
          <div className="pw-hudcap">live</div>
        </div>
        <div className="pw-hudcap">Agent wallet · USDC on Base</div>
        <div className="pw-hudbal">
          <b ref={balRef}>34.3269</b>
          <span>USDC</span>
        </div>
        <div className="pw-hudrow">
          <div>
            <div className="pw-hudv" ref={callsRef}>
              0
            </div>
            <div className="pw-hudk">paid</div>
          </div>
          <div>
            <div className="pw-hudv">
              $<span ref={spentRef}>0.00</span>
            </div>
            <div className="pw-hudk">spent</div>
          </div>
          <div>
            <div className="pw-hudv pw-hudv--red" ref={declinedRef}>
              0
            </div>
            <div className="pw-hudk">blocked</div>
          </div>
        </div>
        <div className="pw-hudlast" ref={lastRef}>
          awaiting first settlement…
        </div>
      </div>
    </>
  )
}
