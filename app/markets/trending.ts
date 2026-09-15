// "Trending on Pantessa" — the symbols strangers asked about this week
// (MK2/MARKETS, 2026-09-15). Server-only: one read of embed_turns under the
// INTERNAL FENCE (lib/value-origin INTERNAL_TRAFFIC_WHERE — is_internal +
// the localhost/preview origins), so a test:api run never trends its own
// "Swap $5 of ETH to USDC" (the #699 class). Counting is pure
// (lib/markets trendingFromPrompts). Fails SOFT to an empty list: the index
// renders without the strip, never a 500 — the DB is not on the page's
// critical path.

import prisma from '@/lib/db'
import { INTERNAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import { marketSections, trendingFromPrompts } from '@/lib/markets'

export interface TrendingRow {
  symbol: string
  asks: number
}

export const TRENDING_WINDOW_DAYS = 7
const TRENDING_SAMPLE = 2_000

export async function readTrending(limit = 8): Promise<TrendingRow[]> {
  const known = marketSections().flatMap((s) => s.rows.map((r) => r.symbol))
  try {
    const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 86_400_000)
    const rows = await prisma.embedTurn.findMany({
      where: { AND: [{ NOT: INTERNAL_TRAFFIC_WHERE }, { createdAt: { gte: since } }] },
      select: { prompt: true },
      orderBy: { createdAt: 'desc' },
      take: TRENDING_SAMPLE,
    })
    return trendingFromPrompts(
      rows.map((r) => r.prompt),
      known,
      limit,
    )
  } catch {
    return []
  }
}
