// lib/brand-presets.ts — the "skin it" half of white-labeling, with no third
// party involved.
//
// Rule 7 draws its line at IDENTITY, not at pixels: a page must never wear
// someone else's logo, name, or domain attribution (lib/brand-denylist is the
// enforcement). A color, on its own, carries no identity — a creator picking
// a dark-green page is not claiming to be anyone. So the palette is a
// first-class, always-available control: presets here, plus a free hex on
// /dashboard/customize. Nothing in this file ever names or references another
// brand, and none of it touches the scan path.
//
// Every pair below is authored to survive the render math in lib/brand-theme:
//   · bg parses as a hex (normalizeBg)
//   · accent passes normalizeAccent (never near-white / near-black)
//   · |luminance(bg) − luminance(accent)| > 0.18, so brandThemeStyle's
//     contrast guard keeps the accent instead of swapping it for the ink
// The harness pins all three, so a new preset can't quietly render wrong.

import { hexLuminance, normalizeHex } from '@/lib/brand-theme'

/** Why this hex can't be used for this role, or null when it's fine. Mirrors
 *  the server's normalizeBg (any hex) / normalizeAccent (never near-white or
 *  near-black — those paint an invisible button in one theme or the other),
 *  so the field can state the rule before a 400 does. */
export function colorFieldError(role: 'bg' | 'accent', raw: string): string | null {
  const hex = normalizeHex(raw)
  if (!hex) return 'Use a hex color, like #1f6feb.'
  if (role === 'bg') return null
  const lum = hexLuminance(hex) ?? 0
  if (lum > 0.88) return 'Too light for an accent — it disappears on a light page. Try a deeper shade.'
  if (lum < 0.06) return 'Too dark for an accent — it disappears on a dark page. Try a brighter shade.'
  return null
}

export interface BrandPreset {
  id: string
  label: string
  bg: string
  accent: string
}

export const BRAND_PRESETS: readonly BrandPreset[] = [
  { id: 'slate', label: 'Slate', bg: '#0f172a', accent: '#38bdf8' },
  { id: 'emerald', label: 'Emerald', bg: '#052e21', accent: '#34d399' },
  { id: 'royal', label: 'Royal', bg: '#101a3d', accent: '#8b9cff' },
  { id: 'plum', label: 'Plum', bg: '#1d0f2b', accent: '#c084fc' },
  { id: 'ember', label: 'Ember', bg: '#1a0f0a', accent: '#fb923c' },
  { id: 'ink', label: 'Ink', bg: '#111111', accent: '#e2b714' },
  { id: 'paper', label: 'Paper', bg: '#f7f5f0', accent: '#1f6feb' },
  { id: 'mint', label: 'Mint', bg: '#eefaf3', accent: '#0f7d53' },
] as const

/** The preset a stored (bg, accent) pair came from, when it came from one —
 *  drives the selected state in the picker. Case/shorthand tolerant. */
export function presetFor(bg: string | null | undefined, accent: string | null | undefined): BrandPreset | null {
  const b = (bg ?? '').trim().toLowerCase()
  const a = (accent ?? '').trim().toLowerCase()
  return BRAND_PRESETS.find((p) => p.bg === b && p.accent === a) ?? null
}
