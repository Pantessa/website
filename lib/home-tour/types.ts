// THE TOUR — the landing's "everything it does" section (squad landing,
// 2026-11-10, Nate: "make the landing page shine and show off all the things
// we can do in a clean way that drives users into the app more from each
// side of the system"). Eight sides of the product, each with a claim, a
// live miniature and a door into that side of the app.
//
// This file is the CONTRACT's vocabulary: the ids, the shape of a side's
// words and the snapshot the server hands the panels. Pure and client-safe
// (no registry imports here — a client bundle pulls this in).

/** The eight sides, in the order a stranger should meet them: where you
 *  look, how you ask, how it spreads, what runs while you are away, who
 *  else is here, what idle money earns, where it all sits, how to build on
 *  it. The order is pinned (scripts/landing-coord-pins.ts). */
export const TOUR_IDS = ['charts', 'ask', 'links', 'autopilots', 'community', 'earn', 'wallet', 'build'] as const
export type TourId = (typeof TOUR_IDS)[number]

export interface TourDoor {
  /** The words on the door: a verb and its object, four words at most. */
  label: string
  /** A real route, or an anchor on this page (`#earn`). STATIC — never built from input. */
  href: string
  /** `primary` is the side's one main way in; the rest are quiet links. */
  kind: 'primary' | 'quiet'
}

export interface TourAsk {
  /** The sentence exactly as the app's own layers accept it (the corpus is scripts/audit-asks.ts). */
  ask: string
  /** The short words on its chip. */
  label: string
  /** Which app or layer catches it, in the product's words ("Uniswap", "Hyperliquid", "a job"). */
  via: string
}

export interface TourSideMeta {
  id: TourId
  /** The tab's word: one or two words. */
  label: string
  /** The side's claim — its panel's heading. A full short sentence. */
  claim: string
  /** One line under the label in the tour's list (64 characters at most). */
  line: string
  /** What it is and why it matters. Two sentences at most. May carry `{slot}`s. */
  body: string
  /** Up to three short facts. A number in one is ALWAYS a `{slot}` filled from
   *  the snapshot (lib/home-tour/index.ts fillSlots) — never typed. A fact
   *  whose slot has no value is dropped, never shown with a hole. */
  facts: string[]
  /** One `primary` door first, then up to two quiet ones. */
  doors: TourDoor[]
  /** Sentences this side can run from the landing (may be empty). */
  asks: TourAsk[]
}

// ── The snapshot: what the server reads for the panels ────────────────────

/** A row of the yield ladder: the best live rate for one asset. */
export interface TourEarnRow {
  asset: string
  venue: string
  chain: string
  /** Yearly rate, percent (8.97 = 8.97%). */
  apy: number
  /** The sentence that takes it, already in the layer's grammar. */
  ask: string
}

/** A PUBLIC community post (fenced: never an internal or harness row). */
export interface TourCommunityPost {
  kind: 'idea' | 'link' | 'video' | 'trade'
  title: string
  symbol: string | null
  room: string | null
  /** For a trade post with proof: the dollars the chain says this wallet moved. Null otherwise. */
  movedUsd: number | null
  score: number
  /** Posted at, ms. */
  at: number
  href: string
}

export interface TourCounts {
  /** Tokenized stocks listed (the equities board). */
  stocks: number | null
  /** Coins on the crypto board. */
  crypto: number | null
  /** Rows on the macro board. */
  macro: number | null
  /** First-party apps on the splash's apps row. */
  apps: number | null
  /** Chains the app acts on. */
  chains: number | null
  /** Venues in the published venue manifest. */
  venues: number | null
  /** Contract addresses pinned in the manifest. */
  pinnedAddresses: number | null
  /** Rows on the Earn board right now (live; null until read). */
  earnWays: number | null
}

export interface TourFees {
  /** "0.20%" — an ordinary swap. */
  swapPct: string
  /** "0.50%" — a swap that arrives through a link. */
  linkPct: string
  /** "0.25%" — the creator's half of the link fee, as a percent of the fill. */
  creatorPct: string
  /** "0.1%" — the Hyperliquid builder fee. */
  hlPct: string
  swapBps: number
  linkBps: number
  /** 0.5 — the creator's share of the link fee. */
  creatorSplit: number
}

export interface TourSnapshot {
  /** When the live part was read, ms. 0 = only the static part is here. */
  asOf: number
  counts: TourCounts
  fees: TourFees | null
  chains: { id: number; name: string }[]
  /** Best live rate per asset, highest first. Empty until read. */
  earn: TourEarnRow[]
  community: { rooms: number; postsWeek: number; latest: TourCommunityPost[] }
}

/** The shape with nothing read: every panel must render well against this
 *  (a count is null, a list is empty — say less, never show a hole). */
export const EMPTY_TOUR: TourSnapshot = {
  asOf: 0,
  counts: { stocks: null, crypto: null, macro: null, apps: null, chains: null, venues: null, pinnedAddresses: null, earnWays: null },
  fees: null,
  chains: [],
  earn: [],
  community: { rooms: 0, postsWeek: 0, latest: [] },
}
