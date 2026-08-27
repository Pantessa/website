// components/Logo.tsx
// Pantessa — the Open Seal mark + wordmark.
//
// Pan (all) + tessera (a mosaic tile). The mark is a guilloché seal: three
// bands of machine-turned lacework — the same engine-turning that makes money
// look like money, and the oldest anti-forgery visual system there is. No
// hand can draw it; only a machine holding perfectly steady — which is the
// product: deterministic, verifiable, beautiful up close.
//
// The heart is OPEN on purpose. Nothing sits in the middle because the middle
// is where the signature goes — a seal with a blank center is a seal awaiting
// countersign. (White-label surfaces can seat a creator's mark in it.)
//
// Every stroke rides `currentColor`, so the seal is white on the dark nav,
// ink on paper, or a creator's accent — one component, no second file. Below
// 48 px it automatically switches to the bold cut (fewer, heavier passes) so
// the turning survives icon sizes; that "ladder" is the rule real currency
// uses — lace at portrait size, one bold turn on the coin edge.
//
// Geometry is generated, not hand-drawn — lib/seal-geometry.ts is the one
// source. Full asset kit (green/black/white SVGs + social PNGs) and the
// standalone generator live in public/brand/seal/.

import * as React from "react";
import { sealArt, SEAL_BOLD_BELOW, type SealWeight } from "../lib/seal-geometry";

/** The house emerald. Mirrors `--accent` in app/x402-design.css. */
export const SEAL_ACCENT = "#3ECF8E";

/** @deprecated pangolin-era export; kept so old imports keep compiling. */
export const PANGOLIN_ACCENT = SEAL_ACCENT;

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Explicit ink for the strokes. Omit (or pass null) for `currentColor` —
   *  the right answer almost everywhere. A white-label surface can pass the
   *  creator's accent to re-ink the whole turning. */
  accent?: string | null;
  /** Force a cut; by default it follows the size ladder (bold below 48 px). */
  weight?: SealWeight;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = null,
  weight,
}: MarkProps) {
  const cut: SealWeight = weight ?? (size < SEAL_BOLD_BELOW ? "bold" : "defined");
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

/** @deprecated Use `PantessaMark`. Kept so existing import sites keep working
 *  through the rebrand; both render the same art. */
export const YeetfulMark = PantessaMark;

type LogoProps = {
  /** Mark height in px. The wordmark scales from this. */
  size?: number;
  /** Show the "pantessa" wordmark beside the mark. */
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
