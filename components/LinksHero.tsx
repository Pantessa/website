import prisma from '@/lib/db'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd, formatEarnedUsd, netFeeBpsFor } from '@/lib/fees'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import LinksHeroView from '@/components/LinksHeroView'

// The links-first hero, server half. One claim — "You have an intent. We do
// the rest." — two doors (try a live house link / mint your own), the link
// economy's real numbers, and the fusion art: dapp energies streaming into
// one core, minting links (LinksHeroView owns the canvas + copy). Stats are
// server-truth (guardrail-priced embed_turns for money; intent_link
// rows/events for counts), fail-soft: a cold DB renders the claim without
// the strip rather than erroring the homepage.

async function linkStats() {
  try {
    const [links, opens, turns] = await Promise.all([
      // Honest reader (2026-08-18): a public claim never counts our own
      // harness/drill mints (intent_links.is_internal) or the opens posted
      // against them — the raw counts were 141 links / 1,638 opens of which
      // ~95% were us. Same rule as the money figures below.
      prisma.intentLink.count({ where: { revoked: false, isInternal: false } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM intent_link_events e
        WHERE e.kind = 'open'
          AND NOT EXISTS (SELECT 1 FROM intent_links il WHERE il.id = e.slug AND il.is_internal)`.then((r) => Number(r[0]?.n ?? 0)),
      // REAL_TRAFFIC_WHERE: the homepage is a public claim, so harness and
      // localhost turns must never count toward it (the same rule every other
      // public money read follows).
      prisma.embedTurn.groupBy({
        by: ['buildPath'],
        where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 }, ...REAL_TRAFFIC_WHERE },
        _sum: { valueUsd: true },
      }),
    ])
    let movedUsd = 0
    let creatorUsd = 0
    for (const t of turns) {
      const v = t._sum.valueUsd ?? 0
      movedUsd += v
      // Per-path net rate — a cross-chain dollar earns half a Uniswap dollar.
      if (t.buildPath && FEE_BEARING_BUILD_PATHS.has(t.buildPath)) {
        creatorUsd += creatorEarningsUsd(v, netFeeBpsFor(t.buildPath))
      }
    }
    const usd = (n: number) =>
      n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`
    return {
      links: String(links),
      opens: String(opens),
      movedUsd: usd(movedUsd),
      creatorUsd: formatEarnedUsd(creatorUsd),
    }
  } catch {
    return null
  }
}

export default async function LinksHero() {
  const stats = await linkStats()
  return <LinksHeroView stats={stats} />
}
