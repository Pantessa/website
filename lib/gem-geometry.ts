// lib/gem-geometry.ts
// Pantessa — the Cut P. ONE geometry source for every renderer:
// components/Logo.tsx (DOM), components/protocol-marks.tsx (first-party MCP
// tiles), lib/og-marks.ts (share cards), app/icon.svg and the brand kit
// generator (public/brand/cut-p/generate.js mirrors these numbers: if the
// geometry changes here, change it there and regenerate the kit).
//
// The mark, picked 2026-11-18 to replace the Emerald Cut (nested octagons
// that had no outline of their own at avatar size). It keeps the stone, the
// emerald and the open table, and gives them a letter:
//
//   - A SQUARE stone is the bowl of a P, and its open table is the counter.
//   - Because the stone is square, the top-right and lower-left miters lie on
//     one line. That line is THE CUT: it runs from the top-right corner,
//     through the table, to the left edge of the stem. Two pieces, two tones.
//   - Every diagonal in the mark is parallel to the cut: the top-left and
//     lower-right chamfers, the two sharp corners of the table, and the foot
//     of the stem. The top-right corner stays sharp, where the cut enters.
//
// The cut is a real gap between two polygons (never a painted line), so the
// mark sits on any ground. The table stays open: it is where a signature
// lands.
//
// Weight ladder: the letter never changes, only the width of the cut. A thin
// cut closes up in a small box, so `gemWeightFor` widens it as the mark
// shrinks. Never ship the fine cut below 96px or the mark cut below 32px.

export type GemWeight = "fine" | "mark" | "icon";

/** The brand emerald — mirrors `--accent` in app/x402-design.css (dark). */
export const GEM_ACCENT = "#3ECF8E";

/** The letter, on a 128 grid. The stone is X0..X1 by Y0..Y1 and must stay
 *  square: that is what puts the two miters on one line. */
const X0 = 28;
const X1 = 100;
const Y0 = 8;
const Y1 = 80;
/** Chamfer of the top-left and lower-right corners. */
const C = 16;
/** Stroke: the stem's width and the band around the table. */
const S = 22;
/** Bottom of the stem's long side. The foot is cut on the cut's own angle. */
const YB = 120;
/** How far the table's two blunt corners are cut back, as a share of its side. */
const LENS = 0.46;

/** The letter's own box inside the 128 grid, for renderers that crop to it. */
export const GEM_BOX = { x: X0, y: Y0, w: X1 - X0, h: YB - Y0 };

/** Width of the cut, in grid units, per weight. */
const CUT: Record<GemWeight, number> = { fine: 2.6, mark: 3.2, icon: 6.5 };

/** The two pieces, [lit, shade]. Dark-theme inks; the light theme resolves
 *  through the `--gem-*` tokens in app/x402-design.css. */
export const GEM_TONES_DARK: Record<GemWeight, string[]> = {
  fine: ["#3ECF8E", "#159B68"],
  mark: ["#3ECF8E", "#159B68"],
  icon: ["#3ECF8E", "#159B68"],
};
export const GEM_TONES_LIGHT: Record<GemWeight, string[]> = {
  fine: ["#0e8f62", "#0C7A52"],
  mark: ["#0e8f62", "#0C7A52"],
  icon: ["#0e8f62", "#0C7A52"],
};

/** Theme-aware fills for the DOM component, [lit, shade]: `--gem-5` and
 *  `--gem-3` flip with data-theme; the fallbacks are the dark inks so the mark
 *  stays emerald on surfaces outside the site stylesheet. */
export function gemFillVars(weight: GemWeight): string[] {
  const dark = GEM_TONES_DARK[weight];
  return [`var(--gem-5, ${dark[0]})`, `var(--gem-3, ${dark[1]})`];
}

export function gemWeightFor(px: number): GemWeight {
  if (px < 32) return "icon";
  if (px < 96) return "mark";
  return "fine";
}

const f = (n: number) => +n.toFixed(2);
const path = (pts: [number, number][]) =>
  "M " + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(" L ") + " Z";

export type GemGeometry = {
  /** The two pieces of the letter as closed paths, [lit, shade]: the lit
   *  piece is the top of the stone and the upper stem, the shade piece is the
   *  rest of the stone and the foot. */
  pieces: string[];
};

export function gemGeometry(weight: GemWeight): GemGeometry {
  // The cut is the line x + y = X1 + Y0. Each piece stops `h` short of it,
  // which leaves a gap CUT[weight] wide measured across the cut.
  const h = CUT[weight] / Math.SQRT2;
  const kx0 = X0 + S, kx1 = X1 - S, ky0 = Y0 + S, ky1 = Y1 - S;
  const l = (kx1 - kx0) * LENS;
  const lit: [number, number][] = [
    [X0 + C, Y0], [X1 - h, Y0], [kx1 - h, ky0], [kx0 + l, ky0],
    [kx0, ky0 + l], [kx0, ky1 - h], [X0, Y1 - h], [X0, Y0 + C],
  ];
  const shade: [number, number][] = [
    [X1, Y0 + h], [X1, Y1 - C], [X1 - C, Y1], [kx0, Y1], [kx0, YB - S], [X0, YB],
    [X0, Y1 + h], [kx0 + h, ky1], [kx1 - l, ky1], [kx1, ky1 - l], [kx1, ky0 + h],
  ];
  return { pieces: [path(lit), path(shade)] };
}

/**
 * The mark as a raw SVG inner-body string, for renderers that assemble their
 * own `<svg>` shell: og-marks' share cards and the brand-kit generator.
 * `fills` is [lit, shade]; `fillOpacities` (optional, same order) supports
 * single-accent re-inks.
 */
export function gemSvgBody(weight: GemWeight, fills: string[], fillOpacities?: number[]): string {
  return gemGeometry(weight)
    .pieces.map(
      (d, i) =>
        `<path d="${d}" fill="${fills[i] ?? fills[0]}"${fillOpacities ? ` fill-opacity="${fillOpacities[i]}"` : ""}/>`,
    )
    .join("");
}

/** Opacities for a white-label re-ink in one accent, [lit, shade]. */
export function gemAccentRamp(_weight: GemWeight): number[] {
  return [1, 0.72];
}
