// Route-level loader for the chat surfaces (app/chat*/loading.tsx). The chat
// bundle is heavy (wagmi + RainbowKit + the whole workspace), so navigation
// sits on a blank screen long enough to feel broken — this fills the gap with
// the brand doing the one thing it's named for: a proper YEET, staged like a
// tiny cartoon. A whip-arm winds up and launches the mark down a pre-drawn
// dotted trajectory (each dot flashes out as the mark passes it, then re-arms
// for the next throw), with squash-and-stretch through flight, a comet tail,
// a ground shadow tracking underneath, and a landing that bounces, ripples,
// and kicks dust before the cycle resets. Pure CSS (no client JS — it paints
// before hydration, which is the whole point); honors prefers-reduced-motion
// with a static mid-arc composition.
//
// Geometry crib: one cycle is 2.4s. Windup 0–12%, flight 12–56% (x linear —
// real throws have constant horizontal velocity — y quadratic ease out/in, so
// evenly-spaced dots sit exactly on the path), bounce 56–71%, rest, fade
// 87–93%, reset while invisible. Dot delays are the mark's passage time
// minus one cycle (negative → already mid-phase on first paint).

const LINES = [
  'yeeting your agents into place',
  'wiring up the working set',
  'warming the routing engine',
  'receipts, guardrails, signatures — loading',
]

// Trajectory dots: centers on the flight parabola (launch center x=36,
// travel 228px, peak 74px), passage at 12% + 44%·t of the 2.4s cycle.
const DOTS = [
  { left: 62, bottom: 53, delay: -1.98 },
  { left: 90, bottom: 76, delay: -1.848 },
  { left: 119, bottom: 90, delay: -1.716 },
  { left: 148, bottom: 94, delay: -1.584 },
  { left: 176, bottom: 90, delay: -1.452 },
  { left: 205, bottom: 76, delay: -1.32 },
  { left: 233, bottom: 53, delay: -1.188 },
]

export default function ChatLoader({
  inline = false,
  compact = false,
  lines = LINES,
}: {
  inline?: boolean
  /** Small in-flow slot (the /i splash's wallet check) — no tall min-height. */
  compact?: boolean
  /** Caption(s) under the throw. One line renders static (no carousel). */
  lines?: string[]
}) {
  return (
    <div
      className={`yload${inline || compact ? ' yload--inline' : ''}${compact ? ' yload--compact' : ''}`}
      role="status"
      aria-label="Loading chat"
    >
      <div className="yload__stage" aria-hidden>
        {/* launcher: base pad + the whip arm that throws */}
        <span className="yload__pad" />
        <span className="yload__arm" />
        {/* release burst at the moment of launch */}
        <span className="yload__flash" />
        {/* the pre-drawn aim: dots on the parabola, consumed as the mark passes */}
        {DOTS.map((d) => (
          <span
            key={d.left}
            className="yload__dot"
            style={{ left: d.left, bottom: d.bottom, animationDelay: `${d.delay}s` }}
          />
        ))}
        {/* ground shadow tracking the flight */}
        <span className="yload__shadow" />
        {/* the thrown mark: arc = x + fade, lift = parabola, form = squash/stretch + tail, ball = spin + gloss */}
        <span className="yload__arc">
          <span className="yload__lift">
            <span className="yload__form">
              <span className="yload__ball" />
            </span>
          </span>
        </span>
        {/* landing: ripple ring + dust kicked both ways */}
        <span className="yload__ripple" />
        <span className="yload__puff yload__puff--l" />
        <span className="yload__puff yload__puff--r" />
      </div>

      <div className="yload__lines" aria-hidden>
        {lines.map((l, i) => (
          <span
            key={l}
            className={lines.length === 1 ? 'yload__line yload__line--solo' : 'yload__line'}
            style={lines.length === 1 ? undefined : { animationDelay: `${i * 2.4}s` }}
          >
            {l}
          </span>
        ))}
      </div>
      <span className="sr-only">{lines[0] ?? 'Loading chat…'}</span>

      <style>{`
        .yload {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          background: var(--bg, #0a0c10);
        }
        /* inline: lives INSIDE the chat message area (splash loading, wallet
           reconnect) — no full-viewport height, no background of its own. */
        .yload--inline {
          min-height: min(52vh, 420px);
          background: transparent;
        }
        /* compact: a small in-flow slot (the /i splash CTA area). */
        .yload--compact {
          min-height: 150px;
          gap: 8px;
        }
        .yload--compact .yload__stage {
          transform: scale(0.72);
          margin: -18px 0;
        }
        .yload__line--solo {
          animation: none;
          opacity: 1;
        }

        .yload__stage {
          position: relative;
          width: 320px;
          height: 132px;
          overflow: hidden;
        }
        /* ambient glow pooling under the scene */
        .yload__stage::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(
            62% 70% at 50% 80%,
            color-mix(in srgb, var(--accent, #34e0a1) 9%, transparent),
            transparent 72%
          );
          animation: yload-glow 2.4s ease-in-out infinite;
        }
        /* the ground the whole scene stands on */
        .yload__stage::after {
          content: '';
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 12px;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent,
            color-mix(in srgb, var(--accent, #34e0a1) 30%, transparent) 16%,
            color-mix(in srgb, var(--accent, #34e0a1) 30%, transparent) 84%,
            transparent
          );
        }

        .yload__pad {
          position: absolute;
          left: 24px;
          bottom: 10px;
          width: 16px;
          height: 5px;
          border-radius: 3px;
          background: color-mix(in srgb, var(--accent, #34e0a1) 30%, transparent);
        }
        .yload__arm {
          position: absolute;
          left: 33px;
          bottom: 12px;
          width: 3px;
          height: 20px;
          border-radius: 2px;
          background: linear-gradient(
            to top,
            color-mix(in srgb, var(--accent, #34e0a1) 60%, transparent),
            color-mix(in srgb, var(--accent, #34e0a1) 25%, transparent)
          );
          transform-origin: 50% 100%;
          transform: rotate(16deg);
          animation: yload-arm 2.4s infinite;
        }
        .yload__flash {
          position: absolute;
          left: 26px;
          bottom: 12px;
          width: 20px;
          height: 20px;
          border-radius: 9999px;
          border: 1.5px solid color-mix(in srgb, var(--accent, #34e0a1) 60%, transparent);
          opacity: 0;
          animation: yload-flash 2.4s ease-out infinite;
        }

        .yload__dot {
          position: absolute;
          width: 5px;
          height: 5px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--accent, #34e0a1) 70%, transparent);
          opacity: 0.5;
          animation: yload-dot 2.4s linear infinite;
        }

        .yload__shadow {
          position: absolute;
          left: 27px;
          bottom: 8px;
          width: 18px;
          height: 5px;
          border-radius: 9999px;
          background: radial-gradient(
            closest-side,
            color-mix(in srgb, var(--accent, #34e0a1) 45%, transparent),
            transparent
          );
          opacity: 0.26;
          animation: yload-shadow 2.4s infinite;
          will-change: transform, opacity;
        }

        .yload__arc {
          position: absolute;
          left: 27px;
          bottom: 14px;
          animation: yload-x 2.4s infinite, yload-fade 2.4s linear infinite;
          will-change: transform, opacity;
        }
        .yload__lift {
          display: block;
          animation: yload-y 2.4s infinite;
          will-change: transform;
        }
        .yload__form {
          position: relative;
          display: block;
          animation: yload-form 2.4s ease-in-out infinite;
          will-change: transform;
        }
        /* comet tail chasing the mark, angled against the velocity vector */
        .yload__form::before {
          content: '';
          position: absolute;
          top: 50%;
          right: 62%;
          width: 30px;
          height: 4px;
          margin-top: -2px;
          border-radius: 3px;
          background: linear-gradient(
            to left,
            color-mix(in srgb, var(--accent, #34e0a1) 65%, transparent),
            transparent
          );
          transform-origin: right center;
          opacity: 0;
          animation: yload-tail 2.4s linear infinite;
        }
        .yload__ball {
          position: relative;
          display: block;
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: var(--accent, #34e0a1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--accent, #34e0a1) 50%, transparent);
          animation: yload-spin 2.4s linear infinite;
          will-change: rotate;
        }
        /* gloss so it reads as a thing, not a disc */
        .yload__ball::before {
          content: '';
          position: absolute;
          top: 2px;
          left: 3px;
          width: 8px;
          height: 6px;
          border-radius: 9999px;
          background: radial-gradient(closest-side, rgba(255, 255, 255, 0.55), transparent);
        }
        /* a notch so the spin is visible; bg-mix flips with the theme */
        .yload__ball::after {
          content: '';
          position: absolute;
          top: 3.5px;
          left: 8px;
          width: 3px;
          height: 5.5px;
          border-radius: 2px;
          background: color-mix(in srgb, var(--bg, #0a0c10) 85%, transparent);
        }

        .yload__ripple {
          position: absolute;
          left: 252px;
          bottom: 13px;
          width: 24px;
          height: 24px;
          border-radius: 9999px;
          border: 1.5px solid color-mix(in srgb, var(--accent, #34e0a1) 55%, transparent);
          opacity: 0;
          transform-origin: 50% 100%;
          animation: yload-ripple 2.4s ease-out infinite;
        }
        .yload__puff {
          position: absolute;
          bottom: 13px;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--accent, #34e0a1) 40%, transparent);
          opacity: 0;
        }
        .yload__puff--l { left: 256px; animation: yload-puff-l 2.4s ease-out infinite; }
        .yload__puff--r { left: 268px; animation: yload-puff-r 2.4s ease-out infinite; }

        .yload__lines {
          position: relative;
          height: 16px;
          width: 320px;
          text-align: center;
        }
        .yload__line {
          position: absolute;
          inset: 0;
          opacity: 0;
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 12px;
          letter-spacing: 0.08em;
          color: var(--muted-2, #8b93a7);
          animation: yload-line 9.6s linear infinite;
        }

        /* x: drag back with the windup, fly right at constant speed, then two
           short forward hops with the bounces, hold, reset while invisible */
        @keyframes yload-x {
          0% { transform: translateX(0); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
          8% { transform: translateX(-7px); animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.35); }
          12% { transform: translateX(0); animation-timing-function: linear; }
          56% { transform: translateX(228px); animation-timing-function: cubic-bezier(0.3, 0.6, 0.6, 1); }
          65% { transform: translateX(236px); animation-timing-function: cubic-bezier(0.3, 0.6, 0.7, 1); }
          71%, 100% { transform: translateX(240px); }
        }
        /* y: quadratic up/down (ease-out then ease-in ≈ constant gravity),
           then a 16px bounce and a 5px settle hop */
        @keyframes yload-y {
          0%, 12% { transform: translateY(0); animation-timing-function: cubic-bezier(0.5, 1, 0.89, 1); }
          34% { transform: translateY(-74px); animation-timing-function: cubic-bezier(0.11, 0, 0.5, 0); }
          56% { transform: translateY(0); animation-timing-function: cubic-bezier(0.5, 1, 0.89, 1); }
          60.5% { transform: translateY(-16px); animation-timing-function: cubic-bezier(0.11, 0, 0.5, 0); }
          65% { transform: translateY(0); animation-timing-function: cubic-bezier(0.5, 1, 0.89, 1); }
          68% { transform: translateY(-5px); animation-timing-function: cubic-bezier(0.11, 0, 0.5, 0); }
          71%, 100% { transform: translateY(0); }
        }
        /* materialize into the hand during windup, fade out before the reset */
        @keyframes yload-fade {
          0%, 4% { opacity: 0; }
          9% { opacity: 1; }
          87% { opacity: 1; }
          93%, 100% { opacity: 0; }
        }
        /* squash & stretch: loaded by the whip, stretched in flight, squashed
           flat on impact, settling through the hops */
        @keyframes yload-form {
          0%, 9% { transform: scale(1); }
          11% { transform: scale(1.1, 0.78); }
          14% { transform: scale(0.8, 1.26); }
          32%, 38% { transform: scale(1); }
          52% { transform: scale(0.86, 1.18); }
          56% { transform: scale(1.38, 0.58); }
          59% { transform: scale(0.92, 1.12); }
          62% { transform: scale(1.04, 0.96); }
          65% { transform: scale(1.16, 0.84); }
          67.5% { transform: scale(1); }
          71% { transform: scale(1.06, 0.94); }
          74%, 100% { transform: scale(1); }
        }
        @keyframes yload-spin {
          0%, 12% { rotate: 0deg; }
          56% { rotate: 540deg; }
          71%, 100% { rotate: 600deg; }
        }
        /* tail: only during flight, angle tracking the velocity */
        @keyframes yload-tail {
          0%, 11% { opacity: 0; transform: rotate(34deg); }
          15% { opacity: 0.85; transform: rotate(30deg); }
          34% { opacity: 0.6; transform: rotate(0deg); }
          50% { opacity: 0.75; transform: rotate(-30deg); }
          56%, 100% { opacity: 0; transform: rotate(-34deg); }
        }
        @keyframes yload-arm {
          0% { transform: rotate(16deg); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
          8% { transform: rotate(-54deg); animation-timing-function: cubic-bezier(0.6, -0.28, 0.35, 1.4); }
          12% { transform: rotate(34deg); }
          17% { transform: rotate(8deg); }
          24%, 100% { transform: rotate(16deg); }
        }
        @keyframes yload-flash {
          0%, 11% { opacity: 0; transform: scale(0.3); }
          13.5% { opacity: 0.9; transform: scale(1); }
          22%, 100% { opacity: 0; transform: scale(1.9); }
        }
        /* dots: flash out at passage, dark through the landing, then re-arm
           left-to-right as the next throw is loaded (phase 0 = passage) */
        @keyframes yload-dot {
          0% { opacity: 0.95; transform: scale(1.7); }
          7% { opacity: 0; transform: scale(0.4); }
          58% { opacity: 0; transform: scale(0.4); }
          74% { opacity: 0.45; transform: scale(1); }
          100% { opacity: 0.5; transform: scale(1); }
        }
        /* shadow: rides the same linear x, thinning at the top of the arc */
        @keyframes yload-shadow {
          0%, 12% { transform: translateX(0) scaleX(1); opacity: 0.26; }
          34% { transform: translateX(114px) scaleX(0.5); opacity: 0.1; }
          56% { transform: translateX(228px) scaleX(1.1); opacity: 0.32; }
          60.5% { transform: translateX(232px) scaleX(0.78); opacity: 0.16; }
          65% { transform: translateX(236px) scaleX(1); opacity: 0.28; }
          68% { transform: translateX(238px) scaleX(0.88); opacity: 0.2; }
          71%, 87% { transform: translateX(240px) scaleX(1); opacity: 0.28; }
          93%, 100% { transform: translateX(240px) scaleX(1); opacity: 0; }
        }
        @keyframes yload-ripple {
          0%, 55% { opacity: 0; transform: scale(0.35); }
          57% { opacity: 0.85; transform: scale(0.6); }
          72%, 100% { opacity: 0; transform: scale(2.1); }
        }
        @keyframes yload-puff-l {
          0%, 55% { opacity: 0; transform: translate(0, 0) scale(0.5); }
          58% { opacity: 0.8; }
          74%, 100% { opacity: 0; transform: translate(-14px, -10px) scale(1.15); }
        }
        @keyframes yload-puff-r {
          0%, 55% { opacity: 0; transform: translate(0, 0) scale(0.5); }
          58% { opacity: 0.8; }
          74%, 100% { opacity: 0; transform: translate(12px, -8px) scale(1.15); }
        }
        @keyframes yload-glow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          40% { opacity: 0.85; transform: scale(1.07); }
        }
        /* caption carousel: 4 lines × 2.4s each */
        @keyframes yload-line {
          0% { opacity: 0; transform: translateY(4px); }
          2% { opacity: 1; transform: translateY(0); }
          22% { opacity: 1; }
          25% { opacity: 0; transform: translateY(-4px); }
          100% { opacity: 0; }
        }

        /* Light theme: the dark-tuned transparency mixes wash out on a white
           page, so every scene element re-inks stronger. (/embed carries no
           data-theme and keeps the dark-tuned base — it is theme-exempt.) */
        html[data-theme='light'] .yload__stage::before {
          background: radial-gradient(
            62% 70% at 50% 80%,
            color-mix(in srgb, var(--accent, #0e8f62) 14%, transparent),
            transparent 72%
          );
        }
        html[data-theme='light'] .yload__stage::after {
          background: linear-gradient(
            90deg,
            transparent,
            color-mix(in srgb, var(--accent, #0e8f62) 50%, transparent) 16%,
            color-mix(in srgb, var(--accent, #0e8f62) 50%, transparent) 84%,
            transparent
          );
        }
        html[data-theme='light'] .yload__pad {
          background: color-mix(in srgb, var(--accent, #0e8f62) 55%, transparent);
        }
        html[data-theme='light'] .yload__arm {
          background: linear-gradient(
            to top,
            color-mix(in srgb, var(--accent, #0e8f62) 90%, transparent),
            color-mix(in srgb, var(--accent, #0e8f62) 45%, transparent)
          );
        }
        html[data-theme='light'] .yload__flash {
          border-color: color-mix(in srgb, var(--accent, #0e8f62) 80%, transparent);
        }
        html[data-theme='light'] .yload__dot {
          background: var(--accent, #0e8f62);
        }
        html[data-theme='light'] .yload__shadow {
          background: radial-gradient(
            closest-side,
            color-mix(in srgb, var(--accent, #0e8f62) 60%, transparent),
            transparent
          );
        }
        html[data-theme='light'] .yload__form::before {
          background: linear-gradient(
            to left,
            color-mix(in srgb, var(--accent, #0e8f62) 85%, transparent),
            transparent
          );
        }
        html[data-theme='light'] .yload__ripple {
          border-color: color-mix(in srgb, var(--accent, #0e8f62) 75%, transparent);
        }
        html[data-theme='light'] .yload__puff {
          background: color-mix(in srgb, var(--accent, #0e8f62) 60%, transparent);
        }
        html[data-theme='light'] .yload__ball {
          box-shadow: 0 0 16px color-mix(in srgb, var(--accent, #0e8f62) 30%, transparent);
        }

        @media (prefers-reduced-motion: reduce) {
          .yload__stage::before,
          .yload__arm, .yload__flash, .yload__dot, .yload__shadow,
          .yload__arc, .yload__lift, .yload__form, .yload__form::before,
          .yload__ball, .yload__ripple, .yload__puff {
            animation: none;
          }
          /* static composition: the mark mid-arc over its dotted path */
          .yload__arc { transform: translateX(114px); opacity: 1; }
          .yload__lift { transform: translateY(-74px); }
          .yload__dot { opacity: 0.5; transform: scale(1); }
          .yload__shadow { transform: translateX(114px) scaleX(0.5); opacity: 0.12; }
          .yload__line { animation: none; opacity: 0; }
          .yload__line:first-child { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
