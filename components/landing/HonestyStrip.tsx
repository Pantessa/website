import prisma from '@/lib/db'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import { venueOfBuildPath } from '@/lib/build-path'
import { HONESTY } from '@/lib/markets-copy'

// THE HONESTY STRIP — receipt-grade numbers, the same fence every public
// money read uses: REAL_TRAFFIC_WHERE (never our harness, never an
// unverified receipt). Money moved by real wallets, signed count, the
// distinct venues that signed money went through, the chains it touched.
// Server component, fail-soft: a cold DB renders the sentence without the
// figures rather than erroring the homepage. NEVER the raw embed_turns sums
// (memory standing-attended-scoreboard).

async function realNumbers() {
  try {
    const where = { outcome: 'signed', valueUsd: { gt: 0 }, ...REAL_TRAFFIC_WHERE }
    const [agg, paths, chains] = await Promise.all([
      prisma.embedTurn.aggregate({ where, _sum: { valueUsd: true }, _count: { _all: true } }),
      prisma.embedTurn.groupBy({ by: ['buildPath'], where }),
      prisma.embedTurn.groupBy({ by: ['chain'], where }),
    ])
    const venues = new Set<string>()
    for (const p of paths) {
      const v = venueOfBuildPath(p.buildPath)
      if (v) venues.add(v)
    }
    const chainSet = new Set(chains.map((c) => c.chain).filter((c): c is string => !!c))
    const moved = agg._sum.valueUsd ?? 0
    const asOf = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    return {
      asOf,
      moved: moved >= 1000 ? `$${Math.round(moved).toLocaleString('en-US')}` : `$${moved.toFixed(2)}`,
      signed: String(agg._count._all),
      venues: String(venues.size),
      chains: String(chainSet.size),
    }
  } catch {
    return null
  }
}

export default async function HonestyStrip() {
  const n = await realNumbers()
  return (
    <section className="lhon" data-honesty-strip aria-label="Receipt-grade numbers">
      <div className="lhon__in">
        <div>
          <span className="lhon__eyebrow mono">{HONESTY.eyebrow}</span>
          <p className="lhon__lead">{HONESTY.lead}</p>
          <p className="lhon__note">
            {HONESTY.note}
            {n && <span className="lhon__asof mono"> · as of {n.asOf} · refreshed every 5 min</span>}
          </p>
        </div>
        {n ? (
          (
            [
              { k: HONESTY.labels.moved, v: n.moved },
              { k: HONESTY.labels.signed, v: n.signed },
              { k: HONESTY.labels.venues, v: n.venues },
              { k: HONESTY.labels.chains, v: n.chains },
            ] as const
          ).map((s) => (
            <div key={s.k} className="lhon__stat">
              <span className="lhon__v mono">{s.v}</span>
              <span className="lhon__k mono">{s.k}</span>
            </div>
          ))
        ) : (
          <div className="lhon__stat" style={{ gridColumn: 'span 4' }}>
            <span className="lhon__k mono">figures load from the ledger · unavailable right now</span>
          </div>
        )}
      </div>
    </section>
  )
}
