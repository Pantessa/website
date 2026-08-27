// components/Logo.tsx
// Pantessa — the Open Seal mark + wordmark. (Self-contained design-system
// copy of the site's components/Logo.tsx; the site version draws its geometry
// from lib/seal-geometry.ts.)
//
// Pan (all) + tessera (a mosaic tile). The mark is a guilloché seal: three
// bands of machine-turned lacework — the engine-turning that makes money look
// like money, the oldest anti-forgery visual system there is. The heart is
// OPEN on purpose: nothing sits in the middle because the middle is where the
// signature goes — a seal with a blank center is a seal awaiting countersign.
//
// Every stroke rides `currentColor`. The cut follows the size ladder
// automatically (defined ≥96 px, bold 40–95, icon below 40 — three strokes
// that stay crisp in a header) — the rule real currency uses: lace at
// portrait size, one bold turn on the coin edge.

import * as React from "react";

type SealWeight = "defined" | "bold" | "icon";

const CFG: Record<"defined" | "bold", { wM: number; aM: number; nC: number }> = {
  defined: { wM: 1, aM: 1, nC: 6 },
  bold: { wM: 1.5, aM: 1.1, nC: 4 },
};

function ringPath(R: number, A: number, k: number, phi: number): string {
  const N = 140;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = R + A * Math.sin(k * t + phi);
    pts.push(
      `${(64 + r * Math.cos(t)).toFixed(2)},${(64 + r * Math.sin(t)).toFixed(2)}`,
    );
  }
  return `M ${pts.join(" L ")} Z`;
}

function sealArt(weight: SealWeight) {
  if (weight === "icon") {
    return {
      rings: [
        { d: ringPath(34, 11, 7, 0), w: 8, op: 1 },
        { d: ringPath(34, 11, 7, Math.PI), w: 8, op: 1 },
      ],
      circles: [{ r: 56, w: 7, op: 1 }],
    };
  }
  const { wM, aM, nC } = CFG[weight];
  const rings: { d: string; w: number; op: number }[] = [];
  const band = (R: number, A: number, k: number, n: number, w: number, op: number) => {
    for (let j = 0; j < n; j++) {
      rings.push({ d: ringPath(R, A * aM, k, (j * Math.PI * 2) / n), w: w * wM, op });
    }
  };
  band(49, 4, 16, nC, 1.0, 0.9);
  band(35.5, 6, 9, nC, 1.15, 0.95);
  band(21, 6.5, 6, Math.max(3, nC - 1), 1.25, 1);
  return {
    rings,
    circles: [
      { r: 58, w: 0.9 * wM, op: 1 },
      { r: 55.5, w: 0.55 * wM, op: 0.65 },
      { r: 13, w: 0.5, op: 0.55 },
    ],
  };
}

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Explicit ink; omit for `currentColor`. */
  accent?: string | null;
  weight?: SealWeight;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = null,
  weight,
}: MarkProps) {
  const cut: SealWeight = weight ?? (size < 40 ? "icon" : size < 96 ? "bold" : "defined");
  const art = sealArt(cut);
  const ink = accent ?? "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label={title}
    >
      {art.circles.map((c) => (
        <circle
          key={`c${c.r}`}
          cx={64}
          cy={64}
          r={c.r}
          fill="none"
          stroke={ink}
          strokeWidth={c.w}
          opacity={c.op}
        />
      ))}
      {art.rings.map((p, i) => (
        <path key={i} d={p.d} fill="none" stroke={ink} strokeWidth={p.w} opacity={p.op} />
      ))}
    </svg>
  );
}

/** @deprecated Use `PantessaMark`. */
export const YeetfulMark = PantessaMark;

type LogoProps = {
  size?: number;
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
        gap: Math.round(size * 0.3),
        color: "inherit",
        lineHeight: 1,
      }}
    >
      <PantessaMark size={size} />
      {withWordmark && (
        <span
          style={{
            fontFamily:
              'var(--font-display, Archivo, system-ui, "Segoe UI", sans-serif)',
            fontWeight: 700,
            fontSize: Math.round(size * 0.82),
            letterSpacing: "-0.035em",
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
