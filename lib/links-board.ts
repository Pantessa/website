import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { HOUSE_LINKS } from '@/lib/house-links'
import { FEE_BEARING_BUILD_PATHS, FEES_LIVE_SINCE, SWAP_FEE_BPS, CREATOR_FEE_SPLIT } from '@/lib/fees'

// The intent-links board data, shared by /links (the full leaderboard) and
// /activity (the link-economy section). Server-only: ranks by server-truth
// dollars moved — guardrail-priced signed turns in embed_turns — never a
// client-reported number. Asks only; creators stay pseudonymous.

export interface LinkBoardRow {
  slug: string
  ask: string
  movedUsd: number
  opens: number
}

export async function topLinks(limit = 10): Promise<LinkBoardRow[]> {
  try {
    const moved = await prisma.embedTurn.groupBy({
      by: ['intentLinkSlug'],
      where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 } },
      _sum: { valueUsd: true },
      orderBy: { _sum: { valueUsd: 'desc' } },
      take: limit,
    })
    const slugs = moved.map((m) => m.intentLinkSlug).filter((s): s is string => !!s)
    if (slugs.length === 0) return []
    const [links, opens] = await Promise.all([
      prisma.intentLink.findMany({ where: { id: { in: slugs }, revoked: false }, select: { id: true, ask: true } }),
      prisma.intentLinkEvent.groupBy({ by: ['slug'], where: { slug: { in: slugs }, kind: 'open' }, _count: { _all: true } }),
    ])
    return moved
      .map((m) => {
        const link = links.find((l) => l.id === m.intentLinkSlug)
        if (!link) return null
        return {
          slug: link.id,
          ask: link.ask,
          movedUsd: m._sum.valueUsd ?? 0,
          opens: opens.find((o) => o.slug === link.id)?._count._all ?? 0,
        }
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
  } catch {
    return []
  }
}

/** House links that are live in the DB (seeded) and not already on the
 *  board — the start-here strip, so the page demos real product even when
 *  the board is young. */
export async function liveHouseLinks(exclude: Set<string>) {
  try {
    const rows = await prisma.intentLink.findMany({
      where: { id: { in: HOUSE_LINKS.map((h) => h.slug) }, revoked: false },
      select: { id: true, ask: true },
    })
    // Preserve the curated HOUSE_LINKS order, drop board duplicates.
    return HOUSE_LINKS.filter((h) => !exclude.has(h.slug) && rows.some((r) => r.id === h.slug))
  } catch {
    return []
  }
}

// ── The public fee story ────────────────────────────────────────────────────
// A LEDGERED ESTIMATE, not a new money source: the same read-time formula
// the creator claims rail uses (lib/fees.ts — SWAP_FEE_BPS on fee-bearing
// signed notional, half of the link-attributed share to creators), windowed
// to FEES_LIVE_SINCE like the admin treasury tab. The treasury address
// on-chain remains THE source of truth for what was actually collected.

export interface FeeSummary {
  /** Signed notional on fee-bearing build paths since fees went live. */
  feeBearingUsd: number
  /** Estimated fees accrued to link creators (their half, link-attributed). */
  creatorUsd: number
  /** Estimated fees accrued to Yeetful (everything else). */
  yeetfulUsd: number
  conversions: number
}

export async function feeSummary(): Promise<FeeSummary | null> {
  try {
    const since = new Date(FEES_LIVE_SINCE)
    const feeWhere: Prisma.EmbedTurnWhereInput = {
      outcome: 'signed',
      valueUsd: { gt: 0 },
      buildPath: { in: [...FEE_BEARING_BUILD_PATHS] },
      createdAt: { gte: since },
    }
    const [all, linked] = await Promise.all([
      prisma.embedTurn.aggregate({ where: feeWhere, _sum: { valueUsd: true }, _count: true }),
      prisma.embedTurn.aggregate({
        where: { ...feeWhere, intentLinkSlug: { not: null } },
        _sum: { valueUsd: true },
      }),
    ])
    const feeBearingUsd = all._sum.valueUsd ?? 0
    const totalFeeUsd = feeBearingUsd * (SWAP_FEE_BPS / 10_000)
    const creatorUsd = (linked._sum.valueUsd ?? 0) * (SWAP_FEE_BPS / 10_000) * CREATOR_FEE_SPLIT
    return {
      feeBearingUsd,
      creatorUsd,
      yeetfulUsd: Math.max(0, totalFeeUsd - creatorUsd),
      conversions: typeof all._count === 'number' ? all._count : 0,
    }
  } catch {
    return null
  }
}
