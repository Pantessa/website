// components/Logo.tsx
// Pantessa — agent-graph "Y" mark + wordmark.
// The mark is single-color and inherits the current text color via `currentColor`,
// so it turns white on a dark nav and black on a light surface automatically.

import * as React from "react";

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function YeetfulMark({ size = 28, className, title = "Pantessa" }: MarkProps) {
  // Unique mask id per instance so multiple logos on one page don't collide.
  const uid = React.useId().replace(/:/g, "");
  const maskId = `yf-hub-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label={title}
    >
      <mask id={maskId}>
        <rect width="40" height="40" fill="#fff" />
        <circle cx="20" cy="20" r="1.9" fill="#000" />
      </mask>
      <g
        mask={`url(#${maskId})`}
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      >
        <line x1="20" y1="20" x2="9" y2="9" />
        <line x1="20" y1="20" x2="31" y2="9" />
        <line x1="20" y1="20" x2="20" y2="33" />
      </g>
      <g fill="currentColor">
        <circle cx="9" cy="9" r="4.4" />
        <circle cx="31" cy="9" r="4.4" />
        <circle cx="20" cy="33" r="4.4" />
      </g>
      <circle cx="20" cy="20" r="3" fill="none" stroke="currentColor" strokeWidth={2.2} />
    </svg>
  );
}

type LogoProps = {
  /** Mark height in px. Wordmark scales from this. */
  size?: number;
  /** Show the "yeetful" wordmark next to the mark. */
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
            // Falls back to Geist Mono; swap for your own --font-* var if different.
            fontFamily:
              'var(--font-geist-mono, "Geist Mono", ui-monospace, monospace)',
            fontWeight: 500,
            fontSize: Math.round(size * 0.95),
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          yeetful
        </span>
      )}
    </span>
  );
}

export default Logo;
