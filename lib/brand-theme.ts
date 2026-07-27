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
 * on dark ones. `fullBleed` paints the bg past a width-constrained
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
          '--surf-1': `color-mix(in srgb, #ffffff ${dark ? 9 : 62}%, ${brand.bg})`,
          '--surf-2': `color-mix(in srgb, #ffffff ${dark ? 15 : 78}%, ${brand.bg})`,
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
 */
export function brandCtaStyle(brand: LinkBrand | null | undefined): CSSProperties | undefined {
  if (!brand?.bg) return undefined
  const accent = safeAccent(brand)
  if (!accent) return undefined
  const lum = hexLuminance(accent)
  return { background: accent, color: lum !== null && lum < 0.5 ? '#f6f8fa' : '#0c0e12' }
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
