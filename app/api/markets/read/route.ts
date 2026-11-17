import { NextRequest, NextResponse } from 'next/server'
import { readSeries, readSnapshot } from '@/lib/read-server'
import { parseReadId, parseReadRange } from '@/lib/read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/read — THE READ's data (lib/read, 2026-11-09).
//
//   (no params)          the snapshot: nine instruments' last, change and
//                        today's series, plus the household movers — the
//                        object `/` rendered its headline from.
//   ?id=<id>&range=<r>   one instrument's series for a longer range
//                        (1w · 1m · 6m; 1d answers too).
//
// Public market data: keyless, no auth, no wallet, nothing written. NEVER a
// 500 — a feed that did not answer is an absent quote / an empty series, and
// a bad parameter is a 400 by name. Short shared caching (the snapshot is at
// most 30s old in the process already), so a crawl cannot multiply upstream
// reads.
const SNAPSHOT_CACHE = 'public, max-age=0, s-maxage=20, stale-while-revalidate=60'
const SERIES_CACHE = 'public, max-age=0, s-maxage=120, stale-while-revalidate=600'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const idRaw = sp.get('id')
  if (idRaw === null) {
    const snapshot = await readSnapshot()
    return NextResponse.json(snapshot, { headers: { 'cache-control': SNAPSHOT_CACHE } })
  }
  const id = parseReadId(idRaw)
  const range = parseReadRange(sp.get('range') ?? '1d')
  if (!id) return NextResponse.json({ error: 'unknown id' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  if (!range) return NextResponse.json({ error: 'unknown range' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  const points = await readSeries(id, range)
  return NextResponse.json({ id, range, points }, { headers: { 'cache-control': points.length ? SERIES_CACHE : 'no-store' } })
}
