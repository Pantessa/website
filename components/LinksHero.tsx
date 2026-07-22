import prisma from '@/lib/db'
import { FEE_BEARING_BUILD_PATHS, creatorEarningsUsd } from '@/lib/fees'
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
    const usd = (n: number) =>
      n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`
    return {
      links: String(links),
      opens: String(opens),
      movedUsd: usd(movedUsd),
      creatorUsd: usd(creatorEarningsUsd(feeBearingUsd)),
    }
  } catch {
    return null
  }
}

export default async function LinksHero() {
  const stats = await linkStats()
  return <LinksHeroView stats={stats} />
}
