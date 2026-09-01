// components/Logo.tsx
// Pantessa — the Emerald Cut mark + wordmark.
//
// Pan (all) + tessera (a mosaic tile): an emerald cut is the one gem made
// entirely of tiles — rectangular step facets descending to an open table.
// The brand emerald is the material itself, and the open center is the table:
// the flat plane where a signature lands. The corner miters (cut through a
// mask, so they are holes on any ground) are what make the nested octagons
// read as a cut stone rather than a target.
//
// The stone auto-picks its cut for the rendered size (fine ≥96px, mark 32–95,
// icon <32) — a lacy cut cannot share a small box. Geometry lives in
// lib/gem-geometry.ts; the full asset kit and its generator live in
// public/brand/emerald/.

import * as React from "react";
import {
  GEM_ACCENT,
  gemAccentRamp,
  gemFillVars,
  gemGeometry,
  gemWeightFor,
  type GemWeight,
} from "@/lib/gem-geometry";

export { GEM_ACCENT };

/** @deprecated The pangolin era's name for the brand accent. */
export const PANGOLIN_ACCENT = GEM_ACCENT;

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** `GEM_ACCENT` (default) renders the theme-aware emerald ramp; `null`
   *  renders a single-ink stone in `currentColor`; any other color re-inks
   *  the ramp for white-label surfaces. */
  accent?: string | null;
  /** Override the size-picked cut (e.g. force `icon` in a dense strip). */
  weight?: GemWeight;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = GEM_ACCENT,
  weight,
}: MarkProps) {
  const cut = weight ?? gemWeightFor(size);
  const { bands, miters, miterWidth } = gemGeometry(cut);
  // Unique mask id per instance so multiple marks on one page don't collide.
  const maskId = `pt-gem-${React.useId().replace(/:/g, "")}`;
  const fills =
    accent === null
      ? bands.map(() => "currentColor")
      : accent === GEM_ACCENT
        ? gemFillVars(cut)
        : bands.map(() => accent);
  const opacities = accent && accent !== GEM_ACCENT ? gemAccentRamp(cut) : null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label={title}
    >
      <mask id={maskId}>
        <rect width="128" height="128" fill="#fff" />
        {miters.map((m, k) => (
          <line key={k} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke="#000" strokeWidth={miterWidth} />
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
        gap: Math.round(size * 0.36),
        color: "inherit",
        lineHeight: 1,
      }}
    >
      <PantessaMark size={size} />
      {withWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-chat-display, Fraunces, Georgia, serif)',
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
