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
import { CREATOR_FEE_SPLIT, HL_BUILDER_MAX_FEE_RATE, LINK_FEE_PCT, LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, SWAP_FEE_PCT, feePctLabel } from '@/lib/fees'
import { HOME_APPS } from '@/lib/home-apps'
import { MACRO_ROWS } from '@/lib/macro'
import { marketSections } from '@/lib/markets'
import { buildVenueManifest } from '@/lib/venue-manifest'
import { EMPTY_TOUR, type TourCounts, type TourFees, type TourSnapshot } from '@/lib/home-tour/types'

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
    hlPct: HL_BUILDER_MAX_FEE_RATE,
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

/** The snapshot for the page's render. CONTRACT BASELINE: the static part
 *  only. Lane DATA adds the live part (earn, community) behind
 *  `unstable_cache`, fail-soft and time-capped. */
export async function readTourSnapshotForRender(): Promise<TourSnapshot> {
  return staticTourSnapshot()
}
