// The trust layer — why hosts embed the chat and why users sign what it
// builds. Each tile opens with a blog-style constellation thumb (grey field
// dots + a dashed emerald route) animated to tell that tile's story:
// guardrails BLOCK an over-cap hop, receipts SETTLE 402→200, the kill
// switch FREEZES a live route, reputation LIFTS the proven node. Pure SVG +
// CSS keyframes; the global reduced-motion guard stills them.

import Link from 'next/link'

const TILES: { kind: 'guard' | 'receipt' | 'kill' | 'rep'; t: string; d: string; href: string; cta: string }[] = [
  {
    kind: 'guard',
    t: 'Guardrails, per step',
    d: 'Spend policy and budgets re-checked before every call and every transaction step. Denials get ledgered too.',
    href: '/dashboard',
    cta: 'Your policy',
  },
  {
    kind: 'receipt',
    t: 'Receipts, in the open',
    d: 'Every settled call carries a tx hash and lands in a public activity feed. No dashboards to trust.',
    href: '/activity',
    cta: 'Live activity',
  },
  {
    kind: 'kill',
    t: 'Kill switch + org caps',
    d: 'Pause an agent or freeze an account server-side, instantly and reversibly. Orgs get a daily cap above per-key budgets.',
    href: '/docs/teams',
    cta: 'How teams work',
  },
  {
    kind: 'rep',
    t: 'Reputation, earned',
    d: 'MCPs score on reliability, liveness, speed, and settled history — so your set is built on proven routes.',
    href: '/leaderboard',
    cta: 'Leaderboard',
  },
]

/** Shared constellation backdrop — quiet grey field dots + faint joins. */
function Field() {
  return (
    <g className="tt-field">
      <circle cx="24" cy="58" r="2" />
      <circle cx="62" cy="24" r="2" />
      <circle cx="104" cy="50" r="2" />
      <circle cx="148" cy="18" r="2" />
      <circle cx="182" cy="56" r="2" />
      <path d="M24 58 L62 24 L104 50 L148 18 L182 56" />
    </g>
  )
}

function Thumb({ kind }: { kind: string }) {
  return (
    <div className="trust__thumb" aria-hidden="true">
      <svg viewBox="0 0 220 88" preserveAspectRatio="xMidYMid slice">
        <Field />
        {kind === 'guard' && (
          <g>
            {/* the route runs at the gate — and gets dropped, not built */}
            <path className="tt-route" d="M10 62 L70 54 L118 40" />
            <line className="tt-gate" x1="128" y1="20" x2="128" y2="66" />
            <path className="tt-deflect" d="M118 40 L126 56 L120 72" />
            <circle className="tt-red" cx="118" cy="40" r="3" />
            <text className="tt-label tt-label--red" x="112" y="16">over-cap ⊘ dropped</text>
          </g>
        )}
        {kind === 'receipt' && (
          <g>
            <path className="tt-route" d="M10 66 L58 58 L102 62 L156 26" />
            <circle className="tt-glow" cx="156" cy="26" r="11" />
            <circle className="tt-node" cx="156" cy="26" r="4.5" />
            <text className="tt-label" x="128" y="50">402 → 200</text>
          </g>
        )}
        {kind === 'kill' && (
          <g>
            {/* a live route, frozen mid-flight — reversibly */}
            <path className="tt-route" d="M10 58 L64 50 L104 42" />
            <circle className="tt-pausering" cx="118" cy="40" r="10" />
            <line className="tt-pausebar" x1="115" y1="36" x2="115" y2="44" />
            <line className="tt-pausebar" x1="121" y1="36" x2="121" y2="44" />
            <path className="tt-after" d="M134 38 L168 30 L196 34" />
            <text className="tt-label tt-label--amber" x="106" y="66">paused · reversible</text>
          </g>
        )}
        {kind === 'rep' && (
          <g>
            {/* the proven route rises above the field */}
            <path className="tt-route" d="M10 68 L54 62 L96 52 L142 22" />
            <circle className="tt-glow" cx="142" cy="22" r="11" />
            <circle className="tt-node" cx="142" cy="22" r="4.5" />
            <circle className="tt-riser" cx="96" cy="52" r="2.4" />
            <circle className="tt-riser" cx="54" cy="62" r="2.4" />
            <text className="tt-label" x="152" y="40">proven ↑</text>
          </g>
        )}
      </svg>
    </div>
  )
}

export default function TrustStrip() {
  return (
    <section className="trust">
      <div className="trust__head">
        <span className="trust__eyebrow mono">THE TRUST LAYER</span>
        <h2 className="trust__h2">Why hosts embed it. Why users <span className="x-grad">sign.</span></h2>
      </div>
      <div className="trust__grid">
        {TILES.map((x) => (
          <div className="trust__tile" key={x.t}>
            <Thumb kind={x.kind} />
            <h3 className="trust__t">{x.t}</h3>
            <p className="trust__d">{x.d}</p>
            <Link href={x.href} className="trust__link mono">
              {x.cta} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
