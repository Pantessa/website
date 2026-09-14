'use client'

// The tile bar — a shape drawn as one row of tiles, widths = percents.
// Shared by the Mosaic studio and the wallet page's "Rebalance for me" door.
//
// Tile colors are an 8-step color-mix(in oklch, var(--accent) N%, var(--bg))
// ramp so both themes come free. Label ink flips between var(--bg) and
// var(--fg) at the ramp midpoint: a high-accent tile is ~the accent color,
// and bg-on-accent has exactly the contrast the theme already guarantees
// for accent-on-bg — no hardcoded hexes, no per-theme branches.

import type { MosaicSlice } from '@/lib/mosaic'

/** Accent share per tile index. Descends so the first (usually biggest)
 *  tile reads loudest; ≥55 gets bg-colored ink. */
const TILE_RAMP = [92, 76, 62, 50, 38, 28, 20, 14]
export const tileBg = (i: number) => `color-mix(in oklch, var(--accent) ${TILE_RAMP[i % TILE_RAMP.length]}%, var(--bg))`
export const tileInk = (i: number) => (TILE_RAMP[i % TILE_RAMP.length] >= 55 ? 'var(--bg)' : 'var(--fg)')

export default function TileBar({ slices, size = 'lg' }: { slices: MosaicSlice[]; size?: 'lg' | 'sm' }) {
  if (slices.length === 0) return null
  const h = size === 'lg' ? 40 : 24
  return (
    <div
      className="flex w-full overflow-hidden rounded-lg border border-[var(--line)]"
      style={{ height: h }}
      aria-label={slices.map((s) => `${s.pct}% ${s.token}`).join(', ')}
    >
      {slices.map((s, i) => (
        <div
          key={`${s.token}-${i}`}
          className="flex items-center justify-center overflow-hidden px-1"
          style={{
            flexGrow: Math.max(s.pct, 0.001),
            flexBasis: 0,
            minWidth: size === 'lg' ? 38 : 26,
            background: tileBg(i),
            // Seams between tiles come from the bg itself — a border would
            // shift the widths off the percents.
            boxShadow: i > 0 ? 'inset 1px 0 0 var(--bg)' : undefined,
          }}
          title={`${s.pct}% ${s.token}`}
        >
          <span
            className={`mono truncate ${size === 'lg' ? 'text-[11px]' : 'text-[9.5px]'} font-semibold tabular-nums`}
            style={{ color: tileInk(i) }}
          >
            {s.pct}% {s.token}
          </span>
        </div>
      ))}
    </div>
  )
}
