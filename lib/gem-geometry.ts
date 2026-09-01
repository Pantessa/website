// lib/gem-geometry.ts
// Pantessa — the Emerald Cut. ONE geometry source for every renderer:
// components/Logo.tsx (DOM), components/protocol-marks.tsx (first-party MCP
// tiles), lib/og-marks.ts (satori data-URI cards), app/icon.svg and the brand
// kit generator (public/brand/emerald/generate.js mirrors these numbers — if
// the geometry changes here, regenerate the kit).
//
// Pan (all) + tessera (a mosaic tile): an emerald cut is the one gem made
// entirely of tiles — rectangular step facets descending to an open table.
// The stone is drawn as nested octagonal bands; the eight corner miters are
// what make the octagons read as a cut stone rather than a target, and they
// are cut through a mask (holes, never painted lines) so the mark sits on any
// ground. The center is left open on purpose: it is the table, the flat plane
// where a signature lands.
//
// Weight ladder (the seal-era lesson, kept): a lacy cut cannot share a small
// box. `gemWeightFor` picks the cut for the rendered size — never ship the
// fine cut below 96px or the mark cut below 32px.

export type GemWeight = "fine" | "mark" | "icon";

/** The brand emerald — mirrors `--accent` in app/x402-design.css (dark). */
export const GEM_ACCENT = "#3ECF8E";

/** Stone proportions (viewBox 128). 112×88 ≈ the classic 1.27:1 emerald cut;
 *  corner cut 17 scales down with each ring so facets stay in proportion. */
const W0 = 112;
const H0 = 88;
const C0 = 17;
const CX = 64;
const CY = 64;

const WEIGHTS: Record<GemWeight, { rings: number; band: number; gap: number }> = {
  fine: { rings: 5, band: 4.6, gap: 2.4 },
  mark: { rings: 3, band: 8.6, gap: 4.0 },
  icon: { rings: 2, band: 12.5, gap: 5.5 },
};

/** Miter grout width — uniform across weights; subpixel at icon sizes. */
export const GEM_MITER_WIDTH = 2.6;

/** Emerald ramps, deep → bright, per ring count. Dark-theme inks; the light
 *  theme resolves via the `--gem-*` tokens in app/x402-design.css. */
export const GEM_TONES_DARK: Record<GemWeight, string[]> = {
  fine: ["#0B6B4A", "#0F8156", "#159B68", "#27B67A", "#3ECF8E"],
  mark: ["#0B6B4A", "#159B68", "#3ECF8E"],
  icon: ["#159B68", "#3ECF8E"],
};
export const GEM_TONES_LIGHT: Record<GemWeight, string[]> = {
  fine: ["#084A33", "#0A5C40", "#0C7A52", "#0D8158", "#0e8f62"],
  mark: ["#0A5C40", "#0C7A52", "#0e8f62"],
  icon: ["#0C7A52", "#0e8f62"],
};

/** Theme-aware fills for the DOM component: `--gem-N` tokens flip with
 *  data-theme; the fallbacks are the dark inks so the mark stays emerald on
 *  surfaces outside the site stylesheet. Ring index → token: fine uses 1..5,
 *  mark 1/3/5, icon 3/5 — so all weights share one five-token ramp. */
export function gemFillVars(weight: GemWeight): string[] {
  const dark = GEM_TONES_DARK[weight];
  const idx = weight === "fine" ? [1, 2, 3, 4, 5] : weight === "mark" ? [1, 3, 5] : [3, 5];
  return idx.map((n, i) => `var(--gem-${n}, ${dark[i]})`);
}

export function gemWeightFor(px: number): GemWeight {
  if (px < 32) return "icon";
  if (px < 96) return "mark";
  return "fine";
}

const f = (n: number) => +n.toFixed(2);

function octagonPath(w: number, h: number, c: number): string {
  const x0 = CX - w / 2, x1 = CX + w / 2, y0 = CY - h / 2, y1 = CY + h / 2;
  const p: [number, number][] = [
    [x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c],
    [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c],
  ];
  return "M " + p.map((q) => `${f(q[0])} ${f(q[1])}`).join(" L ") + " Z";
}

/** Corner-cut midpoints of an octagon, clockwise from top-right. */
function cornerMids(w: number, h: number, c: number): [number, number][] {
  return [
    [CX + w / 2 - c / 2, CY - h / 2 + c / 2],
    [CX + w / 2 - c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY - h / 2 + c / 2],
  ];
}

export type GemGeometry = {
  /** One evenodd band per ring, outer path + inner path, deep → bright. */
  bands: { outer: string; inner: string }[];
  /** The four corner miter cuts, outer corner → table corner. */
  miters: { x1: number; y1: number; x2: number; y2: number }[];
  miterWidth: number;
};

const cOf = (w: number) => C0 * (w / W0);

export function gemGeometry(weight: GemWeight): GemGeometry {
  const { rings, band, gap } = WEIGHTS[weight];
  const bands: GemGeometry["bands"] = [];
  let w = W0, h = H0;
  for (let i = 0; i < rings; i++) {
    const outer = octagonPath(w, h, cOf(w));
    const w2 = w - band * 2, h2 = h - band * 2;
    const inner = octagonPath(w2, h2, Math.max(2.5, cOf(w2)));
    bands.push({ outer, inner });
    w = w2 - gap * 2;
    h = h2 - gap * 2;
  }
  const mo = cornerMids(W0, H0, C0);
  const mi = cornerMids(w + 2, h + 2, Math.max(3, cOf(w)));
  const miters = mo.map((m, k) => ({ x1: f(m[0]), y1: f(m[1]), x2: f(mi[k][0]), y2: f(mi[k][1]) }));
  return { bands, miters, miterWidth: GEM_MITER_WIDTH };
}

/**
 * The mark as a raw SVG inner-body string (mask + banded stone), for renderers
 * that assemble their own `<svg>` shell: og-marks' data-URI cards and the
 * brand-kit generator. `fills` must have one entry per ring of the weight;
 * `fillOpacities` (optional, same length) supports accent-ramp re-inks.
 * Callers must pass a `maskId` unique within the composed document.
 */
export function gemSvgBody(
  weight: GemWeight,
  fills: string[],
  maskId: string,
  fillOpacities?: number[],
): string {
  const { bands, miters, miterWidth } = gemGeometry(weight);
  const cuts = miters
    .map((m) => `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="#000" stroke-width="${miterWidth}"/>`)
    .join("");
  const stone = bands
    .map((b, i) =>
      `<path d="${b.outer} ${b.inner}" fill-rule="evenodd" fill="${fills[i]}"${
        fillOpacities ? ` fill-opacity="${fillOpacities[i]}"` : ""
      }/>`,
    )
    .join("");
  return `<mask id="${maskId}"><rect width="128" height="128" fill="#fff"/>${cuts}</mask><g mask="url(#${maskId})">${stone}</g>`;
}

/** Accent-ramp opacities for white-label re-inks, deep → bright. */
export function gemAccentRamp(weight: GemWeight): number[] {
  return weight === "fine" ? [0.45, 0.58, 0.7, 0.85, 1] : weight === "mark" ? [0.55, 0.75, 1] : [0.72, 1];
}
