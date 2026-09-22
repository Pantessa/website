import { NextRequest, NextResponse } from 'next/server'
import { readTradability } from '@/lib/tradability-store'
import type { SymbolTradability } from '@/lib/tradability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/tradable?symbols=AMBA,ETH — which sides a venue can
// actually fill, as measured by the cascade itself (lib/venue-preflight,
// cached: lib/tradability-store). Public: nothing here is about a wallet,
// it is about a market. No `symbols` returns the whole measured board.
//
// A symbol absent from the answer has not been measured, which every caller
// treats as "offer it" (lib/tradability canFill). This route never decides
// anything — the rule is pure and lives with the callers.

const MAX_SYMBOLS = 400

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('symbols') ?? '').trim()
  const want = raw
    ? raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9$._-]{1,16}$/.test(s)).slice(0, MAX_SYMBOLS)
    : null
  const all = await readTradability()
  const map: Record<string, SymbolTradability> = {}
  if (want) {
    for (const s of want) if (all[s]) map[s] = all[s]
  } else {
    Object.assign(map, all)
  }
  return NextResponse.json(
    { map, updatedAt: new Date().toISOString() },
    { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } },
  )
}
