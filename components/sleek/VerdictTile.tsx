// THE VERDICT TILE (squad mobile-sleek, 2026-11-24): a call's verdict as one
// of the brand's tiles. The tile is the stone of the Cut P without its stem: a
// square with its top-left and bottom-right corners cut, lit above the
// diagonal and shaded below it. A tile that carries a mark has no gap between
// its tones and the mark is cut in the ground colour (brand guidelines, 5).
//
// Right and wrong differ by colour AND by glyph, never by colour alone. The
// colour comes from the `sk-<verdict>` class (components/sleek/sleek.css):
// the market's green for a call that came true, the market's red for a miss.
//
// Server-safe: plain SVG, no state. Geometry is the brand kit's
// (brand-kit/src/tiles.mjs): corner = 16/72 of the side.

import type { CSSProperties } from 'react'

export type Verdict = 'right' | 'wrong' | 'flat' | 'open'

const S = 24
const C = (S * 16) / 72
const f = (n: number) => +n.toFixed(2)

/** The tile's outline in a 24 box, for a caller that wants the silhouette alone. */
export const TILE_OUTLINE = `M ${f(C)} 0 L ${S} 0 L ${S} ${f(S - C)} L ${f(S - C)} ${S} L 0 ${S} L 0 ${f(C)} Z`
const LIT = `M ${f(C)} 0 L ${S} 0 L 0 ${S} L 0 ${f(C)} Z`
const SHADE = `M ${S} 0 L ${S} ${f(S - C)} L ${f(S - C)} ${S} L 0 ${S} Z`

const GLYPH: Record<Verdict, string> = {
  right: 'M 7 12.4 L 10.6 16 L 17.2 8.6',
  wrong: 'M 8 8 L 16 16 M 16 8 L 8 16',
  flat: 'M 7.5 12 L 16.5 12',
  // Not judged yet: three square dots, drawn as rects below (no stroke).
  open: '',
}

export interface VerdictTileProps {
  verdict: Verdict
  /** Side in px. 14 to 18 inline, 24 to 32 as a pin, 40 and up as a badge. */
  size?: number
  /** Leave the glyph out: at 12px and under a glyph is noise. */
  bare?: boolean
  /** Read aloud; omit when the words sit beside the tile. */
  label?: string
  className?: string
  style?: CSSProperties
}

export default function VerdictTile({ verdict, size = 24, bare, label, className, style }: VerdictTileProps) {
  const showGlyph = !bare && size > 12
  return (
    <svg
      className={`sk-tile sk-${verdict}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox={`0 0 ${S} ${S}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={style}
    >
      <path className="sk-tile__lit" d={LIT} />
      <path className="sk-tile__shade" d={SHADE} />
      {showGlyph && verdict !== 'open' && <path className="sk-tile__glyph" d={GLYPH[verdict]} />}
      {showGlyph && verdict === 'open' && [6.2, 10.6, 15].map((x) => <rect key={x} className="sk-tile__dot" x={x} y="10.6" width="2.8" height="2.8" />)}
    </svg>
  )
}
