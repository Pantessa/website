import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { HOUSE_LINKS } from '@/lib/house-links'
import { FEE_BEARING_BUILD_PATHS, FEES_LIVE_SINCE, CREATOR_FEE_SPLIT, netFeeBpsFor } from '@/lib/fees'
import { INTERNAL_ORIGIN_SQL, INTERNAL_TRAFFIC_WHERE } from '@/lib/value-origin'

// The intent-links board data, shared by /links (the full leaderboard) and
// /activity (the link-economy section). Server-only: every figure comes from
// FINISHED flows — guardrail-priced signed turns in embed_turns — never a
// mint-time amount and never a client-reported number. Asks only; creators
// stay pseudonymous.

// The API harness posts fake signed turns (sessionId `harness-…`) to exercise
// the fee-split rail against the shared DB, and dev drives on localhost prod
// builds write real signed turns too — the public board must never rank
// either (lib/value-origin.ts isInternalOrigin + mirrors). Creator-facing
// surfaces (dashboard list, claims) keep seeing them.
const NOT_HARNESS: Prisma.EmbedTurnWhereInput = { NOT: { OR: [{ sessionId: { startsWith: 'harness-' } }, INTERNAL_TRAFFIC_WHERE] } }

export interface LinkBoardRow {
  slug: string
  ask: string
  /** Signed notional attributed to the link — dollars actually moved. */
  movedUsd: number
  /** Finished flows: signed, value-bearing turns the link produced. */
  claims: number
  opens: number
  /** ISO mint time — set on the recently-minted rows only. */
  mintedAt?: string
}

export interface LinksBoard {
  /** Ranked by finished flows (signed conversions) — the default tab. */
  byClaims: LinkBoardRow[]
  /** Ranked by signed notional moved. */
  byMoved: LinkBoardRow[]
  /** Newest creator mints, straight from intent_links — no signs needed. */
  byRecent: LinkBoardRow[]
}

// How many slugs to aggregate before joining/sorting; revoked links drop at
// the join, so this over-fetches past `limit` on purpose.
const BOARD_SCAN = 200

export async function linksBoard(limit = 10): Promise<LinksBoard> {
  try {
    // The recent tab reads MINTS, not turns: the newest live creator links.
    // House seeds (creator null) stay on their curated start-here strip, and
    // allowlist-reserved promo links stay off — a public row that refuses
    // whoever taps it is a dead-end, not a demo. Internal mints stay off too:
    // NOT_HARNESS only fences the turn side, and every test:api run mints from
    // a throwaway wallet against the shared DB, so the mint side needs the
    // isInternal flag or the board reads as ten identical bot rows.
    const [signed, recent] = await Promise.all([
      prisma.embedTurn.groupBy({
        by: ['intentLinkSlug'],
        where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 }, ...NOT_HARNESS },
        _sum: { valueUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { valueUsd: 'desc' } },
        take: BOARD_SCAN,
      }),
      prisma.intentLink.findMany({
        where: {
          revoked: false,
          isInternal: false,
          creator: { not: null },
          allowWallets: { isEmpty: true },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, ask: true, createdAt: true },
      }),
    ])
    const slugs = signed.map((m) => m.intentLinkSlug).filter((s): s is string => !!s)
    const recentIds = recent.map((r) => r.id)
    if (slugs.length === 0 && recentIds.length === 0) return { byClaims: [], byMoved: [], byRecent: [] }
    const [links, opens, recentSigned] = await Promise.all([
      prisma.intentLink.findMany({ where: { id: { in: slugs }, revoked: false }, select: { id: true, ask: true } }),
      prisma.intentLinkEvent.groupBy({
        by: ['slug'],
        where: { slug: { in: [...new Set([...slugs, ...recentIds])] }, kind: 'open' },
        _count: { _all: true },
      }),
      // Exact per-slug figures for the recent rows — a fresh mint can sit
      // below the BOARD_SCAN ranking window and still deserve its truth.
      recentIds.length
        ? prisma.embedTurn.groupBy({
            by: ['intentLinkSlug'],
            where: { intentLinkSlug: { in: recentIds }, outcome: 'signed', valueUsd: { gt: 0 }, ...NOT_HARNESS },
            _sum: { valueUsd: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ])
    const rows = signed
      .map((m) => {
        const link = links.find((l) => l.id === m.intentLinkSlug)
        if (!link) return null
        return {
          slug: link.id,
          ask: link.ask,
          movedUsd: m._sum.valueUsd ?? 0,
          claims: m._count._all,
          opens: opens.find((o) => o.slug === link.id)?._count._all ?? 0,
        }
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
    const byRecent = recent.map((l) => {
      const m = recentSigned.find((s) => s.intentLinkSlug === l.id)
      return {
        slug: l.id,
        ask: l.ask,
        movedUsd: m?._sum.valueUsd ?? 0,
        claims: m?._count._all ?? 0,
        opens: opens.find((o) => o.slug === l.id)?._count._all ?? 0,
        mintedAt: l.createdAt.toISOString(),
      }
    })
    return {
      byClaims: [...rows].sort((a, b) => b.claims - a.claims || b.movedUsd - a.movedUsd).slice(0, limit),
      byMoved: [...rows].sort((a, b) => b.movedUsd - a.movedUsd).slice(0, limit),
      byRecent,
    }
  } catch {
    return { byClaims: [], byMoved: [], byRecent: [] }
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

// ── Creator pages ───────────────────────────────────────────────────────────
// Every claimed /l/<handle> storefront, listed so pages are FINDABLE — a
// claim is the opt-in to being public, so listing is part of the deal. The
// handle is the only key shown; wallets stay off every public surface.

export interface CreatorPageRow {
  handle: string
  /** Active (non-revoked) links on the page. */
  links: number
  /** Guardrail-priced signed notional across the page's links. */
  movedUsd: number
}

export async function creatorPages(limit = 50): Promise<CreatorPageRow[]> {
  try {
    const handles = await prisma.creatorHandle.findMany({ take: limit })
    if (handles.length === 0) return []
    const creators = handles.map((h) => h.creator)
    const [links, moved] = await Promise.all([
      prisma.intentLink.findMany({
        where: { creator: { in: creators }, revoked: false },
        select: { id: true, creator: true },
      }),
      prisma.embedTurn.groupBy({
        by: ['intentLinkSlug'],
        where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 }, ...NOT_HARNESS },
        _sum: { valueUsd: true },
      }),
    ])
    const usdBySlug = new Map(moved.map((m) => [m.intentLinkSlug, m._sum.valueUsd ?? 0]))
    const rows = handles.map((h) => {
      const mine = links.filter((l) => l.creator === h.creator)
      return {
        handle: h.handle,
        links: mine.length,
        movedUsd: mine.reduce((s, l) => s + (usdBySlug.get(l.id) ?? 0), 0),
      }
    })
    return rows.sort((a, b) => b.movedUsd - a.movedUsd || b.links - a.links || (a.handle < b.handle ? -1 : 1))
  } catch {
    return []
  }
}

// ── The link economy, per day ───────────────────────────────────────────────
// Links minted + signed conversions + guardrail-priced dollars, bucketed by
// UTC day — the daily pulse chart on /activity and the admin Adoption page.
// Server truth only (intent_links rows; embed_turns signed notional).

export interface LinkDayPoint {
  day: string
  minted: number
  convs: number
  usd: number
}

export async function linkDailySeries(days = 30): Promise<LinkDayPoint[]> {
  try {
    const since = new Date(Date.now() - days * 86_400_000)
    const [mintRows, convRows] = await Promise.all([
      prisma.$queryRaw<{ day: Date; n: number }[]>`
        SELECT date_trunc('day', created_at) AS day, count(*)::int AS n
        FROM intent_links WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ day: Date; n: number; usd: number }[]>`
        SELECT date_trunc('day', created_at) AS day, count(*)::int AS n,
               coalesce(sum(value_usd), 0)::float AS usd
        FROM embed_turns
        WHERE intent_link_slug IS NOT NULL AND outcome = 'signed' AND value_usd > 0
          AND session_id NOT LIKE 'harness-%'
          AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)}
          AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
    ])
    const byDay = new Map<string, LinkDayPoint>()
    const at = (d: Date) => {
      const key = d.toISOString().slice(0, 10)
      let p = byDay.get(key)
      if (!p) {
        p = { day: key, minted: 0, convs: 0, usd: 0 }
        byDay.set(key, p)
      }
      return p
    }
    for (const r of mintRows) at(r.day).minted = r.n
    for (const r of convRows) {
      const p = at(r.day)
      p.convs = r.n
      p.usd = Math.round(r.usd * 100) / 100
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
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
  /** Estimated fees accrued to Pantessa (everything else). */
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
      ...NOT_HARNESS,
    }
    // Grouped by path: each venue hands over a different NET rate (NEAR
    // Intents keeps half of its app fee), so one blended multiply would
    // overstate the treasury on every cross-chain dollar.
    const [all, linked] = await Promise.all([
      prisma.embedTurn.groupBy({ by: ['buildPath'], where: feeWhere, _sum: { valueUsd: true }, _count: { _all: true } }),
      prisma.embedTurn.groupBy({
        by: ['buildPath'],
        where: { ...feeWhere, intentLinkSlug: { not: null } },
        _sum: { valueUsd: true },
      }),
    ])
    const feeBearingUsd = all.reduce((s, r) => s + (r._sum.valueUsd ?? 0), 0)
    const totalFeeUsd = all.reduce((s, r) => s + (r._sum.valueUsd ?? 0) * (netFeeBpsFor(r.buildPath) / 10_000), 0)
    const creatorUsd = linked.reduce(
      (s, r) => s + (r._sum.valueUsd ?? 0) * (netFeeBpsFor(r.buildPath) / 10_000) * CREATOR_FEE_SPLIT,
      0,
    )
    return {
      feeBearingUsd,
      creatorUsd,
      yeetfulUsd: Math.max(0, totalFeeUsd - creatorUsd),
      conversions: all.reduce((s, r) => s + r._count._all, 0),
    }
  } catch {
    return null
  }
}
