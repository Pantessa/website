import prisma from '@/lib/db'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd, formatEarnedUsd, netFeeBpsForTurn } from '@/lib/fees'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import LandingHero from '@/components/landing/LandingHero'

// The hero, server half (mk2 LANDING, 2026-09-15): the front door is now the
// executing chart (components/landing/LandingHero). This file keeps the
// links economy's honest reader — `linkStats` — for the share band below the
// fold (LinkEconomy's numbers), so the public claim's fence (is_internal on
// rows, REAL_TRAFFIC_WHERE on money, the stamped fee tier) lives in ONE
// place the harness pins. Fail-soft: a cold DB renders the page without the
// strip rather than erroring the homepage.

export interface LinkHeroStats {
  links: string
  opens: string
  movedUsd: string
  creatorUsd: string
}

export async function linkStats(): Promise<LinkHeroStats | null> {
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
      // Grouped by the STAMPED tier too — link-origin swaps carry 50 bps,
      // and pricing them at the path default showed creators 2.5× less on
      // the homepage than in their own studio (2026-09-08 squad find).
      prisma.embedTurn.groupBy({
        by: ['buildPath', 'feeBps'],
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
        creatorUsd += creatorEarningsUsd(v, netFeeBpsForTurn(t.buildPath, t.feeBps))
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

export default function LinksHero() {
  return <LandingHero />
}
