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

/**
 * The scoped re-theme for a branded surface. With a background, the whole
 * token ramp derives from its luminance (dark bg → near-white text); an
 * accent within 0.18 luminance of the bg would vanish, so it's guarded to
 * the derived fg. `fullBleed` paints the bg past a width-constrained
 * element's box (the .x-main gutters) via the box-shadow spread + clip-path
 * trick — no layout change, no horizontal scrollbar.
 */
export function brandThemeStyle(
  brand: LinkBrand | null | undefined,
  opts: { fullBleed?: boolean } = {},
): CSSProperties | undefined {
  if (!brand) return undefined
  const bgLum = hexLuminance(brand.bg)
  const fg = bgLum === null ? null : bgLum < 0.5 ? '#f4f6f8' : '#12141a'
  const accentLum = hexLuminance(brand.accent)
  const accentSafe =
    brand.accent && (bgLum === null || accentLum === null || Math.abs(accentLum - bgLum) > 0.18) ? brand.accent : fg
  if (!(brand.bg && fg) && !accentSafe) return undefined
  return {
    ...(brand.bg && fg
      ? {
          '--bg': brand.bg,
          '--fg': fg,
          '--muted': `color-mix(in srgb, ${fg} 68%, ${brand.bg})`,
          '--muted-2': `color-mix(in srgb, ${fg} 46%, ${brand.bg})`,
          '--line': `color-mix(in srgb, ${fg} 14%, ${brand.bg})`,
          '--surf-1': `color-mix(in srgb, ${fg} 5%, ${brand.bg})`,
          backgroundColor: brand.bg,
          color: fg,
          ...(opts.fullBleed ? { boxShadow: `0 0 0 100vmax ${brand.bg}`, clipPath: 'inset(0 -100vmax)' } : {}),
        }
      : {}),
    ...(accentSafe ? { '--accent': accentSafe } : {}),
  } as CSSProperties
}
