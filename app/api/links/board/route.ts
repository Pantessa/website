import { NextRequest, NextResponse } from 'next/server'
import { creatorPages, linksBoard, liveHouseLinks } from '@/lib/links-board'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The /links page data — board + house links + creator pages — as JSON, for
 * the chat surface's in-app LINKS view (LinksWorkspace renders the same
 * LinksBoardView the public route serves). Public by design: this is
 * exactly what /links already shows any stranger — server-truth figures,
 * asks only, never a creator's wallet.
 */

/** 60s single-slice cache (the mosaic read-route precedent): the board is
 *  global (no per-user shape), and rail-tab flapping must not turn into a
 *  groupBy storm on embed_turns. Process-local; staleness of a minute is
 *  invisible on a leaderboard. */
const TTL_MS = 60_000
let cached: { at: number; body: unknown } | null = null

export async function GET(req: NextRequest) {
  // fresh=1 (the in-app mint moment) recomputes past the cache — a creator
  // who just minted must see their link on Recently minted, not in 60s.
  const fresh = req.nextUrl.searchParams.get('fresh') === '1'
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body)
  }
  const board = await linksBoard()
  const onBoard = new Set([...board.byClaims, ...board.byMoved].map((r) => r.slug))
  const [house, pages] = await Promise.all([liveHouseLinks(onBoard), creatorPages()])
  const body = { board, house, pages }
  cached = { at: Date.now(), body }
  return NextResponse.json(body)
}
