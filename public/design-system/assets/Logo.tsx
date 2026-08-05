// components/Logo.tsx
// Pantessa — the pangolin mark + wordmark.
//
// Pan (all) + tessera (a mosaic tile): a pangolin is the one animal literally
// built out of tiles. Its armour is cut into overlapping plates by grout seams
// — the same plate-and-grout construction as the tessera system — and exactly
// one plate carries the accent: the set tessera.
//
// The armour rides `currentColor`, so it turns white on the dark nav and ink on
// a light surface with no second file. The eye is punched through the mask
// rather than painted, so it reads as a hole on any ground (a hardcoded dark
// dot disappears the moment the mark sits on a dark surface).
//
// Geometry is generated, not hand-drawn: one cubic spine → a tapering tube
// (body + tail) → three chevron grout cuts spaced evenly by arc length → a
// wider neck cut → head disc + blunt snout. Full asset kit and the generator
// live in public/brand/pangolin/.

import * as React from "react";

/** The accent the set plate is filled with. Mirrors `--accent` in
 *  app/x402-design.css. Overridable so white-label surfaces can drop a
 *  creator's scanned brand color into the plate. */
export const PANGOLIN_ACCENT = "#3ECF8E";

const BODY =
  "M 11.8 89.6 L 12.9 89.5 L 14.4 89.9 L 16.0 90.5 L 17.5 90.7 L 18.6 90.2 L 20.1 90.2 L 22.0 90.7 L 24.3 91.6 L 26.4 92.3 L 28.3 92.5 L 29.7 92.0 L 30.9 91.2 L 32.2 90.6 L 33.7 90.1 L 35.2 89.8 L 36.9 89.5 L 38.5 89.2 L 40.2 89.0 L 41.9 88.7 L 43.5 88.3 L 45.1 87.9 L 46.5 87.2 L 47.8 86.5 L 49.0 85.6 L 50.2 84.8 L 51.6 84.1 L 53.0 83.6 L 54.5 83.1 L 56.0 82.8 L 57.6 82.4 L 59.1 82.2 L 60.6 81.9 L 62.1 81.6 L 63.5 81.3 L 64.8 80.9 L 66.1 80.5 L 67.2 79.9 L 68.3 79.3 L 69.3 78.7 L 70.2 78.1 L 71.2 77.4 L 72.1 76.8 L 73.0 76.2 L 73.8 75.7 L 74.7 75.2 L 75.5 74.7 L 76.3 74.3 L 77.1 74.0 L 77.8 73.7 L 78.4 73.2 L 79.0 72.5 L 79.5 71.7 L 80.0 70.7 L 80.4 69.8 L 81.0 69.0 L 81.5 68.4 L 82.1 68.0 L 82.7 67.9 L 83.2 67.5 L 83.8 66.6 L 84.5 65.5 L 85.4 64.2 L 86.3 63.0 L 87.3 62.2 L 95.5 33.1 L 93.6 31.7 L 91.7 30.2 L 89.7 28.6 L 87.5 27.3 L 85.3 26.4 L 83.1 25.9 L 80.8 25.9 L 78.6 25.7 L 76.3 25.5 L 74.0 25.1 L 71.7 24.9 L 69.4 24.6 L 67.1 24.6 L 64.9 24.7 L 62.7 25.1 L 60.6 25.7 L 58.6 26.4 L 56.5 27.1 L 54.5 27.8 L 52.6 28.6 L 50.6 29.3 L 48.7 30.1 L 46.8 30.9 L 44.9 31.8 L 43.1 32.7 L 41.4 33.7 L 39.7 34.7 L 38.1 35.8 L 36.5 37.1 L 35.1 38.4 L 33.8 39.8 L 32.5 41.3 L 31.3 42.8 L 30.1 44.4 L 29.0 45.9 L 27.8 47.3 L 26.7 48.8 L 25.5 50.1 L 24.3 51.3 L 23.0 52.5 L 21.8 53.5 L 20.6 54.7 L 19.5 55.9 L 18.5 57.2 L 17.7 58.6 L 16.9 60.0 L 16.1 61.4 L 15.4 62.8 L 14.6 64.1 L 13.9 65.3 L 13.1 66.5 L 12.2 67.4 L 11.3 68.3 L 10.6 69.3 L 10.4 70.9 L 10.5 72.8 L 10.7 74.8 L 10.6 76.6 L 10.2 77.7 L 9.6 78.4 L 9.3 79.5 L 9.2 80.9 L 8.9 82.2 L 8.4 82.9 L 5.5 88.2 Z";
const SNOUT = "M 95.7 55.5 L 123.2 61.8 L 103.4 43.2 Z";
const CUTS: [string, number][] = [
  ["M 29.6 92.0 L 15.3 82.8 L 11.3 68.3", 7],
  ["M 62.6 81.5 L 40.8 62.9 L 34.2 39.3", 7],
  ["M 80.8 69.3 L 70.9 46.6 L 75.5 25.3", 7],
  ["M 87.3 62.2 L 84.8 45.0 L 95.5 33.1", 9],
];
const PLATE =
  "M 66.3 80.4 L 68.2 79.3 L 69.9 78.3 L 71.6 77.2 L 73.1 76.2 L 74.5 75.2 L 75.9 74.5 L 77.3 73.9 L 78.4 73.2 L 79.3 71.9 L 66.7 48.0 L 68.9 24.6 L 65.0 24.7 L 61.3 25.5 L 57.7 26.7 L 54.3 27.9 L 50.9 29.2 L 47.6 30.6 L 44.4 32.1 L 41.3 33.7 L 38.4 35.5 L 44.6 60.1 Z";
// The art's true ink box, and the transform that centres it in the 128 grid.
// Fitting to the grid instead of this box clips the snout and tail tip.
const BOX = { x: -1.0, y: 18.1, w: 130.7, h: 80.9 };
const FIT = "translate(6.86 12.04) scale(0.8877)";

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Fill for the set plate. Pass `null` for a single-ink mark. */
  accent?: string | null;
};

export function PantessaMark({
  size = 28,
  className,
  title = "Pantessa",
  accent = PANGOLIN_ACCENT,
}: MarkProps) {
  // Unique mask id per instance so multiple marks on one page don't collide.
  const maskId = `pt-pango-${React.useId().replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label={title}
    >
      <g transform={FIT}>
        <mask id={maskId}>
          <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} fill="#000" />
          <path d={BODY} fill="#fff" stroke="#fff" strokeWidth={5} strokeLinejoin="round" />
          <circle cx={100.9} cy={50.3} r={11} fill="#fff" />
          <path d={SNOUT} fill="#fff" stroke="#fff" strokeWidth={8} strokeLinejoin="round" />
          <g fill="none" stroke="#000" strokeLinejoin="round" strokeLinecap="round">
            {CUTS.map(([d, w]) => (
              <path key={d} d={d} strokeWidth={w} />
            ))}
          </g>
          {/* the eye — a hole, so it works on any ground */}
          <circle cx={101.0} cy={54.7} r={4.6} fill="#000" />
        </mask>
        <rect
          x={BOX.x}
          y={BOX.y}
          width={BOX.w}
          height={BOX.h}
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
        {accent && (
          <path d={PLATE} fill={accent} stroke={accent} strokeWidth={2.5} strokeLinejoin="round" />
        )}
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
