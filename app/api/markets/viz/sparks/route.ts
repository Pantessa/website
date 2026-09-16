import { NextRequest, NextResponse } from 'next/server'
import { cleanSparkSymbols, readSparks, SPARKS_MAX_SYMBOLS } from '@/lib/viz/sparks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/viz/sparks?symbols=AAPL,ETH,HYPE — the last 8 daily closes
// per symbol (VIZ lane; the index's Sparkline column + the movers tape).
// Batched ≤60 per request, 10-min server cache, a feed miss lists the symbol
// in `missing` (never a flat array). Public, keyless, market data. Never 500s.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbols') ?? ''
  const { symbols, junk } = cleanSparkSymbols(raw.split(',').map((s) => s.trim()).filter(Boolean))
  if (symbols.length === 0) {
    return NextResponse.json({ sparks: {}, missing: [], junk, max: SPARKS_MAX_SYMBOLS }, { headers: { 'cache-control': 'no-store' } })
  }
  try {
    const body = await readSparks(symbols)
    return NextResponse.json({ ...body, junk, max: SPARKS_MAX_SYMBOLS }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.warn(`[viz/sparks] reader threw: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ sparks: {}, missing: symbols, junk, max: SPARKS_MAX_SYMBOLS, error: 'reader unavailable' }, { headers: { 'cache-control': 'no-store' } })
  }
}
