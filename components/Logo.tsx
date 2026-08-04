// components/Logo.tsx
// Pantessa — "The Tessera" mark + wordmark.
// A mosaic diamond condenses toward its center and parts around a void; the
// one tessera floats there — pan (all) + tessera (tile): every dapp a tile,
// together one picture. Tiles inherit `currentColor` so the mark flips with
// the theme; the stone rides the site accent (emerald on dark, deep emerald
// on light) unless a `stone` color is passed.

import * as React from "react";

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** 'full' = both courses (40 tesserae) + stone; 'compact' = inner course +
   *  stone, which stays crisp below ~40px. 'auto' picks by size. */
  detail?: "auto" | "full" | "compact";
  /** Stone (the one tessera) fill. Defaults to the site accent. */
  stone?: string;
};

// Rotated tile lattice: screen = ((i-j)·p·S, (i+j)·p·S), tiles at 45°.
// The 3×3 center block is the void; ring m=2 is the inner course (16 tiles),
// ring m=3 the outer (24 tiles). Same numbers as the brand masters.
const S = Math.SQRT1_2;
const PITCH = 24;
const INNER_TILE = 21;
const OUTER_TILE = 13;
const STONE = 30;

function courses(full: boolean) {
  const cells: Array<{ x: number; y: number; a: number; rx: number }> = [];
  const max = full ? 3 : 2;
  for (let i = -max; i <= max; i++) {
    for (let j = -max; j <= max; j++) {
      const m = Math.max(Math.abs(i), Math.abs(j));
      if (m < 2) continue;
      cells.push({
        x: 100 + (i - j) * PITCH * S,
        y: 100 + (i + j) * PITCH * S,
        a: m === 2 ? INNER_TILE : OUTER_TILE,
        rx: m === 2 ? 3.5 : 2.8,
      });
    }
  }
  return cells;
}

export function YeetfulMark({
  size = 28,
  className,
  title = "Pantessa",
  detail = "auto",
  stone = "var(--accent, #3ECF8E)",
}: MarkProps) {
  const full = detail === "full" || (detail === "auto" && size >= 40);
  // Full-mark tips reach ~±111 from center; the compact course ~±83.
  const r = full ? 118 : 92;
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
      {courses(full).map((c, k) => (
        <rect
          key={k}
          x={-c.a / 2}
          y={-c.a / 2}
          width={c.a}
          height={c.a}
          rx={c.rx}
          fill="currentColor"
          transform={`translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) rotate(45)`}
        />
      ))}
      <rect
        x={-STONE / 2}
        y={-STONE / 2}
        width={STONE}
        height={STONE}
        rx={5}
        fill={stone}
        transform="translate(100 100) rotate(45)"
      />
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
