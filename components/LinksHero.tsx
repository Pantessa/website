import Link from 'next/link'
import { ArrowRight, Zap } from 'lucide-react'
import prisma from '@/lib/db'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd } from '@/lib/fees'

// The links-first hero. One claim — "You have an intent. We do the rest." —
// two doors (try a live house link / mint your own), and the link economy's
// real numbers right under it: links minted, opens, $ moved through links,
// creator earnings accrued. Server-truth (guardrail-priced embed_turns for
// money; intent_link rows/events for counts), fail-soft: a cold DB renders
// the claim without the strip rather than erroring the homepage.

async function linkStats() {
  try {
    const [links, opens, turns] = await Promise.all([
      prisma.intentLink.count({ where: { revoked: false } }),
      prisma.intentLinkEvent.count({ where: { kind: 'open' } }),
      prisma.embedTurn.groupBy({
        by: ['buildPath'],
        where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 } },
        _sum: { valueUsd: true },
      }),
    ])
    let movedUsd = 0
    let feeBearingUsd = 0
    for (const t of turns) {
      const v = t._sum.valueUsd ?? 0
      movedUsd += v
      if (t.buildPath && FEE_BEARING_BUILD_PATHS.has(t.buildPath)) feeBearingUsd += v
    }
    return {
      links: String(links),
      opens: String(opens),
      movedUsd: `$${movedUsd.toFixed(2)}`,
      creatorUsd: `$${creatorEarningsUsd(feeBearingUsd).toFixed(2)}`,
    }
  } catch {
    return null
  }
}

export default async function LinksHero() {
  const stats = await linkStats()
  return (
    <section className="max-w-5xl mx-auto px-4 pt-20 pb-16">
      <div className="max-w-3xl">
        <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
          Intent links · non-custodial · your wallet signs
        </span>
        <h1 className="mt-4 text-[clamp(2.4rem,6vw,4rem)] leading-[1.05] font-semibold text-[color:var(--fg)]">
          You have an intent.
          <br />
          We do the rest.
        </h1>
        <p className="mt-5 text-[17px] leading-relaxed text-[color:var(--muted)] max-w-2xl">
          Mint a link that carries an ask — &ldquo;Buy $10 of AAPL&rdquo;, &ldquo;Stake ETH with
          Lido&rdquo;, &ldquo;DCA $25 weekly&rdquo;. Whoever opens it connects their own wallet and
          Yeetful scans, funds across chains, builds, and guard-checks the whole path. They sign.
          Done. The transaction onboarding flow, nailed — for your dapp, or for the audience you
          teach.
        </p>
        <div className="mt-8 flex items-center gap-3 flex-wrap">
          <Link
            href="/i/buy-aapl"
            className="btn btn--solid inline-flex items-center gap-2 text-[14px]"
          >
            <Zap className="w-4 h-4" /> Try a live link
          </Link>
          <Link href="/dashboard/links" className="btn btn--ghost text-[14px]">
            Mint yours
          </Link>
          <Link
            href="/links"
            className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
          >
            The leaderboard <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* The link economy, live — server-truth numbers, same sources as
          /activity ($ = guardrail-priced signed notional attributed to links;
          creator earnings = half the 20bps on fee-bearing conversions). */}
      {stats && (
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
          {(
            [
              { label: 'Links live', value: stats.links },
              { label: 'Opens', value: stats.opens },
              { label: 'Moved through links', value: stats.movedUsd },
              { label: 'Creator earnings', value: stats.creatorUsd },
            ] as const
          ).map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3">
              <div className="mono text-[20px] text-[color:var(--fg)]">{s.value}</div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] mt-1">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
