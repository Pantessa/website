'use client'

import { useEffect, useRef, useState } from 'react'
import { YEET_ICONS } from '@/lib/mcp-data'

interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  emoji: string
  label: string
  size: number
  opacity: number
  rotation: number
  rotationSpeed: number
  phase: number
}

function createParticle(id: number, width: number, height: number): Particle {
  const icon = YEET_ICONS[id % YEET_ICONS.length]
  return {
    id,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 1.2,
    vy: (Math.random() - 0.5) * 1.2,
    emoji: icon.emoji,
    label: icon.label,
    size: 24 + Math.random() * 28,
    opacity: 0.15 + Math.random() * 0.55,
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 2.5,
    phase: Math.random() * Math.PI * 2,
  }
}

export default function ParticleHeader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const [dims, setDims] = useState({ w: 1200, h: 160 })

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      const h = 160
      setDims({ w, h })
      particlesRef.current = Array.from({ length: 28 }, (_, i) =>
        createParticle(i, w, h)
      )
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = dims.w
    canvas.height = dims.h

    let frame = 0

    const draw = () => {
      ctx.clearRect(0, 0, dims.w, dims.h)
      frame++

      particlesRef.current.forEach((p) => {
        // Yeet-like: particles drift with slight wobble
        p.x += p.vx + Math.sin(frame * 0.01 + p.phase) * 0.3
        p.y += p.vy + Math.cos(frame * 0.015 + p.phase) * 0.3
        p.rotation += p.rotationSpeed

        // Bounce off edges with a "yeet" reversal
        if (p.x < -60) p.x = dims.w + 60
        if (p.x > dims.w + 60) p.x = -60
        if (p.y < -60) p.y = dims.h + 60
        if (p.y > dims.h + 60) p.y = -60

        // Breathing opacity
        const breathe = 0.7 + 0.3 * Math.sin(frame * 0.02 + p.phase)
        const finalOpacity = p.opacity * breathe

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate((p.rotation * Math.PI) / 180)
        ctx.globalAlpha = finalOpacity
        ctx.font = `${p.size}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        // Glow effect
        ctx.shadowColor = 'rgba(200, 200, 255, 0.6)'
        ctx.shadowBlur = 12
        ctx.fillText(p.emoji, 0, 0)
        ctx.shadowBlur = 0

        ctx.restore()
      })

      animRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [dims])

  return (
    <div className="relative w-full overflow-hidden" style={{ height: 160 }}>
      {/* Deep background gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950" />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ mixBlendMode: 'screen' }}
      />
      {/* Gradient fade bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-zinc-950 to-transparent" />
      {/* Title */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white select-none">
          <span className="text-white">Yeet</span>
          <span className="text-zinc-400">ful</span>
        </h1>
        <p className="mt-1 text-zinc-500 text-sm font-medium tracking-widest uppercase">
          MCP Power Chat — Combine Any Server
        </p>
      </div>
    </div>
  )
}
