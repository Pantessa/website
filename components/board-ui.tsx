'use client'

// Shared primitives for the "board" rows — the per-venue money board on
// /activity and the MCP reputation board on /benchmarks read as one UI, so the
// medallion and the ratio ring live here rather than being cloned per page.

import { useState } from 'react'
import { getProtocolMark } from '@/components/protocol-marks'

/** Brand medallion: vendored protocol mark → full-color logo → lettermark.
 *  (Not BrandIcon: its Simple Icons fallback is pinned white, and these boards
 *  are fully themed — everything here tracks currentColor or is full-color.) */
export function Medallion({
  name,
  keys,
  logoUrl,
  size = 38,
}: {
  name: string
  keys: (string | null | undefined)[]
  logoUrl?: string | null
  size?: number
}) {
  const [logoFailed, setLogoFailed] = useState(false)
  const Mark = getProtocolMark(...keys, name)
  return (
    <span
      className="flex items-center justify-center rounded-xl border border-[var(--line)] flex-shrink-0 text-[color:var(--fg)]"
      style={{ width: size, height: size, background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}
      aria-hidden
    >
      {Mark ? (
        <Mark size={Math.round(size * 0.55)} />
      ) : logoUrl && !logoFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          width={Math.round(size * 0.58)}
          height={Math.round(size * 0.58)}
          onError={() => setLogoFailed(true)}
          style={{ display: 'block', objectFit: 'contain', borderRadius: size * 0.12 }}
          draggable={false}
        />
      ) : (
        <span
          style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.42, letterSpacing: '-0.04em' }}
        >
          {name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}

/** Ratio donut — accent arc over a faint track. Built→signed conversion on the
 *  venue board, endpoints-live on the reputation board. */
export function ConvRing({ pct, color = 'var(--accent)' }: { pct: number; color?: string }) {
  const r = 11
  const c = 2 * Math.PI * r
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden className="flex-shrink-0 -rotate-90">
      <circle cx="15" cy="15" r={r} fill="none" stroke="color-mix(in srgb, var(--fg) 12%, transparent)" strokeWidth="3.5" />
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.02, pct) * c} ${c}`}
      />
    </svg>
  )
}

/** Section header: mono eyebrow over the serif title, with a lede beneath. */
export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: React.ReactNode }) {
  return (
    <div className="actsec__head">
      <span className="swtry__eyebrow mono">{eyebrow}</span>
      <h2 className="swtry__h2">{title}</h2>
      {sub && <p className="swtry__sub">{sub}</p>}
    </div>
  )
}
