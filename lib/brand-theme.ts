// Brand theming shared by the /l storefront and the /i splash — pure color
// math only, importable from client components (lib/brand-scan.ts keeps the
// fetchers and re-exports these helpers for its own gates).

import type { CSSProperties } from 'react'

export interface LinkBrand {
  domain: string | null
  name: string | null
  logo: string | null
  accent: string | null
  bg: string | null
}

/** Parse a #rgb/#rrggbb hex to its expanded form, or null. */
export function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let hex = m[1].toLowerCase()
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return `#${hex}`
}

/** Relative luminance of a hex color (0 black → 1 white), null when unparsable. */
export function hexLuminance(raw: string | null | undefined): number | null {
  const hex = normalizeHex(raw)?.slice(1)
  if (!hex) return null
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The text ink a background luminance earns (dark bg → near-white). */
function derivedFg(bgLum: number | null): string | null {
  return bgLum === null ? null : bgLum < 0.5 ? '#f4f6f8' : '#12141a'
}

/** Hue angle (0–360) of a hex, or null when the color is effectively
 *  neutral (chroma too low for a hue to mean anything). */
function hexHue(raw: string | null | undefined): number | null {
  const hex = normalizeHex(raw)?.slice(1)
  if (!hex) return null
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const c = max - min
  if (c < 0.08) return null
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4
  return (h * 60 + 360) % 360
}

/** Shortest angular distance between two hues, or null if either is
 *  neutral. */
function hueDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  const ha = hexHue(a)
  const hb = hexHue(b)
  if (ha === null || hb === null) return null
  const d = Math.abs(ha - hb) % 360
  return d > 180 ? 360 - d : d
}

/** The accent, guarded: within 0.18 luminance of the bg it would vanish, so
 *  it collapses to the derived fg (harness-pinned behavior). */
function safeAccent(brand: LinkBrand): string | null {
  const bgLum = hexLuminance(brand.bg)
  const accentLum = hexLuminance(brand.accent)
  if (brand.accent && (bgLum === null || accentLum === null || Math.abs(accentLum - bgLum) > 0.18)) {
    return brand.accent
  }
  return derivedFg(bgLum)
}

/**
 * The scoped re-theme for a branded surface. With a background, the whole
 * token ramp derives from its luminance (dark bg → near-white text); an
 * accent within 0.18 luminance of the bg would vanish, so it's guarded to
 * the derived fg. Surfaces pull toward the white pole rather than mixing fg
 * into the bg — an fg mix keeps a saturated brand color saturated and
 * mid-luminance (CoW's light blue), collapsing card/border/muted hierarchy;
 * white-mixed panels read as paper cards on light brands and lifted panels
 * on dark ones. The light pole pulls HARD toward white: a hyper-saturated
 * brand bg (Robinhood's #ccff00) swallows a modest white mix, and the cards
 * flatten back into the field — the whole surface then reads as one tinted
 * pane with a film over it. `fullBleed` paints the bg past a width-constrained
 * element's box (the .x-main gutters) via the box-shadow spread + clip-path
 * trick — no layout change, no horizontal scrollbar.
 */
export function brandThemeStyle(
  brand: LinkBrand | null | undefined,
  opts: { fullBleed?: boolean } = {},
): CSSProperties | undefined {
  if (!brand) return undefined
  const bgLum = hexLuminance(brand.bg)
  const fg = derivedFg(bgLum)
  const accentSafe = safeAccent(brand)
  if (!(brand.bg && fg) && !accentSafe) return undefined
  const dark = bgLum !== null && bgLum < 0.5
  return {
    ...(brand.bg && fg
      ? {
          '--bg': brand.bg,
          '--fg': fg,
          '--muted': `color-mix(in srgb, ${fg} 82%, ${brand.bg})`,
          '--muted-2': `color-mix(in srgb, ${fg} 62%, ${brand.bg})`,
          '--line': `color-mix(in srgb, ${fg} 26%, ${brand.bg})`,
          '--line-2': `color-mix(in srgb, ${fg} 42%, ${brand.bg})`,
          '--surf-1': `color-mix(in srgb, #ffffff ${dark ? 9 : 84}%, ${brand.bg})`,
          '--surf-2': `color-mix(in srgb, #ffffff ${dark ? 15 : 93}%, ${brand.bg})`,
          backgroundColor: brand.bg,
          color: fg,
          ...(opts.fullBleed ? { boxShadow: `0 0 0 100vmax ${brand.bg}`, clipPath: 'inset(0 -100vmax)' } : {}),
        }
      : {}),
    ...(accentSafe ? { '--accent': accentSafe } : {}),
  } as CSSProperties
}

/**
 * The primary CTA on a branded surface: the accent as the fill, ink chosen
 * by the accent's own luminance. The stock .btn--solid paints fg-on-bg,
 * which on a branded splash turns into a near-black blob with saturated
 * brand-color text. Inline styles also outrank .btn--solid:hover's pale-grey
 * repaint, so the fill holds on hover. Undefined without a brand bg — house
 * and unbranded links keep the stock pill.
 *
 * SAME-HUE ACCENTS ARE SHADING, NOT A SECOND COLOR. Robinhood's neon
 * #ccff00 sampled a #526700 accent — the identical hue at a fifth of the
 * lightness, which fills the button with army-green mud. When the accent
 * sits within HUE_FAMILY degrees of the bg it's read as a shade of the
 * background and the CTA falls to the ink pole instead: near-black on a
 * light brand, near-white on a dark one. A genuinely different brand color
 * (CoW's #012f7a navy on #65d9ff, 22° apart) keeps its fill.
 */
const HUE_FAMILY = 14

export function brandCtaStyle(brand: LinkBrand | null | undefined): CSSProperties | undefined {
  if (!brand?.bg) return undefined
  const accent = safeAccent(brand)
  if (!accent) return undefined
  const bgLum = hexLuminance(brand.bg)
  const hueGap = hueDistance(accent, brand.bg)
  const sameFamily = hueGap !== null && hueGap < HUE_FAMILY
  const fill = sameFamily ? (bgLum !== null && bgLum < 0.5 ? '#f4f6f8' : '#0c0e12') : accent
  const lum = hexLuminance(fill)
  return { background: fill, color: lum !== null && lum < 0.5 ? '#f6f8fa' : '#0c0e12' }
}

/**
 * The ambient bloom behind a branded splash. An accent-tinted radial LIFTS
 * a surface only when the accent is lighter than the bg — the fusion-core
 * glow on Yeetful's own dark pages. Paint a darker accent over a light
 * brand and the same gradient becomes a smudge across the middle of the
 * page: it reads as a grey screen sitting on top of the design (live on
 * Robinhood's #ccff00 splash, 2026-07-28). So a bloom that would darken is
 * replaced by a white one, which lifts on any background.
 */
export function brandBloomTint(brand: LinkBrand | null | undefined, accentPct = 13): string {
  const accent = brand ? safeAccent(brand) : null
  const bgLum = hexLuminance(brand?.bg)
  const accentLum = hexLuminance(accent)
  const lifts = bgLum === null || accentLum === null || accentLum > bgLum
  return lifts
    ? `color-mix(in srgb, var(--accent) ${accentPct}%, transparent)`
    : `color-mix(in srgb, #ffffff ${accentPct * 2}%, transparent)`
}

/**
 * Flat colors for the OG/X share cards (satori renders no color-mix): the
 * brand bg drives ink/muted by luminance, the accent keeps the same
 * 0.18-luminance guard as the pages. Without a brand bg the house dark
 * palette comes back byte-identical, so unbranded cards don't shift.
 */
export function brandOgPalette(brand: LinkBrand | null | undefined): {
  bg: string
  ink: string
  /** "r,g,b" of the ink, for rgba() alphas (satori renders no color-mix). */
  inkRgb: string
  muted: string
  accent: string
  branded: boolean
} {
  const bg = normalizeHex(brand?.bg)
  if (!bg) {
    return { bg: '#050708', ink: '#FAFAF7', inkRgb: '250,250,247', muted: '#8a9186', accent: '#34e3a0', branded: false }
  }
  const lum = hexLuminance(bg) ?? 0
  const dark = lum < 0.5
  const ink = dark ? '#f4f6f8' : '#12141a'
  const inkRgb = dark ? '244,246,248' : '18,20,26'
  const accentRaw = normalizeHex(brand?.accent)
  const accentLum = hexLuminance(accentRaw)
  const accent =
    accentRaw && accentLum !== null && Math.abs(accentLum - lum) > 0.18 ? accentRaw : dark ? '#f4f6f8' : ink
  return { bg, ink, inkRgb, muted: `rgba(${inkRgb},0.66)`, accent, branded: true }
}
