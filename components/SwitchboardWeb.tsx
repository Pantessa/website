'use client'

// The Switchboard — the routing engine made visible. A plain-English request
// arrives from the left ("cheapest flight SFO→JFK"). The operator core weighs
// the candidate MCP services in that category, picks the cheapest one under the
// budget cap, patches a beam through to it, and settles (402→200) with a tx
// stamp. When every fitting route is over the cap, the call is dropped (red).
// Sibling visual to the home hero's PaymentWeb, same DNA (declarative SVG +
// rAF beams + CSS particle field), but the story is SELECTION, not just spend.

import { useEffect, useRef, type RefObject } from 'react'

// [name, glyph, category, per-call price, x, y, depth-scale]
const NODES: [string, string, string, number, number, number, number][] = [
  // Inference
  ['Venice', '◇', 'Inference', 0.001, 818, 150, 0.9],
  ['DeepSeek', '◆', 'Inference', 0.001, 980, 244, 0.84],
  ['Replicate', 'R', 'Inference', 0.009, 752, 330, 0.8],
  ['BlockRun', 'B', 'Inference', 0.002, 922, 430, 0.92],
  // Data
  ['Exa', 'E', 'Data', 0.0015, 1108, 150, 0.7],
  ['Tavily', 'T', 'Data', 0.002, 1288, 188, 0.62],
  ['Wolfram', 'Ω', 'Data', 0.004, 1058, 268, 0.72], // Try chip: "Solve with Wolfram"
  ['CoinGecko', 'G', 'Data', 0.001, 1188, 322, 0.74], // Try chip: "Crypto market data"
  ['Snapshot', 'S', 'Data', 0.0015, 1244, 236, 0.62], // Try chip: "DAO proposals"
  ['Firecrawl', 'F', 'Data', 0.004, 1316, 432, 0.56],
  ['Hunter', 'H', 'Data', 0.03, 1208, 498, 0.58],
  // Infra
  ['Pinata', 'P', 'Infra', 0.001, 1024, 558, 0.8],
  ['Helius', '⬡', 'Infra', 0.0008, 1186, 566, 0.66],
  ['2Captcha', 'C', 'Infra', 0.01, 1330, 616, 0.56],
  // Travel
  ['Amadeus', 'A', 'Travel', 0.012, 902, 632, 0.74],
  ['FlightAware', '✈', 'Travel', 0.05, 1076, 700, 0.6],
]

// Per-call budget cap the operator routes under. Anything pricier is "no route".
const CAP = 0.02
// The asks the operator routes — the hero's "Try" chips (lib/examples), each a
// KNOWN-WORKING prompt tied to the exact MCP it routes to (win = node name). The
// operator weighs that service's category, settles on it (402→200), and banks
// the spread vs the priciest fit. Over-cap nodes (FlightAware, Hunter) stay in
// the graph as the red guardrail backdrop but aren't in the cycle.
const REQUESTS: { q: string; win: string }[] = [
  { q: 'ETH price + 24h change', win: 'CoinGecko' },
  { q: 'active aave.eth proposals', win: 'Snapshot' },
  { q: 'integrate x² · sin(x) dx', win: 'Wolfram' },
]

const CORE = { x: 648, y: 418 }
const INLET_X = 70
const SVGNS = 'http://www.w3.org/2000/svg'
const START_BAL = 41.882

interface Call {
  reqIdx: number
  cat: string
  cands: number[]
  winner: number
  decline: boolean
  saved: number
  phase: 'in' | 'wait' | 'patch'
  t: number
  dwell: number
  el: SVGCircleElement
  y0: number
}

export default function SwitchboardWeb({
  proofRoutedRef,
  proofSavedRef,
}: {
  /** Proof-row "routed $" span in the hero copy. */
  proofRoutedRef: RefObject<HTMLSpanElement | null>
  /** Proof-row "saved $" span — money the cheaper pick avoided. */
  proofSavedRef: RefObject<HTMLSpanElement | null>
}) {
  const particlesRef = useRef<HTMLDivElement>(null)
  const netgRef = useRef<SVGGElement>(null)
  const beamLayerRef = useRef<SVGGElement>(null)
  const nodeRefs = useRef<(SVGGElement | null)[]>([])
  const edgeRefs = useRef<(SVGLineElement | null)[]>([])
  const askRef = useRef<HTMLDivElement>(null)
  const balRef = useRef<HTMLElement>(null)
  const routedRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef<HTMLSpanElement>(null)
  const droppedRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── background particle field (built once, compositor-driven) ──
    const pc = particlesRef.current
    if (pc) {
      const N = Math.round(Math.min(80, window.innerWidth / 18))
      let h = ''
      for (let i = 0; i < N; i++) {
        const size = (Math.random() * 2.3 + 0.7).toFixed(2)
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

    // ── live counters (direct DOM, no React churn per frame) ──
    let routed = 0
    let spent = 0
    let saved = 0
    let dropped = 0
    const set = (el: Element | null, txt: string) => {
      if (el) el.textContent = txt
    }
    const byCat: Record<string, number[]> = {}
    NODES.forEach(([, , cat], i) => (byCat[cat] ||= []).push(i))

    const el = (n: string, a: Record<string, string | number>) => {
      const e = document.createElementNS(SVGNS, n)
      for (const k in a) e.setAttribute(k, String(a[k]))
      return e
    }
    const flash = (g: SVGGElement | null, cls: string, ms = 1500) => {
      if (!g) return
      g.classList.remove(cls)
      void g.getBoundingClientRect()
      g.classList.add(cls)
      setTimeout(() => g.classList.remove(cls), ms)
    }

    // Choose the next request + resolve the routing decision up front.
    let reqSeq = 0
    const decide = (): Call | null => {
      const layer = beamLayerRef.current
      if (!layer) return null
      const req = REQUESTS[reqSeq++ % REQUESTS.length]
      // Each ask is tied to the exact MCP it routes to (a known-working route),
      // so the winner is that named service — not the category-cheapest.
      const winner = NODES.findIndex((n) => n[0] === req.win)
      if (winner < 0) return null
      const cat = NODES[winner][2]
      const cands = byCat[cat] || []
      // bank the spread vs the priciest fit in the same category.
      const dearest = [...cands].sort((a, b) => NODES[b][3] - NODES[a][3])[0]
      const saved = Math.max(0, NODES[dearest][3] - NODES[winner][3])
      const y0 = 250 + Math.random() * 360
      const c = el('circle', { class: 'sw-req', r: 4.2, cx: INLET_X, cy: y0 }) as SVGCircleElement
      layer.appendChild(c)
      return {
        reqIdx: REQUESTS.indexOf(req),
        cat,
        cands,
        winner,
        decline: false,
        saved,
        phase: 'in',
        t: 0,
        dwell: 0,
        el: c,
        y0,
      }
    }

    const startAudition = (call: Call) => {
      const req = REQUESTS[call.reqIdx]
      if (askRef.current)
        askRef.current.innerHTML = `<span class="sw-q">“${req.q}”</span> · weighing ${call.cands.length} ${call.cat.toLowerCase()} routes`
      call.cands.forEach((i) => {
        flash(nodeRefs.current[i], 'is-cand', 720)
        const edge = edgeRefs.current[i]
        if (edge) {
          edge.classList.add('is-cand')
          setTimeout(() => edge.classList.remove('is-cand'), 720)
        }
      })
      // mark the winner edge as the pick a beat later
      setTimeout(() => {
        const edge = edgeRefs.current[call.winner]
        if (edge) {
          edge.classList.add(call.decline ? 'is-overcap' : 'is-pick')
          setTimeout(() => edge.classList.remove(call.decline ? 'is-overcap' : 'is-pick'), 520)
        }
        flash(nodeRefs.current[call.winner], call.decline ? 'is-overcap' : 'is-picked', 600)
      }, 280)
    }

    const settle = (call: Call) => {
      const [name, , cat, price] = NODES[call.winner]
      routed++
      spent += price
      saved += call.saved
      flash(nodeRefs.current[call.winner], 'is-settle')
      const edge = edgeRefs.current[call.winner]
      if (edge) {
        edge.classList.add('is-hot')
        setTimeout(() => edge.classList.remove('is-hot'), 600)
      }
      set(routedRef.current, String(routed))
      set(savedRef.current, saved.toFixed(3))
      set(balRef.current, (START_BAL - spent).toFixed(4))
      set(proofRoutedRef.current, spent.toFixed(2))
      set(proofSavedRef.current, saved.toFixed(3))
      const savedTxt = call.saved > 0 ? ` · saved $${call.saved.toFixed(3)}` : ''
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">${name}</span> ${cat} <span class="pw-amt">$${price.toFixed(4)}</span><br/><span class="pw-ok">402→200</span> patched${savedTxt}`
    }

    const drop = (call: Call) => {
      const [name, , , price] = NODES[call.winner]
      dropped++
      flash(nodeRefs.current[call.winner], 'is-declined')
      set(droppedRef.current, String(dropped))
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">${name}</span> $${price.toFixed(3)} <span class="pw-amt pw-amt--red">> $${CAP.toFixed(2)} cap</span><br/><span class="pw-decl">NO ROUTE</span> · dropped, $0 spent`
    }

    // Ping ring at the core when a call is dropped.
    const ping = (x: number, y: number) => {
      const layer = beamLayerRef.current
      if (!layer) return
      const ring = el('circle', { class: 'sw-barrier', cx: x, cy: y, r: 5, opacity: 0.9 })
      layer.appendChild(ring)
      ring.appendChild(el('animate', { attributeName: 'r', from: 5, to: 20, dur: '0.5s', fill: 'freeze' }))
      ring.appendChild(el('animate', { attributeName: 'opacity', from: 0.9, to: 0, dur: '0.5s', fill: 'freeze' }))
      setTimeout(() => ring.remove(), 520)
    }

    const calls: Call[] = []
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      const dt = Math.min(60, now - last) / 1000
      last = now
      for (let b = calls.length - 1; b >= 0; b--) {
        const call = calls[b]
        if (call.phase === 'in') {
          call.t += dt * 1.15
          const x = INLET_X + (CORE.x - INLET_X) * call.t
          const y = call.y0 + (CORE.y - call.y0) * call.t
          call.el.setAttribute('cx', String(x))
          call.el.setAttribute('cy', String(y))
          if (call.t >= 1) {
            call.el.remove()
            call.phase = 'wait'
            call.dwell = now + (reduce ? 360 : 640)
            startAudition(call)
          }
        } else if (call.phase === 'wait') {
          if (now >= call.dwell) {
            if (call.decline) {
              ping(CORE.x, CORE.y)
              drop(call)
              calls.splice(b, 1)
              continue
            }
            const beam = el('circle', { class: 'sw-beam', r: 3.8, cx: CORE.x, cy: CORE.y }) as SVGCircleElement
            beamLayerRef.current?.appendChild(beam)
            call.el = beam
            call.phase = 'patch'
            call.t = 0
          }
        } else {
          // patch
          const [, , , , nx, ny] = NODES[call.winner]
          call.t += dt * 1.0
          call.el.setAttribute('cx', String(CORE.x + (nx - CORE.x) * call.t))
          call.el.setAttribute('cy', String(CORE.y + (ny - CORE.y) * call.t))
          if (call.t >= 1) {
            settle(call)
            call.el.remove()
            calls.splice(b, 1)
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }

    const tick = () => {
      if (document.hidden || calls.length > 6) return
      const c = decide()
      if (c) calls.push(c)
    }

    // seed one settle + one decision so the scene reads instantly
    const seed = decide()
    if (seed) {
      seed.phase = 'wait'
      seed.dwell = performance.now()
      seed.el.remove()
      calls.push(seed)
    }

    const spawnTimer = setInterval(tick, reduce ? 2600 : 1500)
    raf = requestAnimationFrame(loop)

    const onMove = (e: MouseEvent) => {
      const g = netgRef.current
      if (!g) return
      const dx = e.clientX / window.innerWidth - 0.5
      const dy = e.clientY / window.innerHeight - 0.5
      g.style.transform = `translate(${dx * 20}px,${dy * 15}px)`
    }
    if (!reduce) window.addEventListener('mousemove', onMove)

    return () => {
      clearInterval(spawnTimer)
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      calls.forEach((c) => c.el.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div ref={particlesRef} className="heroweb__particles" aria-hidden="true" />
      <svg className="heroweb__net" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g ref={netgRef} className="pw-g">
          {/* inlet rail — where plain-English requests arrive */}
          <line className="sw-inlet" x1={INLET_X} y1={250} x2={INLET_X} y2={610} />
          {NODES.map(([name, , , price, x, y], i) => (
            <line
              key={name}
              ref={(n) => {
                edgeRefs.current[i] = n
              }}
              className={price > CAP ? 'sw-edge is-capped' : 'sw-edge'}
              x1={CORE.x}
              y1={CORE.y}
              x2={x}
              y2={y}
            />
          ))}
          {NODES.map(([name, glyph, , price, x, y, z], i) => {
            const r = 12 + 9 * z
            const nf = Math.round(11 + 3 * z)
            const pf = Math.round(9 + 2 * z)
            const capped = price > CAP
            return (
              <g
                key={name}
                ref={(n) => {
                  nodeRefs.current[i] = n
                }}
                className={capped ? 'sw-node is-blocked' : 'sw-node'}
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
                {capped ? (
                  <text className="pw-capt" x={r + 11} y={nf - 1} fontSize={pf}>
                    ⊘ ${price.toFixed(3)}
                  </text>
                ) : (
                  <text className="pw-pr" x={r + 11} y={nf - 1} fontSize={pf}>
                    ${price.toFixed(4)}
                  </text>
                )}
                <text className="pw-rcpt" y={-(r + 12)} fontSize={12}>
                  PICK
                </text>
                <text className="pw-rdecl" y={-(r + 12)} fontSize={12}>
                  OVER CAP
                </text>
              </g>
            )
          })}

          {/* operator core — the switchboard */}
          <circle className="pw-hubring" cx={CORE.x} cy={CORE.y} r={18} />
          <circle className="pw-hubring pw-hubring--b" cx={CORE.x} cy={CORE.y} r={18} />
          <circle className="pw-hubcore" cx={CORE.x} cy={CORE.y} r={21} />
          <circle className="pw-hubdot" cx={CORE.x} cy={CORE.y} r={6} />
          <text className="pw-hubname" x={CORE.x} y={CORE.y + 42}>
            ROUTER
          </text>
          <text className="pw-hubsub" x={CORE.x} y={CORE.y + 58}>
            picks the best-priced route
          </text>

          <g ref={beamLayerRef} />
        </g>
      </svg>
      <div className="heroweb__veil heroweb__veil--frame" aria-hidden="true" />
      <div className="heroweb__veil heroweb__veil--left" aria-hidden="true" />

      <div className="heroweb__hud" aria-hidden="true">
        <div className="pw-hudtop">
          <div className="pw-hudlive">
            <i /> router
          </div>
          <div className="pw-hudcap">routing</div>
        </div>
        <div className="sw-hudask" ref={askRef}>
          routing requests…
        </div>
        <div className="pw-hudcap">Agent wallet · USDC on Base</div>
        <div className="pw-hudbal">
          <b ref={balRef}>41.8820</b>
          <span>USDC</span>
        </div>
        <div className="pw-hudrow">
          <div>
            <div className="pw-hudv" ref={routedRef}>
              0
            </div>
            <div className="pw-hudk">routed</div>
          </div>
          <div>
            <div className="pw-hudv">
              $<span ref={savedRef}>0.000</span>
            </div>
            <div className="pw-hudk">saved</div>
          </div>
          <div>
            <div className="pw-hudv pw-hudv--red" ref={droppedRef}>
              0
            </div>
            <div className="pw-hudk">dropped</div>
          </div>
        </div>
        <div className="pw-hudlast" ref={lastRef}>
          awaiting first request…
        </div>
      </div>
    </>
  )
}
