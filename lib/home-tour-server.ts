// THE TOUR's server read (squad landing, 2026-11-10; lane DATA owns this
// file after the contract). What the landing's panels need from the server,
// in one snapshot the page reads at render.
//
// TWO PARTS:
//   • the STATIC part — counts and fees straight from the registries the
//     product itself runs on (the boards, the apps row, the chain registry,
//     the published venue manifest, lib/fees). Synchronous, no I/O. A count
//     on the landing is never typed.
//   • the LIVE part — the yield ladder and the community's public posts.
//     The contract ships it EMPTY; lane DATA fills it.
//
// THE RULE THAT KEEPS `/` FAST: the home is ISR (`export const revalidate =
// 60`, pinned). A read here must go through `unstable_cache` (the pattern is
// lib/read-server.ts readSnapshotForRender) — a `cache: 'no-store'` fetch or
// a bare DB read at render turns `/` into a per-request page. Fail soft,
// cap the time, never throw: an empty live part renders fine.
//
// Server-only: this imports the venue manifest (every builder's constants).
// A client component must never import this file — it takes the snapshot as
// a prop (components/home/tour/context.tsx).

import { APP_CHAINS } from '@/lib/chains'
import { CREATOR_FEE_SPLIT, HL_BUILDER_FEE_TENTH_BPS, LINK_FEE_PCT, LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, SWAP_FEE_PCT, feePctLabel } from '@/lib/fees'
import { HOME_APPS } from '@/lib/home-apps'
import { MACRO_ROWS } from '@/lib/macro'
import { marketSections } from '@/lib/markets'
import { buildVenueManifest } from '@/lib/venue-manifest'
import { EMPTY_TOUR, type TourCounts, type TourEarnRow, type TourFees, type TourSnapshot } from '@/lib/home-tour/types'
import { unstable_cache } from 'next/cache'
import prisma from '@/lib/db'
import { listFeed } from '@/lib/community/store'
import { rowsFromWire, type EarnResponse, type EarnRow } from '@/lib/earn'
import { GET as readEarnRoute } from '@/app/api/markets/earn/route'
import { TOUR_FEED_TIMEOUT_MS, TOUR_WEEK_MS, tourEarnOf, tourPostsOf, withTimeout } from '@/lib/home-tour-live'

/** Counts from the registries. Pure; safe at build and at render. */
export function tourStaticCounts(): TourCounts {
  const sections = marketSections()
  const rows = (id: string) => sections.find((s) => s.id === id)?.rows.length ?? null
  let venues: number | null = null
  let pinnedAddresses: number | null = null
  try {
    const manifest = buildVenueManifest()
    venues = manifest.venues.length
    pinnedAddresses = manifest.venues.reduce((n, v) => n + v.chains.reduce((m, c) => m + c.contracts.length, 0), 0)
  } catch {
    // The manifest is pure; if it ever throws, the Build panel says less.
  }
  return {
    stocks: rows('equities'),
    crypto: rows('crypto'),
    macro: MACRO_ROWS.length,
    apps: HOME_APPS.length,
    chains: APP_CHAINS.length,
    venues,
    pinnedAddresses,
    earnWays: null,
  }
}

/** The fee lines, from lib/fees — the one fee source. */
export function tourFees(): TourFees {
  return {
    swapPct: SWAP_FEE_PCT,
    linkPct: LINK_FEE_PCT,
    creatorPct: feePctLabel(LINK_SWAP_FEE_BPS * CREATOR_FEE_SPLIT),
    // The builder fee in the same two-place form as the other lines ("0.10%"), so a column of fees reads evenly.
    hlPct: feePctLabel(HL_BUILDER_FEE_TENTH_BPS / 10),
    swapBps: SWAP_FEE_BPS,
    linkBps: LINK_SWAP_FEE_BPS,
    creatorSplit: CREATOR_FEE_SPLIT,
  }
}

/** The static part alone: what the page can always say. */
export function staticTourSnapshot(): TourSnapshot {
  return {
    ...EMPTY_TOUR,
    counts: tourStaticCounts(),
    fees: tourFees(),
    chains: APP_CHAINS.map((c) => ({ id: c.id, name: c.name })),
  }
}

// ── The live part (lane DATA) ────────────────────────────────────────────────

/** The Earn board's rows, read through the board's OWN route handler (the
 *  same venues, the same composer, the same 60s memory as GET
 *  /api/markets/earn), then re-hydrated exactly as the board does
 *  (rowsFromWire → rankEarnRows → yieldLadder, in lib/home-tour-live). */
async function readEarnRows(): Promise<EarnRow[]> {
  const res = await readEarnRoute()
  const body = (await res.json()) as Partial<EarnResponse>
  return Array.isArray(body.rows) ? rowsFromWire(body.rows) : []
}

/** The ladder, cached for the page's minute. An EMPTY read throws on purpose:
 *  `unstable_cache` keeps no result for a throw, so a cold venue read that
 *  timed out does not pin an empty ladder for a minute (the read it started
 *  keeps going and fills the route's memory for the next render). */
const cachedEarn = unstable_cache(
  async (): Promise<{ earn: TourEarnRow[]; earnWays: number | null; at: number }> => {
    const rows = await withTimeout(readEarnRows(), TOUR_FEED_TIMEOUT_MS, [] as EarnRow[])
    const out = tourEarnOf(rows)
    if (!out.earn.length) throw new Error('earn: nothing read yet')
    return { ...out, at: Date.now() }
  },
  ['home-tour-v1', 'earn'],
  { revalidate: 60 },
)

async function readCommunity(nowMs: number): Promise<TourSnapshot['community']> {
  const since = new Date(nowMs - TOUR_WEEK_MS)
  // Internal rooms (the harness's, the team's) are few; their posts never count.
  const internalRooms = (await prisma.community.findMany({ where: { isInternal: true }, select: { slug: true }, take: 5000 })).map((c) => c.slug)
  const [rooms, postsWeek, page] = await Promise.all([
    prisma.community.count({ where: { isInternal: false } }),
    // Every public post the feed can list this week (the symbol forum's too).
    prisma.chartPost.count({
      where: { isInternal: false, createdAt: { gte: since }, ...(internalRooms.length ? { OR: [{ communitySlug: null }, { communitySlug: { notIn: internalRooms } }] } : {}) },
    }),
    listFeed({ sort: 'hot', limit: 12 }),
  ])
  const internal = new Set(internalRooms)
  const publicRooms = new Set(page.posts.map((p) => p.community?.slug).filter((s): s is string => !!s && !internal.has(s)))
  return { rooms, postsWeek, latest: tourPostsOf(page.posts, publicRooms) }
}

/** The community line, cached for the page's minute. A store that is not
 *  answering (or the 2.5s cap) reads as the empty line, which the panel
 *  answers with its specimen. */
const cachedCommunity = unstable_cache(
  async (): Promise<TourSnapshot['community']> => withTimeout(readCommunity(Date.now()), TOUR_FEED_TIMEOUT_MS, EMPTY_TOUR.community),
  ['home-tour-v1', 'community'],
  { revalidate: 60 },
)

/** The live part alone. Never throws. */
export async function readTourLive(): Promise<Pick<TourSnapshot, 'earn' | 'community'> & { earnWays: number | null; at: number }> {
  const [earn, community] = await Promise.all([
    cachedEarn().catch(() => ({ earn: [] as TourEarnRow[], earnWays: null, at: 0 })),
    cachedCommunity().catch(() => EMPTY_TOUR.community),
  ])
  return { earn: earn.earn, earnWays: earn.earnWays, community, at: earn.at }
}

/** The snapshot for the page's render (and GET /api/home/tour): the static
 *  part plus the live part. `/` is ISR — every read above goes through
 *  `unstable_cache` (the pattern of lib/read-server readSnapshotForRender),
 *  each feed is time-capped and fail-soft, and nothing here throws. */
export async function readTourSnapshotForRender(): Promise<TourSnapshot> {
  const base = staticTourSnapshot()
  try {
    const live = await readTourLive()
    return {
      ...base,
      // When the ladder was read (0 = only the static part and the community line).
      asOf: live.at,
      counts: { ...base.counts, earnWays: live.earnWays },
      earn: live.earn,
      community: live.community,
    }
  } catch {
    return base
  }
}
