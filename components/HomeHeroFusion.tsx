'use client'

// The fusion hero — "where dapps become one agent". Protocol energies
// (Uniswap pink, CoW blue, Snapshot gold, and a dashed "your MCP" emerald)
// stream as luminous particle rivers from the edges into a breathing core
// behind the headline. Every few seconds the core TRANSMUTES: a ring pulse
// fires, an emerald burst leaves the core, and one mono line under the CTAs
// names what the fusion just produced (swap built, vote signed, receipted) —
// the art literally performs the product. No browser chrome, no mockup;
// "Try it live" summons the real /embed chat as an overlay instead.
// Canvas is 2D + additive blending (no WebGL), throttled particle counts,
// static frame under prefers-reduced-motion.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const EMBED_SRC = '/embed?mcps=uniswap-free,snapshot-free&theme=dark'

/** Stream sources — normalized anchors, protocol hue, and the chip label.
 * Desktop shows labeled medallions at these anchors; phones tuck the streams
 * into the corners and show a plain chip row instead. */
const SOURCES = [
  { x: 0.09, y: 0.3, color: '#FF6BAF', name: 'Uniswap', glyph: 'U', dashed: false },
  { x: 0.91, y: 0.27, color: '#FFC94D', name: 'Snapshot', glyph: '⚡', dashed: false },
  { x: 0.11, y: 0.76, color: '#7AA7FF', name: 'CoW', glyph: 'C', dashed: false },
  { x: 0.89, y: 0.78, color: '#34e3a0', name: 'your MCP', glyph: '+', dashed: true },
]
const CORE = { x: 0.5, y: 0.47 }

/** What the fusion produces — cycled under the CTAs, ring-pulsed in the art. */
const TRANSMUTATIONS = [
  '⇄ swap built on Uniswap · signed by your wallet · receipted',
  '🗳 vote cast on Snapshot · EIP-712 · your signature, your say',
  '✓ quote → build → guardrails → sign · $0.00 · receipted',
  '⛓ approve → swap chained · re-quoted per step · over-cap dropped',
]

interface Particle {
  src: number
  t: number
  speed: number
  size: number
  drift: number
}
interface Burst {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

function FusionCanvas({ pulseRef }: { pulseRef: React.MutableRefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const px = (nx: number) => nx * w
    const py = (ny: number) => ny * h

    // Curved path per source: quadratic bezier bowed outward so the rivers
    // arc like field lines instead of ruler lines.
    const point = (srcIdx: number, t: number) => {
      const s = SOURCES[srcIdx]
      const sx = px(s.x)
      const sy = py(s.y)
      const cx = px(CORE.x)
      const cy = py(CORE.y)
      const mx = (sx + cx) / 2
      const my = (sy + cy) / 2
      // bow perpendicular to the chord, alternating side per source
      const dx = cx - sx
      const dy = cy - sy
      const len = Math.hypot(dx, dy) || 1
      const bow = (srcIdx % 2 === 0 ? 1 : -1) * len * 0.22
      const ox = mx + (-dy / len) * bow
      const oy = my + (dx / len) * bow
      const u = 1 - t
      return {
        x: u * u * sx + 2 * u * t * ox + t * t * cx,
        y: u * u * sy + 2 * u * t * oy + t * t * cy,
      }
    }

    const particles: Particle[] = []
    const bursts: Burst[] = []
    let rings: { r: number; a: number }[] = []
    let lastPulse = pulseRef.current

    const spawn = () => {
      if (particles.length > (w < 760 ? 90 : 170)) return
      const src = Math.floor(Math.random() * SOURCES.length)
      particles.push({
        src,
        t: 0,
        speed: 0.0022 + Math.random() * 0.0028,
        size: 0.8 + Math.random() * 1.7,
        drift: Math.random() * Math.PI * 2,
      })
    }

    const drawCore = (now: number, flash: number) => {
      const cx = px(CORE.x)
      const cy = py(CORE.y)
      const breathe = 1 + 0.08 * Math.sin(now / 1200)
      const R = Math.min(w, h) * 0.16 * breathe * (1 + flash * 0.25)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
      g.addColorStop(0, `rgba(210,255,236,${0.5 + flash * 0.4})`)
      g.addColorStop(0.25, `rgba(52,227,160,${0.28 + flash * 0.25})`)
      g.addColorStop(0.6, 'rgba(52,227,160,0.07)')
      g.addColorStop(1, 'rgba(52,227,160,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()
      // nucleus
      ctx.fillStyle = `rgba(235,255,246,${0.8 + flash * 0.2})`
      ctx.beginPath()
      ctx.arc(cx, cy, 2.6 + flash * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      // dotted field lines + a calm core — the no-motion rendering
      SOURCES.forEach((s, i) => {
        ctx.strokeStyle = `${s.color}55`
        ctx.setLineDash([2, 7])
        ctx.beginPath()
        for (let t = 0; t <= 1.001; t += 0.02) {
          const p = point(i, t)
          if (t === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
      })
      drawCore(0, 0)
    }

    if (reduce) {
      drawStatic()
      const onR = () => drawStatic()
      window.addEventListener('resize', onR)
      return () => {
        window.removeEventListener('resize', onR)
        window.removeEventListener('resize', resize)
      }
    }

    let raf = 0
    let last = performance.now()
    let flash = 0
    const loop = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      if (!document.hidden) {
        for (let i = 0; i < 3; i++) spawn()

        // a transmutation was requested by the caption cycler
        if (pulseRef.current !== lastPulse) {
          lastPulse = pulseRef.current
          rings.push({ r: 8, a: 0.75 })
          flash = 1
          const cx = px(CORE.x)
          const cy = py(CORE.y)
          for (let i = 0; i < 14; i++) {
            const ang = Math.random() * Math.PI * 2
            const v = 0.02 + Math.random() * 0.05
            bursts.push({ x: cx, y: cy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 1 })
          }
        }
        flash = Math.max(0, flash - dt / 900)

        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'

        // rivers
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]
          p.t += p.speed * dt
          if (p.t >= 1) {
            particles.splice(i, 1)
            continue
          }
          const pos = point(p.src, p.t)
          const wob = Math.sin(p.t * 10 + p.drift) * 6 * (1 - p.t)
          const alpha = Math.sin(Math.PI * p.t) * 0.85
          ctx.fillStyle = SOURCES[p.src].color
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.arc(pos.x + wob, pos.y + wob * 0.6, p.size * (0.6 + 0.6 * (1 - p.t)), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1

        // the signed-tx burst leaving the core
        for (let i = bursts.length - 1; i >= 0; i--) {
          const b = bursts[i]
          b.x += b.vx * dt * 8
          b.y += b.vy * dt * 8
          b.life -= dt / 800
          if (b.life <= 0) {
            bursts.splice(i, 1)
            continue
          }
          ctx.globalAlpha = Math.max(0, b.life) * 0.9
          ctx.fillStyle = '#8effc9'
          ctx.beginPath()
          ctx.arc(b.x, b.y, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1

        // transmutation rings
        rings = rings.filter((r) => r.a > 0.02)
        for (const r of rings) {
          r.r += dt * 0.09
          r.a *= 1 - dt / 1400
          ctx.strokeStyle = `rgba(52,227,160,${r.a})`
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.arc(px(CORE.x), py(CORE.y), r.r, 0, Math.PI * 2)
          ctx.stroke()
        }

        drawCore(now, flash)
        ctx.globalCompositeOperation = 'source-over'
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [pulseRef])

  return <canvas ref={canvasRef} className="fhero__canvas" aria-hidden="true" />
}

export default function HomeHeroFusion() {
  const pulseRef = useRef(0)
  const [captionIdx, setCaptionIdx] = useState(0)
  const [live, setLive] = useState(false)

  // The transmutation clock: rotate the caption and ask the canvas for a
  // ring pulse on the same beat.
  useEffect(() => {
    const id = setInterval(() => {
      setCaptionIdx((i) => (i + 1) % TRANSMUTATIONS.length)
      pulseRef.current++
    }, 3800)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="fhero">
      <FusionCanvas pulseRef={pulseRef} />

      {/* labeled sources — the protocols feeding the core (desktop) */}
      <div className="fhero__chips" aria-hidden="true">
        {SOURCES.map((s) => (
          <span
            key={s.name}
            className={`fhero__chip mono${s.dashed ? ' fhero__chip--dashed' : ''}`}
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, ['--pc' as string]: s.color }}
          >
            <i>{s.glyph}</i> {s.name}
          </span>
        ))}
      </div>

      <div className="fhero__veil" aria-hidden="true" />

      <div className="fhero__stage">
        <div className="fhero__eyebrow mono">
          The federated transaction layer <span>·</span> <b>mega apps are here</b>
        </div>
        <h1 className="fhero__h1">
          Every dapp.
          <br />
          <span className="fhero__em">One chat.</span>
        </h1>
        <p className="fhero__lede">
          Fuse <strong>Uniswap, Snapshot, CoW — or your own MCP</strong> — into one agent that
          answers, votes, and builds <strong>safe, signed, receipted</strong> transactions.
          Compose it in minutes. Embed it in five lines.
        </p>
        <div className="fhero__ctas">
          <button className="btn btn--solid" onClick={() => setLive(true)}>
            Try it live
          </button>
          <Link className="btn btn--ghost" href="/docs/embed">
            Get the embed
          </Link>
        </div>
        <p className="fhero__caption mono" key={captionIdx}>
          {TRANSMUTATIONS[captionIdx]}
        </p>
      </div>

      {/* phones: the sources as a plain row (the absolute chips hide) */}
      <div className="fhero__chiprow" aria-hidden="true">
        {SOURCES.map((s) => (
          <span key={s.name} className={`fhero__chip fhero__chip--flow mono${s.dashed ? ' fhero__chip--dashed' : ''}`} style={{ ['--pc' as string]: s.color }}>
            <i>{s.glyph}</i> {s.name}
          </span>
        ))}
      </div>

      {/* Try it live — the REAL /embed chat, summoned instead of mocked */}
      {live && (
        <div className="fhero__livewrap" role="dialog" aria-label="Yeetful chat — live">
          <div className="fhero__livebar">
            <span className="mono">
              <i /> Yeetful chat · live — Uniswap + Snapshot, one agent
            </span>
            <button className="fhero__liveclose" onClick={() => setLive(false)} aria-label="Close live chat">
              ✕
            </button>
          </div>
          <iframe className="fhero__liveframe" src={EMBED_SRC} title="Yeetful chat — live" allow="clipboard-write" />
        </div>
      )}
    </section>
  )
}
