// lib/seal-geometry.ts
// THE OPEN SEAL — Pantessa's mark (2026-08-27, supersedes the pangolin).
//
// Guilloché: the machine-turned lacework that makes money look like money.
// Three bands of turning — sixteen waves, then nine, then six — each a family
// of phase-shifted sine-modulated rings r(θ) = R + A·sin(kθ + φ), framed by
// hairline circles, OPEN at the heart: nothing sits in the middle because the
// middle is where the signature goes. A seal with a blank center is a seal
// awaiting countersign.
//
// Geometry is math, not hand-drawn path data — this module is the ONE source;
// components/Logo.tsx, components/protocol-marks.tsx and lib/og-marks.ts all
// draw from it, and public/brand/seal/generate.js mirrors the same constants
// for the standalone asset kit (if a constant changes here, mirror it there).
//
// Three weights, the "ladder" rule borrowed from real currency (lace at
// portrait size, one bold turn on the coin edge):
//   defined — 6 passes per band at full weight; hero art, 96 px and up.
//   bold    — 4 heavier passes, deeper waves; 40–95 px.
//   icon    — the essence: ONE heavy outer ring + a single two-pass woven
//             band (three strokes total). Anything under 40 px — headers,
//             tiles, favicons — where the lacier cuts haze into a fuzzy
//             circle.

export type SealWeight = 'defined' | 'bold' | 'icon'

type Ring = { d: string; w: number; op: number }
type Circ = { r: number; w: number; op: number }
export type SealArt = { rings: Ring[]; circles: Circ[] }

const CFG: Record<'defined' | 'bold', { wM: number; aM: number; nC: number }> = {
  defined: { wM: 1, aM: 1, nC: 6 },
  bold: { wM: 1.5, aM: 1.1, nC: 4 },
}

/** Size (px) below which callers should switch to the bold cut. */
export const SEAL_BOLD_BELOW = 96

/** Size (px) below which callers should switch to the icon cut. */
export const SEAL_ICON_BELOW = 40

/** The ladder, as a function: pick the right cut for a rendered size. */
export function sealWeightFor(size: number): SealWeight {
  return size < SEAL_ICON_BELOW ? 'icon' : size < SEAL_BOLD_BELOW ? 'bold' : 'defined'
}

function ringPath(R: number, A: number, k: number, phi: number): string {
  const N = 140
  const pts: string[] = []
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2
    const r = R + A * Math.sin(k * t + phi)
    pts.push(`${(64 + r * Math.cos(t)).toFixed(2)},${(64 + r * Math.sin(t)).toFixed(2)}`)
  }
  return `M ${pts.join(' L ')} Z`
}

const cache: Partial<Record<SealWeight, SealArt>> = {}

/** The seal's strokes for a 128×128 viewBox, centered at (64,64). */
export function sealArt(weight: SealWeight): SealArt {
  const hit = cache[weight]
  if (hit) return hit
  if (weight === 'icon') {
    // The essence cut: one heavy ring, one two-pass woven band, open heart.
    // Three strokes — at 26 px each still renders ≥ 1.4 px, so the weave
    // resolves instead of hazing.
    const art: SealArt = {
      rings: [
        { d: ringPath(34, 11, 7, 0), w: 8, op: 1 },
        { d: ringPath(34, 11, 7, Math.PI), w: 8, op: 1 },
      ],
      circles: [{ r: 56, w: 7, op: 1 }],
    }
    cache[weight] = art
    return art
  }
  const { wM, aM, nC } = CFG[weight]
  const rings: Ring[] = []
  const band = (R: number, A: number, k: number, n: number, w: number, op: number) => {
    for (let j = 0; j < n; j++) {
      rings.push({ d: ringPath(R, A * aM, k, (j * Math.PI * 2) / n), w: +(w * wM).toFixed(2), op })
    }
  }
  band(49, 4, 16, nC, 1.0, 0.9)
  band(35.5, 6, 9, nC, 1.15, 0.95)
  band(21, 6.5, 6, Math.max(3, nC - 1), 1.25, 1)
  const art: SealArt = {
    rings,
    circles: [
      { r: 58, w: +(0.9 * wM).toFixed(2), op: 1 },
      { r: 55.5, w: +(0.55 * wM).toFixed(2), op: 0.65 },
      { r: 13, w: 0.5, op: 0.55 },
    ],
  }
  cache[weight] = art
  return art
}

/** The same strokes as a raw SVG-body string (for satori/OG cards, which
 *  rasterize a self-contained `<svg>` via data-URI `<img>`). */
export function sealSvgBody(weight: SealWeight, color: string): string {
  const art = sealArt(weight)
  return (
    art.circles
      .map(
        (c) =>
          `<circle cx="64" cy="64" r="${c.r}" fill="none" stroke="${color}" stroke-width="${c.w}" opacity="${c.op}"/>`,
      )
      .join('\n    ') +
    '\n    ' +
    art.rings
      .map((p) => `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.w}" opacity="${p.op}"/>`)
      .join('\n    ')
  )
}
