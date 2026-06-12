'use client'

// The Settlement Rail — the hero's living background. Every filament is an
// agent's API call drifting through the sprawl; the rail captures them into
// one laminar stream — one payment rail; every accent pulse is a settlement.
// Pen-plotter aesthetic: 1px ink strokes batched into four paths per frame,
// no shaders, no libraries. The meter shows REAL settled volume from
// /api/activity (no fake ticking) and hides itself if the feed is down.
// Full design rationale + tuning guide: design/hero-settlement/DESIGN-SPEC.md.

import { useEffect, useRef, useState } from 'react'

const P = {
  DENSITY: 700, // px² of canvas per particle (lower = denser)
  MAX_PARTICLES: 1800,
  MOBILE_MAX: 550, // cap under 640px wide
  SPEED_MIN: 0.6,
  SPEED_MAX: 1.6,
  FIELD_DRIFT: 0.16, // how fast the flow field evolves
  RAIL_FROM_BOTTOM: 44, // rail position in px above the section's bottom edge
  CAPTURE_BAND: 220, // px above the rail where the pull is felt
  CAPTURE_PULL: 0.012,
  RAIL_SNAP: 12, // px — inside this, a particle is "on the rail"
  RAIL_SPEED: 2.0, // laminar speed along the rail
  TTL_MIN: 420, // frames before a filament respawns into the sprawl
  TTL_MAX: 980,
  MOUSE_R: 120,
  MOUSE_PUSH: 1.1,
  FADE: 'rgba(9,9,11,0.085)', // trail decay — matches the site background
  FILAMENT: '201,201,197',
  ALPHA: { drift: 0.18, mid: 0.28, rail: 0.55 },
  DECAY: 0.06, // trail erase per frame — lower = longer filaments
  PULSE_EVERY: 2600, // ms between settlements
  PULSE_TRAVEL: 1500, // ms for the pulse to cross
  PULSE_IGNITE: 60, // px — rail filaments this close to the head flash accent
  ACCENT: '#3ECF8E', // = --accent; the one rationed color moment
}

interface Particle {
  x: number
  y: number
  px: number
  py: number
  sp: number
  ttl: number
  onRail: boolean
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function SettlementRail() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [settled, setSettled] = useState<number | null>(null)
  const shown = useRef(0) // animated display value, driven by rAF below

  // Real settled volume — seed once, then follow the public feed's cadence.
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/activity', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((a) => {
          if (alive && typeof a?.stats?.settledUsd === 'number') setSettled(a.stats.settledUsd)
        })
        .catch(() => {}) // feed down → meter simply never appears
    void load()
    const t = setInterval(load, 45_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const section = canvas.closest('section') ?? canvas.parentElement!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 0
    let H = 0
    let railY = 0
    let particles: Particle[] = []
    let raf = 0
    let running = false
    let pulseStart = -9999
    const mouse = { x: -9999, y: -9999 }

    const spawn = (): Particle => ({
      x: Math.random() * W,
      y: Math.random() * H,
      px: 0,
      py: 0,
      sp: P.SPEED_MIN + Math.random() * (P.SPEED_MAX - P.SPEED_MIN),
      ttl: P.TTL_MIN + Math.random() * (P.TTL_MAX - P.TTL_MIN),
      onRail: false,
    })

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      railY = H - P.RAIL_FROM_BOTTOM
      const cap = W < 640 ? P.MOBILE_MAX : P.MAX_PARTICLES
      particles = Array.from({ length: Math.min(cap, Math.round((W * H) / P.DENSITY)) }, spawn)
      ctx.clearRect(0, 0, W, H) // transparent base — the page bg shows through
    }

    const angle = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0016 + t * P.FIELD_DRIFT) * 0.9 +
      Math.cos(y * 0.0019 + t * P.FIELD_DRIFT * 0.8) * 0.9 +
      Math.sin((x + y) * 0.0007 - t * P.FIELD_DRIFT * 0.45) * 0.6

    const strokeGroup = (list: Particle[], style: string) => {
      if (list.length === 0) return
      ctx.strokeStyle = style
      ctx.beginPath()
      for (const p of list) {
        ctx.moveTo(p.px, p.py)
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    const step = (t: number, pulseX: number, pulseOn: boolean) => {
      const groups = { drift: [] as Particle[], mid: [] as Particle[], rail: [] as Particle[], lit: [] as Particle[] }
      for (const p of particles) {
        p.px = p.x
        p.py = p.y
        const d = railY - p.y
        let vx: number
        let vy: number
        if (Math.abs(d) <= P.RAIL_SNAP) {
          p.onRail = true
          vx = P.RAIL_SPEED + p.sp * 0.4
          vy = d * 0.06 + (Math.random() - 0.5) * 0.12
        } else {
          p.onRail = false
          const a = angle(p.x, p.y, t)
          vx = Math.cos(a) * p.sp
          vy = Math.sin(a) * p.sp
          if (Math.abs(d) < P.CAPTURE_BAND) vy += d * P.CAPTURE_PULL
        }
        const mx = p.x - mouse.x
        const my = p.y - mouse.y
        const md = Math.hypot(mx, my)
        if (md < P.MOUSE_R && md > 0.001) {
          const f = (1 - md / P.MOUSE_R) * P.MOUSE_PUSH
          vx += (mx / md) * f
          vy += (my / md) * f
        }
        p.x += vx
        p.y += vy
        p.ttl--
        if (p.ttl <= 0 || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) {
          Object.assign(p, spawn())
          p.px = p.x
          p.py = p.y
          continue
        }
        if (pulseOn && p.onRail && Math.abs(p.x - pulseX) < P.PULSE_IGNITE) groups.lit.push(p)
        else if (p.onRail) groups.rail.push(p)
        else if (Math.abs(d) < P.CAPTURE_BAND) groups.mid.push(p)
        else groups.drift.push(p)
      }
      return groups
    }

    const draw = (groups: ReturnType<typeof step>, pulseX: number, pulseOn: boolean) => {
      // Transparent-canvas trail decay: erase a slice of the previous frame,
      // then re-tint what survives — keeps the page bg visible underneath.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${P.DECAY})`
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(250,250,247,0.10)'
      ctx.beginPath()
      ctx.moveTo(0, railY)
      ctx.lineTo(W, railY)
      ctx.stroke()
      strokeGroup(groups.drift, `rgba(${P.FILAMENT},${P.ALPHA.drift})`)
      strokeGroup(groups.mid, `rgba(${P.FILAMENT},${P.ALPHA.mid})`)
      strokeGroup(groups.rail, `rgba(${P.FILAMENT},${P.ALPHA.rail})`)
      strokeGroup(groups.lit, P.ACCENT)
      if (pulseOn) {
        ctx.fillStyle = P.ACCENT
        ctx.globalAlpha = 0.07
        ctx.beginPath()
        ctx.arc(pulseX, railY, 13, 0, 7)
        ctx.fill()
        ctx.globalAlpha = 0.2
        ctx.beginPath()
        ctx.arc(pulseX, railY, 5.5, 0, 7)
        ctx.fill()
        ctx.globalAlpha = 0.95
        ctx.beginPath()
        ctx.arc(pulseX, railY, 2.2, 0, 7)
        ctx.fill()
        ctx.globalAlpha = 0.25
        ctx.strokeStyle = P.ACCENT
        ctx.beginPath()
        ctx.moveTo(Math.max(0, pulseX - 100), railY)
        ctx.lineTo(pulseX, railY)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    const frame = (now: number) => {
      if (!running) return
      if (now - pulseStart > P.PULSE_EVERY + P.PULSE_TRAVEL) pulseStart = now
      const prog = (now - pulseStart) / P.PULSE_TRAVEL
      const pulseOn = prog >= 0 && prog <= 1
      const pulseX = -40 + (W + 80) * prog
      draw(step(now * 0.001, pulseX, pulseOn), pulseX, pulseOn)
      raf = requestAnimationFrame(frame)
    }

    const staticRender = () => {
      // prefers-reduced-motion: advect once, leave a still engraving.
      for (let i = 0; i < 240; i++) draw(step(i * 0.016, -9999, false), 0, false)
    }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - r.left
      mouse.y = e.clientY - r.top
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }

    size()
    const ro = new ResizeObserver(() => {
      size()
      if (reduced) staticRender()
    })
    ro.observe(canvas)

    let io: IntersectionObserver | null = null
    if (reduced) {
      staticRender()
    } else {
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !running) {
          running = true
          raf = requestAnimationFrame(frame)
        } else if (!e.isIntersecting && running) {
          running = false
          cancelAnimationFrame(raf)
        }
      })
      io.observe(canvas)
      section.addEventListener('pointermove', onMove)
      section.addEventListener('pointerleave', onLeave)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      io?.disconnect()
      section.removeEventListener('pointermove', onMove)
      section.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  // Count-up: ease the displayed number toward the real total.
  const meterRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (settled == null) return
    let raf = 0
    const tick = () => {
      shown.current += (settled - shown.current) * 0.08
      if (meterRef.current) meterRef.current.textContent = fmtUsd(shown.current)
      if (Math.abs(settled - shown.current) > 0.005) raf = requestAnimationFrame(tick)
      else if (meterRef.current) meterRef.current.textContent = fmtUsd(settled)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [settled])

  return (
    <>
      <div className="hero__field" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      {settled != null && settled > 0 && (
        <div className="hero__meter mono" aria-hidden="true">
          <span className="hero__meter-usd">
            $<span ref={meterRef}>0.00</span>
          </span>
          <span className="hero__meter-cap">settled across yeetful</span>
        </div>
      )}
    </>
  )
}
