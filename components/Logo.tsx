// components/Logo.tsx
// Pantessa — "The Tessera" mark + wordmark, pavé cut.
// A diamond of packed tesserae — mixed lozenges and squares set around one
// stone — pan (all) + tessera (tile): every dapp a tile, together one
// picture. Tiles inherit `currentColor` so the mark flips with the theme;
// the stone rides the site accent (emerald on dark, deep emerald on light)
// unless a `stone` color is passed.

import * as React from "react";

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** 'full' = the 5×5 pavé quilt (17 pieces); 'compact' = the 5-piece
   *  pinwheel cut, which stays crisp below ~40px. 'auto' picks by size. */
  detail?: "auto" | "full" | "compact";
  /** Stone (the one tessera) fill. Defaults to the site accent. */
  stone?: string;
};

// Rotated tile lattice: cell (i,j) → screen ((i−j)·u·S, (i+j)·u·S); pieces
// are drawn at 45°, so a Chebyshev-square region of cells reads as a screen
// diamond. A "domino" spans two adjacent cells → a 1×2 lozenge. Packings are
// exact C4 pinwheels (rotate 90° in lattice = (i,j) → (−j,i)).
const S = Math.SQRT1_2;
const U = 30; // lattice cell
const G = 5.5; // grout
const RX = 4.5;

type Cell = [number, number];
type Piece = { ci: number; cj: number; li: number; lj: number };

const rot90 = ([i, j]: Cell): Cell => [-j, i];
function orbit4(d: [Cell, Cell]): [Cell, Cell][] {
  const out: [Cell, Cell][] = [d];
  for (let k = 0; k < 3; k++) out.push([rot90(out[k][0]), rot90(out[k][1])]);
  return out;
}
const dominoPiece = ([a, b]: [Cell, Cell]): Piece => ({
  ci: (a[0] + b[0]) / 2,
  cj: (a[1] + b[1]) / 2,
  li: Math.abs(a[0] - b[0]) + 1,
  lj: Math.abs(a[1] - b[1]) + 1,
});
const singlePiece = ([i, j]: Cell): Piece => ({ ci: i, cj: j, li: 1, lj: 1 });

// Full quilt: 8 dominoes + 8 singles on the 5×5 diamond.
const QUILT: Piece[] = [
  ...orbit4([[1, 0], [2, 0]] as [Cell, Cell]).map(dominoPiece),
  ...orbit4([[1, 1], [1, 2]] as [Cell, Cell]).map(dominoPiece),
  ...([[2, 1], [-1, 2], [-2, -1], [1, -2], [2, 2], [-2, 2], [-2, -2], [2, -2]] as Cell[]).map(singlePiece),
];
// Compact cut: 4 dominoes pinwheeling on the 3×3 diamond.
const CHUNK: Piece[] = orbit4([[1, 0], [1, 1]] as [Cell, Cell]).map(dominoPiece);

function pieceRect(p: Piece, fill: string, key: number) {
  const x = 100 + (p.ci - p.cj) * U * S;
  const y = 100 + (p.ci + p.cj) * U * S;
  const w = p.li * U - G;
  const h = p.lj * U - G;
  return (
    <rect
      key={key}
      x={-w / 2}
      y={-h / 2}
      width={w}
      height={h}
      rx={RX}
      fill={fill}
      transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(45)`}
    />
  );
}

export function YeetfulMark({
  size = 28,
  className,
  title = "Pantessa",
  detail = "auto",
  stone = "var(--accent, #3ECF8E)",
}: MarkProps) {
  const full = detail === "full" || (detail === "auto" && size >= 40);
  const pieces = full ? QUILT : CHUNK;
  // Quilt extent ≈ ±103 from center; the compact cut ≈ ±62.
  const r = full ? 112 : 66;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${100 - r} ${100 - r} ${2 * r} ${2 * r}`}
      fill="none"
      className={className}
      role="img"
      aria-label={title}
    >
      {pieces.map((p, k) => pieceRect(p, "currentColor", k))}
      {pieceRect(singlePiece([0, 0]), stone, -1)}
    </svg>
  );
}

type LogoProps = {
  /** Mark height in px. Wordmark scales from this. */
  size?: number;
  /** Show the "pantessa" wordmark next to the mark. */
  withWordmark?: boolean;
  className?: string;
};

export function Logo({ size = 28, withWordmark = true, className }: LogoProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.round(size * 0.42),
        color: "inherit",
        lineHeight: 1,
      }}
    >
      <YeetfulMark size={size} />
      {withWordmark && (
        <span
          style={{
            fontFamily:
              'var(--font-geist-mono, "Geist Mono", ui-monospace, monospace)',
            fontWeight: 500,
            fontSize: Math.round(size * 0.95),
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          pantessa
        </span>
      )}
    </span>
  );
}

export default Logo;
