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
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import CreateAccountButton from '@/components/CreateAccountButton'
import { getProtocolMark } from '@/components/protocol-marks'
import { useSiteTheme } from '@/components/chart-theme'

const EMBED_SRC = '/embed?mcps=uniswap-free,snapshot-free&theme=dark'

/** Stream sources — normalized anchors, protocol hue, and the chip label.
 * Desktop shows labeled medallions at these anchors; phones tuck the streams
 * into the corners and show a plain chip row instead. The medallion shows the
 * protocol's real mark (resolved from the shared registry) in its brand hue,
 * falling back to `glyph` for "your MCP". */
const SOURCES = [
  { x: 0.09, y: 0.3, color: '#FF6BAF', light: '#d81f78', name: 'Uniswap', glyph: 'U', dashed: false },
  { x: 0.91, y: 0.27, color: '#FFC94D', light: '#b07c00', name: 'Snapshot', glyph: '⚡', dashed: false },
  { x: 0.11, y: 0.76, color: '#7AA7FF', light: '#2f62d9', name: 'CoW', glyph: 'C', dashed: false },
  { x: 0.89, y: 0.78, color: '#34e3a0', light: '#0e8f62', name: 'your MCP', glyph: '+', dashed: true },
]

/** Canvas palettes per theme. Dark paints additive light ('lighter' blends
 * glows on black); light paints ink on paper (plain compositing, deeper
 * hues, a soft emerald bloom for the core). Read live each frame so the
 * footer toggle re-inks the art without a remount. */
const CANVAS_PALETTES = {
  dark: {
    composite: 'lighter' as GlobalCompositeOperation,
    source: (i: number) => SOURCES[i].color,
    core0: 'rgba(210,255,236,',
    core1: 'rgba(52,227,160,',
    nucleus: 'rgba(235,255,246,',
    writerA: '#8effc9',
    writerB: '#ffd98a',
    burst: '#8effc9',
    ring: 'rgba(52,227,160,',
  },
  light: {
    composite: 'source-over' as GlobalCompositeOperation,
    source: (i: number) => SOURCES[i].light,
    core0: 'rgba(12,122,84,',
    core1: 'rgba(14,143,98,',
    nucleus: 'rgba(7,74,51,',
    writerA: '#0e8f62',
    writerB: '#a3720c',
    burst: '#0e8f62',
    ring: 'rgba(14,143,98,',
  },
}
const canvasPalette = () =>
  document.documentElement.dataset.theme === 'light' ? CANVAS_PALETTES.light : CANVAS_PALETTES.dark

/** The mark for a source's `<i>` glyph slot — real logo when we have one. */
function SourceGlyph({ name, glyph }: { name: string; glyph: string }) {
  const Mark = getProtocolMark(name)
  return <i>{Mark ? <Mark size={20} /> : glyph}</i>
}
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
/** A "writer" — a burst particle that flies from the core to the caption and
 * delivers the transmutation line (the text reveals as these arrive). */
interface Writer {
  t: number
  speed: number
  ox: number
  oy: number
  jitter: number
}

function FusionCanvas({
  pulseRef,
  captionAnchorRef,
}: {
  pulseRef: React.MutableRefObject<number>
  /** Caption center in section-local px — where writer particles land. */
  captionAnchorRef: React.MutableRefObject<{ x: number; y: number } | null>
}) {
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
    const writers: Writer[] = []
    let rings: { r: number; a: number }[] = []
    let lastPulse = pulseRef.current

    // Cursor lens — the rivers bend around the pointer. Smoothed so the
    // field flexes instead of snapping; influence decays to zero when the
    // pointer leaves the hero.
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, k: 0, tk: 0 }
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.tx = e.clientX - r.left
      mouse.ty = e.clientY - r.top
      mouse.tk = 1
    }
    const onLeave = () => {
      mouse.tk = 0
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)

    const spawn = () => {
      if (particles.length > (w < 760 ? 110 : 230)) return
      const src = Math.floor(Math.random() * SOURCES.length)
      particles.push({
        src,
        t: 0,
        // unhurried: a river droplet takes ~2–3.5s edge → core
        speed: 0.00028 + Math.random() * 0.00026,
        size: 0.8 + Math.random() * 1.7,
        drift: Math.random() * Math.PI * 2,
      })
    }

    const drawCore = (now: number, flash: number) => {
      const pal = canvasPalette()
      // ink on paper wants a gentler bloom than additive light on black
      const soft = pal.composite === 'lighter' ? 1 : 0.6
      const cx = px(CORE.x)
      const cy = py(CORE.y)
      const breathe = 1 + 0.08 * Math.sin(now / 1200)
      const R = Math.min(w, h) * 0.16 * breathe * (1 + flash * 0.25)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
      g.addColorStop(0, `${pal.core0}${(0.5 + flash * 0.4) * soft})`)
      g.addColorStop(0.25, `${pal.core1}${(0.28 + flash * 0.25) * soft})`)
      g.addColorStop(0.6, `${pal.core1}${0.07 * soft})`)
      g.addColorStop(1, `${pal.core1}0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()
      // nucleus
      ctx.fillStyle = `${pal.nucleus}${0.8 + flash * 0.2})`
      ctx.beginPath()
      ctx.arc(cx, cy, 2.6 + flash * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    const drawStatic = () => {
      const pal = canvasPalette()
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = pal.composite
      // dotted field lines + a calm core — the no-motion rendering
      SOURCES.forEach((s, i) => {
        ctx.strokeStyle = `${pal.source(i)}55`
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
      // the static frame must re-ink when the footer toggle flips the theme
      const mo = new MutationObserver(onR)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => {
        mo.disconnect()
        window.removeEventListener('resize', onR)
        window.removeEventListener('resize', resize)
        window.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseleave', onLeave)
      }
    }

    let raf = 0
    let last = performance.now()
    let flash = 0
    const loop = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      if (!document.hidden) {
        for (let i = 0; i < 2; i++) spawn()

        // ease the cursor lens toward its target
        mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt / 160)
        mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt / 160)
        mouse.k += (mouse.tk - mouse.k) * Math.min(1, dt / 300)
        const LENS_R2 = 2 * 170 * 170

        // a transmutation was requested by the caption cycler
        if (pulseRef.current !== lastPulse) {
          lastPulse = pulseRef.current
          rings.push({ r: 8, a: 0.75 })
          flash = 1
          const cx = px(CORE.x)
          const cy = py(CORE.y)
          for (let i = 0; i < 10; i++) {
            const ang = Math.random() * Math.PI * 2
            const v = 0.02 + Math.random() * 0.05
            bursts.push({ x: cx, y: cy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 1 })
          }
          // the writers — they carry the line from the core to the caption
          for (let i = 0; i < 16; i++) {
            writers.push({
              t: 0,
              speed: 0.0012 + Math.random() * 0.0009,
              ox: (Math.random() - 0.5) * 120,
              oy: (Math.random() - 0.5) * 60,
              jitter: Math.random() * Math.PI * 2,
            })
          }
        }
        flash = Math.max(0, flash - dt / 900)

        const pal = canvasPalette()
        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = pal.composite

        // rivers (bent by the cursor lens)
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]
          p.t += p.speed * dt
          if (p.t >= 1) {
            particles.splice(i, 1)
            continue
          }
          const pos = point(p.src, p.t)
          const wob = Math.sin(p.t * 10 + p.drift) * 6 * (1 - p.t)
          let x = pos.x + wob
          let y = pos.y + wob * 0.6
          if (mouse.k > 0.01) {
            const dx = mouse.x - x
            const dy = mouse.y - y
            const pull = 0.34 * mouse.k * Math.exp(-(dx * dx + dy * dy) / LENS_R2)
            x += dx * pull
            y += dy * pull
          }
          const alpha = Math.sin(Math.PI * p.t) * 0.85
          ctx.fillStyle = pal.source(p.src)
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.arc(x, y, p.size * (0.6 + 0.6 * (1 - p.t)), 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1

        // writers: core → caption, easing in, delivering the text
        const anchor = captionAnchorRef.current
        for (let i = writers.length - 1; i >= 0; i--) {
          const wr = writers[i]
          wr.t += wr.speed * dt
          if (wr.t >= 1 || !anchor) {
            writers.splice(i, 1)
            continue
          }
          const e = 1 - Math.pow(1 - wr.t, 3) // ease-out cubic
          const cx = px(CORE.x)
          const cy = py(CORE.y)
          const x = cx + (anchor.x - cx) * e + wr.ox * Math.sin(Math.PI * wr.t)
          const y = cy + (anchor.y - cy) * e + wr.oy * Math.sin(Math.PI * wr.t) + Math.sin(wr.t * 14 + wr.jitter) * 3
          ctx.globalAlpha = Math.sin(Math.PI * wr.t) * 0.9
          ctx.fillStyle = wr.jitter > Math.PI ? pal.writerA : pal.writerB
          ctx.beginPath()
          ctx.arc(x, y, 1.5, 0, Math.PI * 2)
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
          ctx.fillStyle = pal.burst
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
          ctx.strokeStyle = `${pal.ring}${r.a})`
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
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [pulseRef, captionAnchorRef])

  return <canvas ref={canvasRef} className="fhero__canvas" aria-hidden="true" />
}

/** What a REAL turn in the summoned chat renders as — actual outcomes drive
 * the transmutation, so the art and the product become the same object. */
const LIVE_LINES: Record<string, string> = {
  answered: '✓ answered live · $0.00 · receipted',
  clarify: '… the agent asked a clarifying question — live',
  'tx-built': '⇄ transaction built live — waiting for a signature in the chat',
  signed: '✍ signed — receipted on-chain, just now',
}

export default function HomeHeroFusion() {
  const pulseRef = useRef(0)
  const sectionRef = useRef<HTMLElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)
  const captionAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const [captionIdx, setCaptionIdx] = useState(0)
  const [live, setLive] = useState(false)
  const [liveLine, setLiveLine] = useState<string | null>(null)
  const liveAtRef = useRef(0)
  const [embedSrc, setEmbedSrc] = useState(EMBED_SRC)
  const lightMode = useSiteTheme()

  // "Get started" opens the sign-in modal for newcomers instead of dumping
  // them on the SIWE-gated dashboard. Signed-in / connected visitors skip the
  // modal and go straight to /dashboard. mounted-gated so SSR and the first
  // client render agree (wagmi state only exists post-hydration).
  const { isConnected } = useAccount()
  const { address: sessionAddress } = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const showSignInModal = mounted && cdpEnabled && !isConnected && !sessionAddress

  // Pin the embed to this origin so its postMessage events reach us, and
  // hand it the site theme so the summoned chat matches the page.
  useEffect(() => {
    const src = lightMode ? EMBED_SRC.replace('theme=dark', 'theme=light') : EMBED_SRC
    setEmbedSrc(`${src}&host=${encodeURIComponent(window.location.origin)}`)
  }, [lightMode])

  // The transmutation clock: rotate the caption and ask the canvas for a
  // ring pulse + writer burst on the same beat — unless a REAL turn just
  // happened (the live line holds the stage for ~9s).
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - liveAtRef.current < 9000) return
      setLiveLine(null)
      setCaptionIdx((i) => (i + 1) % TRANSMUTATIONS.length)
      pulseRef.current++
    }, 4600)
    return () => clearInterval(id)
  }, [])

  // REAL transmutations: the summoned chat reports each turn (embed contract
  // 'event' messages) — actual outcomes drive the art, no script.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const d = e.data as { source?: string; type?: string; name?: string; data?: { outcome?: string } } | null
      if (!d || d.source !== 'yeetful-embed' || d.type !== 'event') return
      const outcome = d.name === 'order-signed' ? 'signed' : d.name === 'turn' ? d.data?.outcome : undefined
      const line = outcome ? LIVE_LINES[outcome] : undefined
      if (!line) return
      setLiveLine(line)
      liveAtRef.current = Date.now()
      pulseRef.current++
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Where the writers land: the caption's center, in section-local px
  // (the canvas fills the section, so section-local == canvas-local).
  useEffect(() => {
    const measure = () => {
      const sec = sectionRef.current?.getBoundingClientRect()
      const cap = captionRef.current?.getBoundingClientRect()
      captionAnchorRef.current =
        sec && cap ? { x: cap.left + cap.width / 2 - sec.left, y: cap.top + cap.height / 2 - sec.top } : null
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [captionIdx])

  return (
    <section className="fhero" ref={sectionRef}>
      <FusionCanvas pulseRef={pulseRef} captionAnchorRef={captionAnchorRef} />

      {/* labeled sources — the protocols feeding the core (desktop) */}
      <div className="fhero__chips" aria-hidden="true">
        {SOURCES.map((s) => (
          <span
            key={s.name}
            className={`fhero__chip mono${s.dashed ? ' fhero__chip--dashed' : ''}`}
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, ['--pc' as string]: lightMode ? s.light : s.color }}
          >
            <SourceGlyph name={s.name} glyph={s.glyph} /> {s.name}
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
          {/* Try it live → drop the user into /chat with the free Uniswap +
              Snapshot working set preselected, so the MCP cards auto-load.
              (The /embed overlay below is kept for later, just not shown.) */}
          <Link className="btn btn--solid" href="/chat?mcps=uniswap-free,snapshot-free">
            Try it live
          </Link>
          {showSignInModal ? (
            <CreateAccountButton className="btn btn--ghost" label="Get started" redirectTo="/dashboard" />
          ) : (
            <Link className="btn btn--ghost" href="/dashboard">
              Get started
            </Link>
          )}
        </div>
        {/* the transmutation readout — written by the burst: each character
            materializes as the writer particles arrive from the core */}
        <p className={`fhero__caption mono${liveLine ? ' fhero__caption--live' : ''}`} key={liveLine ?? captionIdx} ref={captionRef}>
          {liveLine && <span className="fhero__livedot" aria-hidden="true" />}
          {[...(liveLine ?? TRANSMUTATIONS[captionIdx])].map((ch, i) => (
            <span className="fhero__char" style={{ animationDelay: `${340 + i * 13}ms` }} key={i}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </p>
      </div>

      {/* phones: the sources as a plain row (the absolute chips hide) */}
      <div className="fhero__chiprow" aria-hidden="true">
        {SOURCES.map((s) => (
          <span key={s.name} className={`fhero__chip fhero__chip--flow mono${s.dashed ? ' fhero__chip--dashed' : ''}`} style={{ ['--pc' as string]: lightMode ? s.light : s.color }}>
            <SourceGlyph name={s.name} glyph={s.glyph} /> {s.name}
          </span>
        ))}
      </div>

      {/* Try it live — the REAL /embed chat, summoned instead of mocked.
          Portaled to <body> so its fixed positioning escapes the hero's
          `isolation: isolate` stacking context — otherwise later page
          sections paint over it on scroll. */}
      {live &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fhero__livewrap" role="dialog" aria-label="Yeetful chat — live">
            <div className="fhero__livebar">
              <span className="mono">
                <i /> Yeetful chat · live — Uniswap + Snapshot, one agent
              </span>
              <button className="fhero__liveclose" onClick={() => setLive(false)} aria-label="Close live chat">
                ✕
              </button>
            </div>
            <iframe className="fhero__liveframe" src={embedSrc} title="Yeetful chat — live" allow="clipboard-write; fullscreen" allowFullScreen />
          </div>,
          document.body,
        )}
    </section>
  )
}
