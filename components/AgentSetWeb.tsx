'use client'

// The composed-set visual — the Switchboard web reworked for the pivot. Two
// MCP clusters (uniswap-free + snapshot-free) with their TOOLS as nodes; the
// core is YOUR AGENT. A plain-English ask arrives from the left, the sharp
// router weighs the tools across the whole set, patches to the exact tool,
// and either answers ($0 read), hands the built transaction to YOUR wallet
// to sign, or drops it at the guardrail (over-cap = dropped, not built).
// Same DNA as SwitchboardWeb (declarative SVG + rAF beams + CSS particles) —
// the story moves from "cheapest route in the catalog" to "right tool in
// YOUR set".

import { useEffect, useRef } from 'react'

// [tool, glyph, mcp, x, y, depth-scale]
const NODES: [string, string, 'uniswap' | 'snapshot', number, number, number][] = [
  // uniswap-free — the swap venue
  ['quote', '◇', 'uniswap', 952, 190, 0.9],
  ['build_swap', '⇄', 'uniswap', 1128, 232, 0.95],
  ['pools', '◎', 'uniswap', 972, 302, 0.76],
  ['token_info', 'T', 'uniswap', 1146, 344, 0.68],
  // snapshot-free — the governance surface (kept left of the HUD card)
  ['proposals', '▤', 'snapshot', 842, 486, 0.9],
  ['vote', '✓', 'snapshot', 992, 522, 0.95],
  ['spaces', '◈', 'snapshot', 856, 588, 0.74],
  ['results', 'Σ', 'snapshot', 980, 652, 0.68],
]

const HULLS: { mcp: 'uniswap' | 'snapshot'; label: string; x: number; y: number; w: number; h: number }[] = [
  { mcp: 'uniswap', label: 'UNISWAP · FREE MCP', x: 878, y: 128, w: 356, h: 268 },
  { mcp: 'snapshot', label: 'SNAPSHOT · FREE MCP', x: 762, y: 430, w: 338, h: 244 },
]

// The asks the agent handles — reads answer for $0, money asks hand a built
// tx/order to the user's own wallet, over-cap asks get dropped at the
// guardrail. `win` is the exact tool the router picks.
const REQUESTS: { q: string; win: string; kind: 'read' | 'sign' | 'blocked'; note: string }[] = [
  { q: 'what is WETH trading at?', win: 'quote', kind: 'read', note: '· receipted' },
  { q: 'swap 1 USDC → WETH', win: 'build_swap', kind: 'sign', note: '· signs in YOUR wallet' },
  { q: 'active aave.eth proposals?', win: 'proposals', kind: 'read', note: '· receipted' },
  { q: 'vote FOR the treasury proposal', win: 'vote', kind: 'sign', note: '· EIP-712, YOUR wallet' },
  { q: 'swap 500 USDC → WETH', win: 'build_swap', kind: 'blocked', note: '$500 > $5/day cap' },
]

const CORE = { x: 600, y: 438 }
const INLET_X = 70
const SVGNS = 'http://www.w3.org/2000/svg'

interface Call {
  reqIdx: number
  winner: number
  phase: 'in' | 'wait' | 'patch'
  t: number
  dwell: number
  el: SVGCircleElement
  y0: number
}

export default function AgentSetWeb() {
  const particlesRef = useRef<HTMLDivElement>(null)
  const netgRef = useRef<SVGGElement>(null)
  const beamLayerRef = useRef<SVGGElement>(null)
  const nodeRefs = useRef<(SVGGElement | null)[]>([])
  const edgeRefs = useRef<(SVGLineElement | null)[]>([])
  const askRef = useRef<HTMLDivElement>(null)
  const answeredRef = useRef<HTMLDivElement>(null)
  const signedRef = useRef<HTMLDivElement>(null)
  const droppedRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── background particle field (built once, compositor-driven) ──
    const pc = particlesRef.current
    if (pc) {
      const N = Math.round(Math.min(70, window.innerWidth / 20))
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

    let answered = 0
    let signed = 0
    let dropped = 0
    const set = (el: Element | null, txt: string) => {
      if (el) el.textContent = txt
    }

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

    let reqSeq = 0
    const decide = (): Call | null => {
      const layer = beamLayerRef.current
      if (!layer) return null
      const req = REQUESTS[reqSeq++ % REQUESTS.length]
      const winner = NODES.findIndex((n) => n[0] === req.win)
      if (winner < 0) return null
      const y0 = 260 + Math.random() * 340
      const c = el('circle', { class: 'sw-req', r: 4.2, cx: INLET_X, cy: y0 }) as SVGCircleElement
      layer.appendChild(c)
      return { reqIdx: REQUESTS.indexOf(req), winner, phase: 'in', t: 0, dwell: 0, el: c, y0 }
    }

    const startAudition = (call: Call) => {
      const req = REQUESTS[call.reqIdx]
      const mcp = NODES[call.winner][2]
      const inSet = NODES.map((n, i) => i).filter((i) => NODES[i][2] === mcp)
      if (askRef.current)
        askRef.current.innerHTML = `<span class="sw-q">“${req.q}”</span> · weighing 8 tools across 2 MCPs`
      // the router considers the whole set, then narrows to the winning MCP…
      NODES.forEach((_, i) => flash(nodeRefs.current[i], 'is-cand', 420))
      setTimeout(() => {
        inSet.forEach((i) => {
          flash(nodeRefs.current[i], 'is-cand', 520)
          const edge = edgeRefs.current[i]
          if (edge) {
            edge.classList.add('is-cand')
            setTimeout(() => edge.classList.remove('is-cand'), 520)
          }
        })
      }, 300)
      // …and marks the exact tool a beat later
      const blocked = req.kind === 'blocked'
      setTimeout(() => {
        const edge = edgeRefs.current[call.winner]
        if (edge) {
          edge.classList.add(blocked ? 'is-overcap' : 'is-pick')
          setTimeout(() => edge.classList.remove(blocked ? 'is-overcap' : 'is-pick'), 520)
        }
        flash(nodeRefs.current[call.winner], blocked ? 'is-overcap' : 'is-picked', 600)
      }, 620)
    }

    const settle = (call: Call) => {
      const req = REQUESTS[call.reqIdx]
      const [tool, , mcp] = NODES[call.winner]
      const g = nodeRefs.current[call.winner]
      const rcpt = g?.querySelector('.pw-rcpt')
      if (req.kind === 'sign') {
        signed++
        if (rcpt) rcpt.textContent = 'SIGNED'
        set(signedRef.current, String(signed))
      } else {
        answered++
        if (rcpt) rcpt.textContent = 'ANSWERED'
        set(answeredRef.current, String(answered))
      }
      flash(g, 'is-settle')
      const edge = edgeRefs.current[call.winner]
      if (edge) {
        edge.classList.add('is-hot')
        setTimeout(() => edge.classList.remove('is-hot'), 600)
      }
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">${mcp}-free · ${tool}</span> <span class="pw-amt">$0.00</span><br/><span class="pw-ok">${req.kind === 'sign' ? '✍ built' : '✓ answered'}</span> ${req.note}`
    }

    const drop = (call: Call) => {
      const req = REQUESTS[call.reqIdx]
      dropped++
      flash(nodeRefs.current[call.winner], 'is-declined')
      set(droppedRef.current, String(dropped))
      if (lastRef.current)
        lastRef.current.innerHTML = `<span class="pw-srv">guardrail</span> <span class="pw-amt pw-amt--red">${req.note}</span><br/><span class="pw-decl">NO BUILD</span> · dropped, nothing signed`
    }

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
        const req = REQUESTS[call.reqIdx]
        if (call.phase === 'in') {
          call.t += dt * 1.15
          const x = INLET_X + (CORE.x - INLET_X) * call.t
          const y = call.y0 + (CORE.y - call.y0) * call.t
          call.el.setAttribute('cx', String(x))
          call.el.setAttribute('cy', String(y))
          if (call.t >= 1) {
            call.el.remove()
            call.phase = 'wait'
            call.dwell = now + (reduce ? 500 : 980)
            startAudition(call)
          }
        } else if (call.phase === 'wait') {
          if (now >= call.dwell) {
            if (req.kind === 'blocked') {
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
          const [, , , nx, ny] = NODES[call.winner]
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
      if (document.hidden || calls.length > 4) return
      const c = decide()
      if (c) calls.push(c)
    }

    // seed one decision so the scene reads instantly
    const seed = decide()
    if (seed) {
      seed.phase = 'wait'
      seed.dwell = performance.now()
      seed.el.remove()
      calls.push(seed)
    }

    const spawnTimer = setInterval(tick, reduce ? 3200 : 2100)
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
          {/* inlet rail — plain-English asks arrive here */}
          <line className="sw-inlet" x1={INLET_X} y1={260} x2={INLET_X} y2={620} />

          {/* the two MCPs in the set, drawn as dashed hulls around their tools */}
          {HULLS.map((h) => (
            <g key={h.mcp} className="asw-hull">
              <rect x={h.x} y={h.y} width={h.w} height={h.h} rx={26} />
              <text x={h.x + 18} y={h.y + 24}>{h.label}</text>
            </g>
          ))}

          {NODES.map(([name, , , x, y], i) => (
            <line
              key={name}
              ref={(n) => {
                edgeRefs.current[i] = n
              }}
              className="sw-edge"
              x1={CORE.x}
              y1={CORE.y}
              x2={x}
              y2={y}
            />
          ))}
          {NODES.map(([name, glyph, , x, y, z], i) => {
            const r = 12 + 9 * z
            const nf = Math.round(11 + 3 * z)
            return (
              <g
                key={name}
                ref={(n) => {
                  nodeRefs.current[i] = n
                }}
                className="sw-node"
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
                <text className="pw-pr" x={r + 11} y={nf - 1} fontSize={Math.round(9 + 2 * z)}>
                  $0
                </text>
                <text className="pw-rcpt" y={-(r + 12)} fontSize={12}>
                  ANSWERED
                </text>
                <text className="pw-rdecl" y={-(r + 12)} fontSize={12}>
                  OVER CAP
                </text>
              </g>
            )
          })}

          {/* the agent core — one chat over the whole set */}
          <circle className="pw-hubring" cx={CORE.x} cy={CORE.y} r={18} />
          <circle className="pw-hubring pw-hubring--b" cx={CORE.x} cy={CORE.y} r={18} />
          <circle className="pw-hubcore" cx={CORE.x} cy={CORE.y} r={21} />
          <circle className="pw-hubdot" cx={CORE.x} cy={CORE.y} r={6} />
          <text className="pw-hubname" x={CORE.x} y={CORE.y + 42}>
            YOUR AGENT
          </text>
          <text className="pw-hubsub" x={CORE.x} y={CORE.y + 58}>
            picks the tool · fills the params
          </text>

          <g ref={beamLayerRef} />
        </g>
      </svg>
      <div className="heroweb__veil heroweb__veil--frame" aria-hidden="true" />
      <div className="heroweb__veil heroweb__veil--left" aria-hidden="true" />

      <div className="heroweb__hud" aria-hidden="true">
        <div className="pw-hudtop">
          <div className="pw-hudlive">
            <i /> your agent
          </div>
          <div className="pw-hudcap">routing</div>
        </div>
        <div className="sw-hudask" ref={askRef}>
          reading the ask…
        </div>
        <div className="pw-hudcap">The set · 2 MCPs, 8 tools</div>
        <div className="asw-set mono">
          <span>uniswap-free</span>
          <span>snapshot-free</span>
        </div>
        <div className="pw-hudrow">
          <div>
            <div className="pw-hudv" ref={answeredRef}>
              0
            </div>
            <div className="pw-hudk">answered</div>
          </div>
          <div>
            <div className="pw-hudv" ref={signedRef}>
              0
            </div>
            <div className="pw-hudk">built to sign</div>
          </div>
          <div>
            <div className="pw-hudv pw-hudv--red" ref={droppedRef}>
              0
            </div>
            <div className="pw-hudk">dropped</div>
          </div>
        </div>
        <div className="pw-hudlast" ref={lastRef}>
          awaiting first ask…
        </div>
      </div>
    </>
  )
}
