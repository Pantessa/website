// components/Logo.tsx — standalone copy for external consumers.
// Pantessa — the Emerald Cut mark + wordmark.
//
// Pan (all) + tessera (a mosaic tile): an emerald cut is the one gem made
// entirely of tiles — rectangular step facets descending to an open table.
// The brand emerald is the material; the open center is the table, the flat
// plane where a signature lands. The corner miters are cut through a mask
// (holes, never painted lines), so the mark sits on any ground.
//
// The stone picks its cut by rendered size — a lacy cut cannot share a small
// box: fine (5 rings) ≥96px, mark (3 rings) 32–95px, icon (2 rings) <32px.
// Full asset kit + generator: https://www.pantessa.com/brand/emerald/

import * as React from "react";

export const GEM_ACCENT = "#3ECF8E";

type GemWeight = "fine" | "mark" | "icon";
const W0 = 112, H0 = 88, C0 = 17, CX = 64, CY = 64, MITER_W = 2.6;
const WEIGHTS: Record<GemWeight, { rings: number; band: number; gap: number }> = {
  fine: { rings: 5, band: 4.6, gap: 2.4 },
  mark: { rings: 3, band: 8.6, gap: 4.0 },
  icon: { rings: 2, band: 12.5, gap: 5.5 },
};
const TONES: Record<GemWeight, string[]> = {
  fine: ["#0B6B4A", "#0F8156", "#159B68", "#27B67A", "#3ECF8E"],
  mark: ["#0B6B4A", "#159B68", "#3ECF8E"],
  icon: ["#159B68", "#3ECF8E"],
};

const f = (n: number) => +n.toFixed(2);
const cOf = (w: number) => C0 * (w / W0);
function octagon(w: number, h: number, c: number): string {
  const x0 = CX - w / 2, x1 = CX + w / 2, y0 = CY - h / 2, y1 = CY + h / 2;
  const p: [number, number][] = [
    [x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c],
    [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c],
  ];
  return "M " + p.map((q) => `${f(q[0])} ${f(q[1])}`).join(" L ") + " Z";
}
function cornerMids(w: number, h: number, c: number): [number, number][] {
  return [
    [CX + w / 2 - c / 2, CY - h / 2 + c / 2],
    [CX + w / 2 - c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY - h / 2 + c / 2],
  ];
}
function geometry(weight: GemWeight) {
  const { rings, band, gap } = WEIGHTS[weight];
  const bands: { outer: string; inner: string }[] = [];
  let w = W0, h = H0;
  for (let i = 0; i < rings; i++) {
    const outer = octagon(w, h, cOf(w));
    const w2 = w - band * 2, h2 = h - band * 2;
    bands.push({ outer, inner: octagon(w2, h2, Math.max(2.5, cOf(w2))) });
    w = w2 - gap * 2; h = h2 - gap * 2;
  }
  const mo = cornerMids(W0, H0, C0);
  const mi = cornerMids(w + 2, h + 2, Math.max(3, cOf(w)));
  return { bands, miters: mo.map((m, k) => ({ x1: f(m[0]), y1: f(m[1]), x2: f(mi[k][0]), y2: f(mi[k][1]) })) };
}
const weightFor = (px: number): GemWeight => (px < 32 ? "icon" : px < 96 ? "mark" : "fine");

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Default renders the emerald facet ramp; `null` renders single-ink in
   *  `currentColor`; any other color re-inks the ramp (white-label). */
  accent?: string | null;
  weight?: GemWeight;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = GEM_ACCENT,
  weight,
}: MarkProps) {
  const cut = weight ?? weightFor(size);
  const { bands, miters } = geometry(cut);
  const maskId = `pt-gem-${React.useId().replace(/:/g, "")}`;
  const ramp = cut === "fine" ? [0.45, 0.58, 0.7, 0.85, 1] : cut === "mark" ? [0.55, 0.75, 1] : [0.72, 1];
  const fills =
    accent === null ? bands.map(() => "currentColor") : accent === GEM_ACCENT ? TONES[cut] : bands.map(() => accent);
  const opacities = accent && accent !== GEM_ACCENT ? ramp : null;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" className={className} role="img" aria-label={title}>
      <mask id={maskId}>
        <rect width="128" height="128" fill="#fff" />
        {miters.map((m, k) => (
          <line key={k} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke="#000" strokeWidth={MITER_W} />
        ))}
      </mask>
      <g mask={`url(#${maskId})`}>
        {bands.map((b, i) => (
          <path
            key={i}
            d={`${b.outer} ${b.inner}`}
            fillRule="evenodd"
            fill={fills[i]}
            fillOpacity={opacities ? opacities[i] : undefined}
          />
        ))}
      </g>
    </svg>
  );
}

/** @deprecated Use `PantessaMark`. */
export const YeetfulMark = PantessaMark;

type LogoProps = { size?: number; withWordmark?: boolean; className?: string };

export function Logo({ size = 28, withWordmark = true, className }: LogoProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.36), color: "inherit", lineHeight: 1 }}
    >
      <PantessaMark size={size} />
      {withWordmark && (
        <span
          style={{
            fontFamily: 'Fraunces, Georgia, "Times New Roman", serif',
            fontWeight: 600,
            fontSize: Math.round(size * 0.78),
            letterSpacing: "-0.015em",
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
