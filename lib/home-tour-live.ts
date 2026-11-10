// THE TOUR's live part, shaped (squad landing, lane DATA, 2026-11-10).
// Pure: no I/O, no Prisma, no fetch — lib/home-tour-server.ts reads the
// feeds and hands the raw rows here; scripts/landing-data-pins.ts feeds the
// same functions fixtures.
//
// Two rules live here, both borrowed, never re-invented:
//   • THE LADDER is the Earn board's own: lib/earn rankEarnRows → yieldLadder
//     (which assets get a bar is familiar-first, top N; the bars are drawn
//     highest rate first). A row's sentence is the row's own `askFor` at
//     EARN_DEFAULT_USD — the board's composer, never one typed here. A row
//     the board cannot size (no live ETH price for Lido; AAVE on Aave) has
//     no sentence, and a tour row without a sentence is dropped: the panel
//     promises "tap a row to run it".
//   • THE FEED is the public feed as /community serves it (lib/community/store
//     listFeed, which already fences `is_internal`), fenced AGAIN here: an
//     internal row, a post in a room that is not public, and an unparsed
//     proof never reach the landing. `movedUsd` is the chain-confirmed size
//     of a VERIFIED trade proof (lib/community/store storedProof), or null.

import { EARN_DEFAULT_USD, rankEarnRows, yieldLadder, type EarnRow } from '@/lib/earn'
import { callPath } from '@/lib/chart-calls'
import type { FeedPost } from '@/lib/community/spec'
import type { TourCommunityPost, TourEarnRow, TourQuote } from '@/lib/home-tour/types'

/** Hourly closes a first frame carries at most: the chart window's own length (lib/candles-server MAX_CANDLES, a week and a half of hours). */
export const TOUR_QUOTE_CLOSES = 180

/**
 * A market's hourly candles → the Charts miniature's first frame (round 3,
 * lane SIDES-A). The same three numbers the candles route answers with
 * (app/api/charts/candles: the window's closes, `last` = the newest close,
 * the route's own 24-hour change), so the server's first paint and the
 * browser's first read say the same thing. Closes keep six significant
 * figures (the page carries them twice: the HTML and the payload). Fewer
 * than two real closes is NULL: the market is left out of the list and the
 * panel reads it in the browser, as before.
 */
export function tourQuoteOf(symbol: string, candles: readonly { c: number }[], changePct: number | null): TourQuote | null {
  const closes: number[] = []
  for (const c of candles.slice(-TOUR_QUOTE_CLOSES)) {
    if (c && typeof c.c === 'number' && Number.isFinite(c.c) && c.c > 0) closes.push(Number(c.c.toPrecision(6)))
  }
  if (!symbol || closes.length < 2) return null
  return {
    symbol,
    last: closes[closes.length - 1],
    changePct: changePct != null && Number.isFinite(changePct) ? Math.round(changePct * 10_000) / 10_000 : null,
    closes,
  }
}

/** Bars on the tour's ladder: the board's own ladder length. */
export const TOUR_EARN_ROWS = 8
/** Posts the community panel shows at most. */
export const TOUR_COMMUNITY_POSTS = 3
/** One live feed may take this long at render; past it the panel says less. */
export const TOUR_FEED_TIMEOUT_MS = 2_500
/** The window `postsWeek` counts. */
export const TOUR_WEEK_MS = 7 * 86_400_000

/**
 * The Earn board's rows → the tour's ladder. `rows` are the board's rows
 * (lib/earn rowsFromWire of GET /api/markets/earn, or the readers' rows
 * directly). Returns the ladder and `earnWays` = how many rows the board
 * itself counts ("N WAYS TO EARN"), null when nothing was read.
 */
export function tourEarnOf(rows: readonly EarnRow[], usd: number = EARN_DEFAULT_USD): { earn: TourEarnRow[]; earnWays: number | null } {
  if (!rows.length) return { earn: [], earnWays: null }
  const ranked = rankEarnRows(rows)
  const earn: TourEarnRow[] = []
  for (const r of yieldLadder(ranked, TOUR_EARN_ROWS)) {
    if (r.apyPct == null || !Number.isFinite(r.apyPct)) continue
    let ask: string | null = null
    try {
      ask = r.askFor(usd)
    } catch {
      ask = null
    }
    if (!ask) continue
    earn.push({ asset: r.asset, venue: r.venueLabel, chain: r.chainLabel, apy: Math.round(r.apyPct * 100) / 100, ask })
  }
  return { earn, earnWays: ranked.length }
}

/** The chain-confirmed dollars of a post, or null (an idea, a link, a video,
 *  a trade with no parsed proof, a proof whose author hid the size). */
export function movedUsdOf(post: Pick<FeedPost, 'kind' | 'proof'>): number | null {
  if (post.kind !== 'trade') return null
  const p = post.proof
  if (!p || p.verification !== 'verified') return null
  const n = p.sizeUsd
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * The feed's first page → the tour's latest posts. `posts` arrive in the
 * feed's own order (hot); `publicRooms` = the slugs of rooms that are not
 * internal (a post in any other room is dropped; a post in no room — the
 * symbol forum — stands on its own row's fence).
 */
export function tourPostsOf(posts: readonly FeedPost[], publicRooms: ReadonlySet<string>, n: number = TOUR_COMMUNITY_POSTS): TourCommunityPost[] {
  const out: TourCommunityPost[] = []
  for (const p of posts) {
    if (out.length >= n) break
    if (!p || p.isInternal !== false) continue
    if (typeof p.id !== 'string' || !/^[a-z0-9]{6,16}$/.test(p.id)) continue
    if (p.community && !publicRooms.has(p.community.slug)) continue
    const title = typeof p.title === 'string' ? p.title.trim() : ''
    if (!title) continue
    out.push({
      kind: p.kind,
      title: title.slice(0, 140),
      symbol: p.symbol ? p.symbol : null,
      room: p.community ? p.community.name : null,
      movedUsd: movedUsdOf(p),
      score: Number.isFinite(p.score) ? Math.trunc(p.score) : 0,
      at: p.createdAt,
      href: callPath(p.id),
    })
  }
  return out
}

/** A promise that settles to `fallback` after `ms` or on a throw. Never rejects. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      () => {
        clearTimeout(id)
        resolve(fallback)
      },
    )
  })
}
