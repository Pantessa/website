// components/Logo.tsx
// Pantessa — the Cut P mark + wordmark.
//
// A square stone is the bowl of a P and its open table is the counter. One
// cut runs from the top-right corner, through the table, to the left edge of
// the stem, and every other diagonal in the mark is parallel to it. The cut is
// a gap between two pieces (never a painted line), so the mark sits on any
// ground; the pieces take two emerald tones, lit and shade.
//
// The letter never changes with size, only the width of the cut: it widens as
// the mark shrinks (fine ≥96px, mark 32–95, icon <32) so it does not close up
// in a small box. Geometry lives in lib/gem-geometry.ts; the full asset kit
// and its generator live in public/brand/cut-p/.

import {
  GEM_ACCENT,
  GEM_BOX,
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
  /** `GEM_ACCENT` (default) renders the theme-aware emerald pair; `null`
   *  renders a single-ink mark in `currentColor`; any other color re-inks
   *  both pieces for white-label surfaces. */
  accent?: string | null;
  /** Override the size-picked cut (e.g. force `icon` in a dense strip). */
  weight?: GemWeight;
  /** A class on each of the two pieces, lit then shade in DOM order, for
   *  motion (the watchlist rail's brewing loader lights them in turn). */
  bandClassName?: string;
  /** Crop the box to the letter itself (72 by 112 on the grid) instead of the
   *  square: `size` is then the mark's HEIGHT and it is narrower than it is
   *  tall. For lockups, where the square's side air would read as a gap. */
  tight?: boolean;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = GEM_ACCENT,
  weight,
  bandClassName,
  tight = false,
}: MarkProps) {
  const cut = weight ?? gemWeightFor(size);
  const { pieces } = gemGeometry(cut);
  const fills =
    accent === null
      ? pieces.map(() => "currentColor")
      : accent === GEM_ACCENT
        ? gemFillVars(cut)
        : pieces.map(() => accent);
  const opacities = accent && accent !== GEM_ACCENT ? gemAccentRamp(cut) : null;
  return (
    <svg
      width={tight ? Math.round((size * GEM_BOX.w) / GEM_BOX.h) : size}
      height={size}
      viewBox={tight ? `${GEM_BOX.x} ${GEM_BOX.y} ${GEM_BOX.w} ${GEM_BOX.h}` : "0 0 128 128"}
      className={className}
      role="img"
      aria-label={title}
    >
      {pieces.map((d, i) => (
        <path
          key={i}
          className={bandClassName}
          d={d}
          fill={fills[i]}
          fillOpacity={opacities ? opacities[i] : undefined}
        />
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
      <PantessaMark size={size} tight />
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
