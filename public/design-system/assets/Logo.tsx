// components/Logo.tsx — standalone copy for external consumers.
// Pantessa — the Cut P mark + wordmark.
//
// A square stone is the bowl of a P and its open table is the counter. One
// cut runs from the top-right corner, through the table, to the left edge of
// the stem, and every other diagonal in the mark is parallel to it. The cut
// is a gap between two pieces (never a painted line), so the mark sits on any
// ground; the pieces take two emerald tones, lit and shade.
//
// The letter never changes with size, only the width of the cut: fine (2.6)
// at 96px and up, mark (3.2) from 32 to 95px, icon (6.5) below 32px.
// Full asset kit + generator: https://www.pantessa.com/brand/cut-p/

import * as React from "react";

export const GEM_ACCENT = "#3ECF8E";

type GemWeight = "fine" | "mark" | "icon";
const X0 = 28, X1 = 100, Y0 = 8, Y1 = 80, C = 16, S = 22, YB = 120, LENS = 0.46;
const CUT: Record<GemWeight, number> = { fine: 2.6, mark: 3.2, icon: 6.5 };
/** [lit, shade] */
const TONES = ["#3ECF8E", "#159B68"];

const f = (n: number) => +n.toFixed(2);
const path = (pts: [number, number][]) => "M " + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(" L ") + " Z";
function geometry(weight: GemWeight): string[] {
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
  return [path(lit), path(shade)];
}
const weightFor = (px: number): GemWeight => (px < 32 ? "icon" : px < 96 ? "mark" : "fine");

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Default renders the two emerald tones; `null` renders single-ink in
   *  `currentColor`; any other color re-inks both pieces (white-label). */
  accent?: string | null;
  weight?: GemWeight;
  /** Crop the box to the letter (72 by 112): `size` is then its height. */
  tight?: boolean;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = GEM_ACCENT,
  weight,
  tight = false,
}: MarkProps) {
  const pieces = geometry(weight ?? weightFor(size));
  const fills = accent === null ? ["currentColor", "currentColor"] : accent === GEM_ACCENT ? TONES : [accent, accent];
  const opacities = accent && accent !== GEM_ACCENT ? [1, 0.72] : null;
  return (
    <svg
      width={tight ? Math.round((size * (X1 - X0)) / (YB - Y0)) : size}
      height={size}
      viewBox={tight ? `${X0} ${Y0} ${X1 - X0} ${YB - Y0}` : "0 0 128 128"}
      className={className}
      role="img"
      aria-label={title}
    >
      {pieces.map((d, i) => (
        <path key={i} d={d} fill={fills[i]} fillOpacity={opacities ? opacities[i] : undefined} />
      ))}
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
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3), color: "inherit", lineHeight: 1 }}
    >
      <PantessaMark size={size} tight />
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
