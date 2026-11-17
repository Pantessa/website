// GET /api/home/tour — THE TOUR's snapshot as JSON (squad landing, lane DATA,
// 2026-11-10): the same object `/` reads at render (lib/home-tour-server
// readTourSnapshotForRender — counts and fees from the registries, the Earn
// board's ladder, the community's public line), for a panel that refreshes
// while it is on screen. Public, no wallet, no address. Every read behind it
// is cached for a minute and fail-soft, so this never 500s: a feed that did
// not answer is an empty list or a null count.
import { NextResponse } from 'next/server'
import { readTourSnapshotForRender } from '@/lib/home-tour-server'

export const dynamic = 'force-dynamic'

const TOUR_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300'

export async function GET() {
  const snapshot = await readTourSnapshotForRender()
  return NextResponse.json(snapshot, { headers: { 'cache-control': TOUR_CACHE_CONTROL } })
}
