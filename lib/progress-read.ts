import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import prisma from '@/lib/db'
import { TEST_WALLETS } from '@/lib/admin'
import { chainById, chainByKey } from '@/lib/chains'
import { UNATTRIBUTED_VENUE, venueOfBuildPath } from '@/lib/build-path'
import { arcQuery } from '@/lib/gtm-arc'
import { NOT_HARNESS, feeSummary, linkDailySeries, publicCreatorHandles, type FeeSummary, type LinkDayPoint } from '@/lib/links-board'
import { REAL_TRAFFIC_SQL } from '@/lib/value-origin'
import {
  chartDays,
  fillDays,
  foldFunnel,
  funnelDays,
  monotoneFunnel,
  rankWallets,
  type DayPoint,
  type FunnelRow,
  type ProgressWindow,
  type WalletRank,
} from '@/lib/progress'

// The readers behind /leaderboard and /analytics. SERVER ONLY. Every figure a
// stranger can see here is fenced the way /links and /activity fence theirs:
//   money   — embed_turns, outcome 'signed', value_usd > 0, NOT_HARNESS (the
//             harness session prefix + lib/value-origin's internal mirror +
//             receipt-counted only);
//   mints   — intent_links with is_internal false and a creator (house seeds
//             are the product's own, not a user's progress);
//   opens   — intent_link_events on links that are not internal;
//   people  — visitor_events, team / claimed-team / bot / internal rows out.
// Every reader fails SOFT to an empty shape: a slow or absent table costs the
// page a section, never a 500. Reads are cached per window for two minutes
// (unstable_cache) — these are public aggregates with nothing per-viewer.

const BOARD_LIMIT = 10

export interface LinkRank {
  slug: string
  ask: string
  movedUsd: number
  claims: number
  opens: number
}

export interface CreatorRank {
  handle: string
  links: number
  movedUsd: number
  claims: number
}

export interface Totals {
  movedUsd: number
  signed: number
  built: number
  wallets: number
  linksMinted: number
  linkOpens: number
  linkClaims: number
}

export interface LeaderboardData {
  window: ProgressWindow
  totals: Totals
  /** Signed notional over ALL time — the milestone ladder reads this. */
  allTimeUsd: number
  links: LinkRank[]
  creators: CreatorRank[]
  wallets: WalletRank[]
  generatedAt: string
}

export interface VenueRow {
  venue: string
  usd: number
  n: number
}

export interface AnalyticsData {
  window: ProgressWindow
  totals: Totals
  previous: Totals | null
  allTimeUsd: number
  daily: DayPoint[]
  links: LinkDayPoint[]
  funnel: FunnelRow
  funnelBySource: FunnelRow[]
  venues: VenueRow[]
  chains: VenueRow[]
  fees: FeeSummary | null
  visitors: { people: number; previous: number | null } | null
  generatedAt: string
}

const EMPTY_TOTALS: Totals = { movedUsd: 0, signed: 0, built: 0, wallets: 0, linksMinted: 0, linkOpens: 0, linkClaims: 0 }

const sinceOf = (w: ProgressWindow, now: number, back = 1): Date | null => (w === 0 ? null : new Date(now - w * back * 86_400_000))
const r2 = (n: number) => Math.round(n * 100) / 100

const signedWhere = (since: Date | null, until: Date | null = null): Prisma.EmbedTurnWhereInput => ({
  outcome: 'signed',
  valueUsd: { gt: 0 },
  ...NOT_HARNESS,
  ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
})

async function readTotals(since: Date | null, until: Date | null = null): Promise<Totals> {
  try {
    const turnsWhere = signedWhere(since, until)
    const span = since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}
    const [signed, built, wallets, minted, opens, claims] = await Promise.all([
      prisma.embedTurn.aggregate({ where: turnsWhere, _sum: { valueUsd: true }, _count: { _all: true } }),
      prisma.embedTurn.count({ where: { outcome: 'tx-built', ...NOT_HARNESS, ...span } }),
      prisma.embedTurn.findMany({ where: { ...turnsWhere, walletAddress: { not: null } }, select: { walletAddress: true }, distinct: ['walletAddress'] }),
      prisma.intentLink.count({ where: { isInternal: false, creator: { not: null }, ...span } }),
      prisma.intentLinkEvent.count({ where: { kind: 'open', isInternal: false, ...span } }),
      prisma.embedTurn.count({ where: { ...turnsWhere, intentLinkSlug: { not: null } } }),
    ])
    const test = new Set(TEST_WALLETS.map((w) => w.toLowerCase()))
    return {
      movedUsd: r2(signed._sum.valueUsd ?? 0),
      signed: signed._count._all,
      built,
      wallets: wallets.filter((w) => w.walletAddress && !test.has(w.walletAddress.toLowerCase())).length,
      linksMinted: minted,
      linkOpens: opens,
      linkClaims: claims,
    }
  } catch {
    return { ...EMPTY_TOTALS }
  }
}

async function readAllTimeUsd(): Promise<number> {
  try {
    const agg = await prisma.embedTurn.aggregate({ where: signedWhere(null), _sum: { valueUsd: true } })
    return r2(agg._sum.valueUsd ?? 0)
  } catch {
    return 0
  }
}

async function readLinkRanks(since: Date | null): Promise<LinkRank[]> {
  try {
    const moved = await prisma.embedTurn.groupBy({
      by: ['intentLinkSlug'],
      where: { ...signedWhere(since), intentLinkSlug: { not: null } },
      _sum: { valueUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { valueUsd: 'desc' } },
      take: 60,
    })
    const slugs = moved.map((m) => m.intentLinkSlug).filter((s): s is string => !!s)
    if (slugs.length === 0) return []
    const [links, opens] = await Promise.all([
      // Revoked links leave the board; internal (harness) mints never ranked
      // in the first place (#699: fence rankings on BOTH sides).
      prisma.intentLink.findMany({ where: { id: { in: slugs }, revoked: false, isInternal: false }, select: { id: true, ask: true } }),
      prisma.intentLinkEvent.groupBy({ by: ['slug'], where: { slug: { in: slugs }, kind: 'open' }, _count: { _all: true } }),
    ])
    return moved
      .flatMap((m) => {
        const link = links.find((l) => l.id === m.intentLinkSlug)
        if (!link) return []
        return [{ slug: link.id, ask: link.ask, movedUsd: r2(m._sum.valueUsd ?? 0), claims: m._count._all, opens: opens.find((o) => o.slug === link.id)?._count._all ?? 0 }]
      })
      .sort((a, b) => b.movedUsd - a.movedUsd || b.claims - a.claims)
      .slice(0, BOARD_LIMIT)
  } catch {
    return []
  }
}

async function readCreatorRanks(since: Date | null): Promise<CreatorRank[]> {
  try {
    const handles = await publicCreatorHandles(100)
    if (handles.length === 0) return []
    const creators = handles.map((h) => h.creator)
    const [links, moved] = await Promise.all([
      prisma.intentLink.findMany({ where: { creator: { in: creators }, revoked: false, isInternal: false }, select: { id: true, creator: true } }),
      prisma.embedTurn.groupBy({
        by: ['intentLinkSlug'],
        where: { ...signedWhere(since), intentLinkSlug: { not: null } },
        _sum: { valueUsd: true },
        _count: { _all: true },
      }),
    ])
    const bySlug = new Map(moved.map((m) => [m.intentLinkSlug, m]))
    return handles
      .map((h) => {
        const mine = links.filter((l) => l.creator === h.creator)
        let movedUsd = 0
        let claims = 0
        for (const l of mine) {
          const m = bySlug.get(l.id)
          movedUsd += m?._sum.valueUsd ?? 0
          claims += m?._count._all ?? 0
        }
        return { handle: h.handle, links: mine.length, movedUsd: r2(movedUsd), claims }
      })
      .filter((r) => r.links > 0)
      .sort((a, b) => b.movedUsd - a.movedUsd || b.claims - a.claims || b.links - a.links || (a.handle < b.handle ? -1 : 1))
      .slice(0, BOARD_LIMIT)
  } catch {
    return []
  }
}

async function readWalletRanks(since: Date | null): Promise<WalletRank[]> {
  try {
    const rows = await prisma.embedTurn.groupBy({
      by: ['walletAddress'],
      where: { ...signedWhere(since), walletAddress: { not: null } },
      _sum: { valueUsd: true },
      _count: { _all: true },
      _min: { createdAt: true },
      orderBy: { _sum: { valueUsd: 'desc' } },
      take: 80,
    })
    return rankWallets(
      rows.map((r) => ({ wallet: r.walletAddress ?? '', usd: r._sum.valueUsd ?? 0, signed: r._count._all, firstAt: r._min.createdAt?.toISOString() })),
      TEST_WALLETS,
      BOARD_LIMIT,
    )
  } catch {
    return []
  }
}

async function readDaily(days: number, now: number): Promise<DayPoint[]> {
  try {
    const since = new Date(now - days * 86_400_000)
    const rows = await prisma.$queryRaw<{ day: Date; usd: number; n: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(value_usd), 0)::float AS usd, COUNT(*) AS n
      FROM embed_turns
      WHERE outcome = 'signed' AND value_usd > 0 AND session_id NOT LIKE 'harness-%'
        AND ${Prisma.raw(REAL_TRAFFIC_SQL)} AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`
    const points = rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), usd: r2(r.usd), n: Number(r.n) }))
    return fillDays(points, days, now, (day) => ({ day, usd: 0, n: 0 }))
  } catch {
    return fillDays([], days, now, (day) => ({ day, usd: 0, n: 0 }))
  }
}

async function readFunnel(days: number): Promise<{ total: FunnelRow; bySource: FunnelRow[] }> {
  try {
    const rows = await prisma.$queryRaw<FunnelRow[]>(arcQuery(days))
    const bySource = rows.map(monotoneFunnel)
    return { total: monotoneFunnel(foldFunnel(bySource)), bySource }
  } catch {
    return { total: { source: 'all', arrived: 0, asked: 0, built: 0, signed: 0, returned: 0 }, bySource: [] }
  }
}

async function readVenues(since: Date | null): Promise<{ venues: VenueRow[]; chains: VenueRow[] }> {
  try {
    const [byPath, byChain] = await Promise.all([
      prisma.embedTurn.groupBy({ by: ['buildPath'], where: signedWhere(since), _sum: { valueUsd: true }, _count: { _all: true } }),
      prisma.embedTurn.groupBy({ by: ['chain'], where: signedWhere(since), _sum: { valueUsd: true }, _count: { _all: true } }),
    ])
    const fold = (rows: { key: string; usd: number; n: number }[]) => {
      const m = new Map<string, VenueRow>()
      for (const r of rows) {
        const cur = m.get(r.key) ?? { venue: r.key, usd: 0, n: 0 }
        cur.usd = r2(cur.usd + r.usd)
        cur.n += r.n
        m.set(r.key, cur)
      }
      return [...m.values()].sort((a, b) => b.usd - a.usd || b.n - a.n)
    }
    const chainLabel = (c: string | null): string => {
      if (!c) return 'unknown'
      if (c === 'multi') return 'multi-chain'
      const byKey = chainByKey(c)
      if (byKey) return byKey.short
      const id = c.startsWith('0x') ? parseInt(c, 16) : Number(c)
      return chainById(Number.isFinite(id) ? id : null)?.short ?? c
    }
    return {
      venues: fold(byPath.map((r) => ({ key: venueOfBuildPath(r.buildPath) ?? UNATTRIBUTED_VENUE, usd: r._sum.valueUsd ?? 0, n: r._count._all }))),
      chains: fold(byChain.map((r) => ({ key: chainLabel(r.chain), usd: r._sum.valueUsd ?? 0, n: r._count._all }))),
    }
  } catch {
    return { venues: [], chains: [] }
  }
}

async function readVisitors(since: Date | null, prev: Date | null): Promise<AnalyticsData['visitors']> {
  try {
    const count = (from: Date | null, to: Date | null) =>
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT vid) AS n FROM visitor_events
        WHERE NOT is_internal AND NOT is_bot AND NOT is_team AND NOT team_claimed
          AND (${from}::timestamptz IS NULL OR created_at >= ${from}::timestamptz)
          AND (${to}::timestamptz IS NULL OR created_at < ${to}::timestamptz)`.then((r) => Number(r[0]?.n ?? 0))
    const people = await count(since, null)
    const previous = since && prev ? await count(prev, since) : null
    return { people, previous }
  } catch {
    return null
  }
}

const cachedLeaderboard = unstable_cache(
  async (w: ProgressWindow): Promise<LeaderboardData> => {
    const now = Date.now()
    const since = sinceOf(w, now)
    const [totals, allTimeUsd, links, creators, wallets] = await Promise.all([
      readTotals(since),
      readAllTimeUsd(),
      readLinkRanks(since),
      readCreatorRanks(since),
      readWalletRanks(since),
    ])
    return { window: w, totals, allTimeUsd, links, creators, wallets, generatedAt: new Date(now).toISOString() }
  },
  ['progress-leaderboard'],
  { revalidate: 120 },
)

const cachedAnalytics = unstable_cache(
  async (w: ProgressWindow): Promise<AnalyticsData> => {
    const now = Date.now()
    const since = sinceOf(w, now)
    const prev = sinceOf(w, now, 2)
    const days = chartDays(w)
    const [totals, previous, allTimeUsd, daily, links, funnel, venues, fees, visitors] = await Promise.all([
      readTotals(since),
      since && prev ? readTotals(prev, since) : Promise.resolve(null),
      readAllTimeUsd(),
      readDaily(days, now),
      linkDailySeries(days).then((p) => fillDays(p, days, now, (day) => ({ day, minted: 0, convs: 0, usd: 0 }))),
      readFunnel(funnelDays(w)),
      readVenues(since),
      feeSummary(),
      readVisitors(since, prev),
    ])
    return {
      window: w,
      totals,
      previous,
      allTimeUsd,
      daily,
      links,
      funnel: funnel.total,
      funnelBySource: funnel.bySource,
      venues: venues.venues,
      chains: venues.chains,
      fees,
      visitors,
      generatedAt: new Date(now).toISOString(),
    }
  },
  ['progress-analytics'],
  { revalidate: 120 },
)

export function readLeaderboard(w: ProgressWindow): Promise<LeaderboardData> {
  return cachedLeaderboard(w)
}

export function readAnalytics(w: ProgressWindow): Promise<AnalyticsData> {
  return cachedAnalytics(w)
}
