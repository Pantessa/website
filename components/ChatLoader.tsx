// Route-level loader for the chat surfaces (app/chat*/loading.tsx). The chat
// bundle is heavy (wagmi + RainbowKit + the whole workspace), so navigation
// sits on a blank screen long enough to feel broken — this fills the gap with
// the brand doing the one thing it's named for: a small mark gets YEETED
// across the screen in a clean parabolic arc, on repeat, over a cycling mono
// caption. Pure CSS (no client JS — it paints before hydration, which is the
// whole point); honors prefers-reduced-motion with a static mark.

const LINES = [
  'yeeting your agents into place',
  'wiring up the working set',
  'warming the routing engine',
  'receipts, guardrails, signatures — loading',
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
        {/* launch nub — the "thrower" */}
        <span className="yload__hand" />
        {/* the thrown mark: outer = x + spin timing, inner = the parabola */}
        <span className="yload__arc">
          <span className="yload__ball" />
        </span>
        {/* motion lines chasing the throw */}
        <span className="yload__trail yload__trail--1" />
        <span className="yload__trail yload__trail--2" />
        <span className="yload__trail yload__trail--3" />
        {/* landing dust */}
        <span className="yload__puff" />
      </div>

      <div className="yload__lines" aria-hidden>
        {lines.map((l, i) => (
          <span
            key={l}
            className={lines.length === 1 ? 'yload__line yload__line--solo' : 'yload__line'}
            style={lines.length === 1 ? undefined : { animationDelay: `${i * 2.2}s` }}
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
          gap: 22px;
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
          gap: 14px;
        }
        .yload__line--solo {
          animation: none;
          opacity: 1;
        }
        .yload__stage {
          position: relative;
          width: 300px;
          height: 116px;
          overflow: hidden;
        }
        .yload__hand {
          position: absolute;
          left: 18px;
          bottom: 10px;
          width: 14px;
          height: 14px;
          border-radius: 4px 4px 10px 4px;
          background: color-mix(in srgb, var(--accent, #34e0a1) 24%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent, #34e0a1) 45%, transparent);
          animation: yload-wind 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          transform-origin: bottom left;
        }
        .yload__arc {
          position: absolute;
          left: 22px;
          bottom: 16px;
          animation: yload-x 2.2s cubic-bezier(0.25, 0.1, 0.35, 1) infinite;
          will-change: transform;
        }
        .yload__ball {
          display: block;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: var(--accent, #34e0a1);
          box-shadow: 0 0 18px color-mix(in srgb, var(--accent, #34e0a1) 55%, transparent);
          animation: yload-y 2.2s cubic-bezier(0.33, 0, 0.67, 1) infinite,
            yload-spin 2.2s linear infinite;
          will-change: transform;
        }
        /* a notch so the spin is visible */
        .yload__ball::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 7px;
          width: 3px;
          height: 5px;
          border-radius: 2px;
          background: #04231a;
        }
        .yload__trail {
          position: absolute;
          left: 30px;
          bottom: 48px;
          width: 20px;
          height: 2.5px;
          border-radius: 2px;
          background: color-mix(in srgb, var(--accent, #34e0a1) 40%, transparent);
          opacity: 0;
          animation: yload-trail 2.2s ease-out infinite;
        }
        .yload__trail--2 { bottom: 62px; animation-delay: 0.06s; width: 22px; }
        .yload__trail--3 { bottom: 76px; animation-delay: 0.12s; width: 12px; }
        .yload__puff {
          position: absolute;
          right: 14px;
          bottom: 10px;
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          border: 1.5px solid color-mix(in srgb, var(--accent, #34e0a1) 50%, transparent);
          opacity: 0;
          animation: yload-puff 2.2s ease-out infinite;
        }
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
          animation: yload-line 8.8s linear infinite;
        }

        /* throw: wind up, fly right (linear-ish), pause off-screen, reset */
        @keyframes yload-x {
          0%, 12% { transform: translateX(0); }
          58%, 100% { transform: translateX(262px); }
        }
        /* parabola: up fast, hang, come down at the far edge */
        @keyframes yload-y {
          0%, 12% { transform: translateY(0) ; }
          34% { transform: translateY(-64px); }
          58%, 100% { transform: translateY(-2px); }
        }
        @keyframes yload-spin {
          0%, 12% { rotate: 0deg; }
          58%, 100% { rotate: 540deg; }
        }
        @keyframes yload-wind {
          0% { transform: rotate(0deg); }
          8% { transform: rotate(-24deg); }
          14% { transform: rotate(14deg); }
          22%, 100% { transform: rotate(0deg); }
        }
        @keyframes yload-trail {
          0%, 14% { opacity: 0; transform: translateX(0); }
          22% { opacity: 0.8; }
          52% { opacity: 0; transform: translateX(190px); }
          100% { opacity: 0; }
        }
        @keyframes yload-puff {
          0%, 54% { opacity: 0; transform: scale(0.4); }
          62% { opacity: 0.9; transform: scale(1); }
          80%, 100% { opacity: 0; transform: scale(1.7); }
        }
        /* caption carousel: 4 lines × 2.2s each */
        @keyframes yload-line {
          0% { opacity: 0; transform: translateY(4px); }
          2% { opacity: 1; transform: translateY(0); }
          23% { opacity: 1; }
          26% { opacity: 0; transform: translateY(-4px); }
          100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .yload__arc, .yload__ball, .yload__hand, .yload__trail, .yload__puff { animation: none; }
          .yload__arc { transform: translateX(104px); }
          .yload__ball { transform: translateY(-40px); }
          .yload__line { animation: none; opacity: 0; }
          .yload__line:first-child { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
