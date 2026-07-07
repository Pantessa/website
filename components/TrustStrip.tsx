// The trust layer — why hosts embed the chat and why users sign what it
// builds. Four tiles, all pointing at live surfaces (nothing aspirational).

import Link from 'next/link'

const TILES: { t: string; d: string; href: string; cta: string }[] = [
  {
    t: 'Guardrails, per step',
    d: 'Spend policy and budgets re-checked before every call and every transaction step. Denials get ledgered too.',
    href: '/dashboard',
    cta: 'Your policy',
  },
  {
    t: 'Receipts, in the open',
    d: 'Every settled call carries a tx hash and lands in a public activity feed. No dashboards to trust.',
    href: '/activity',
    cta: 'Live activity',
  },
  {
    t: 'Kill switch + org caps',
    d: 'Pause an agent or freeze an account server-side, instantly and reversibly. Orgs get a daily cap above per-key budgets.',
    href: '/docs/teams',
    cta: 'How teams work',
  },
  {
    t: 'Reputation, earned',
    d: 'MCPs score on reliability, liveness, speed, and settled history — so your set is built on proven routes.',
    href: '/leaderboard',
    cta: 'Leaderboard',
  },
]

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
