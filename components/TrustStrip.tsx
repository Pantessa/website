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
      <circle cx="24" cy="44" r="2" />
      <circle cx="62" cy="18" r="2" />
      <circle cx="104" cy="38" r="2" />
      <circle cx="148" cy="14" r="2" />
      <circle cx="182" cy="42" r="2" />
      <path d="M24 44 L62 18 L104 38 L148 14 L182 42" />
    </g>
  )
}

function Thumb({ kind }: { kind: string }) {
  return (
    <div className="trust__thumb" aria-hidden="true">
      <svg viewBox="0 0 220 64" preserveAspectRatio="xMidYMid slice">
        <Field />
        {kind === 'guard' && (
          <g>
            {/* the route runs at the gate — and gets dropped, not built */}
            <path className="tt-route" d="M10 46 L70 40 L118 30" />
            <line className="tt-gate" x1="128" y1="14" x2="128" y2="50" />
            <path className="tt-deflect" d="M118 30 L126 44 L120 56" />
            <circle className="tt-red" cx="118" cy="30" r="3" />
            <text className="tt-label tt-label--red" x="136" y="24">over-cap ⊘ dropped</text>
          </g>
        )}
        {kind === 'receipt' && (
          <g>
            <path className="tt-route" d="M10 50 L58 44 L102 46 L156 18" />
            <circle className="tt-glow" cx="156" cy="18" r="10" />
            <circle className="tt-node" cx="156" cy="18" r="4.5" />
            <text className="tt-label" x="132" y="40">402 → 200</text>
          </g>
        )}
        {kind === 'kill' && (
          <g>
            {/* a live route, frozen mid-flight — reversibly */}
            <path className="tt-route" d="M10 44 L64 38 L104 32" />
            <circle className="tt-pausering" cx="118" cy="30" r="9" />
            <line className="tt-pausebar" x1="115" y1="26" x2="115" y2="34" />
            <line className="tt-pausebar" x1="121" y1="26" x2="121" y2="34" />
            <path className="tt-after" d="M132 28 L168 22 L196 26" />
            <text className="tt-label tt-label--amber" x="132" y="48">paused · reversible</text>
          </g>
        )}
        {kind === 'rep' && (
          <g>
            {/* the proven route rises above the field */}
            <path className="tt-route" d="M10 52 L54 48 L96 40 L142 16" />
            <circle className="tt-glow" cx="142" cy="16" r="10" />
            <circle className="tt-node" cx="142" cy="16" r="4.5" />
            <circle className="tt-riser" cx="96" cy="40" r="2.4" />
            <circle className="tt-riser" cx="54" cy="48" r="2.4" />
            <text className="tt-label" x="152" y="30">proven ↑</text>
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
