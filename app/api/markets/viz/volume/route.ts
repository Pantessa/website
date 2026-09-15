import { NextResponse } from 'next/server'
import { readVolumes } from '@/lib/viz/volume'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/viz/volume — 24h dollar volume for every charted symbol
// (VIZ lane; the MarketMap's cell size). 120s cache; a feed miss leaves the
// symbol ABSENT, never 0. Public, keyless, market data. Never 500s.
export async function GET() {
  try {
    const body = await readVolumes()
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.warn(`[viz/volume] reader threw: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ volumes: {}, feeds: {}, asOf: Date.now(), error: 'reader unavailable' }, { headers: { 'cache-control': 'no-store' } })
  }
}
