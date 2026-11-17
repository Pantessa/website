import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor, resolveChartPair } from '@/lib/charts'
import { cleanSparkSymbols, readSparks, SPARKS_MAX_SYMBOLS } from '@/lib/viz/sparks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/viz/sparks?symbols=AAPL,ETH,HYPE — the last 8 daily closes
// per symbol (VIZ lane; the index's Sparkline column + the movers tape).
// Batched ≤60 per request, 10-min server cache, a feed miss lists the symbol
// in `missing` (never a flat array). Public, keyless, market data. Never 500s.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbols') ?? ''
  const asked = raw.split(',').map((s) => s.trim()).filter(Boolean)
  // A symbol the static table does not know may be a market the venue lists
  // (the Macro board's Hyperliquid rows — SP500, GOLD, CL… — on a cold
  // process): warm the live pair table once before calling it junk
  // (lib/charts resolveChartPair; cached 10 min, no read when fresh).
  const cold = asked.slice(0, SPARKS_MAX_SYMBOLS).find((s) => /^[A-Za-z0-9$._-]{1,16}$/.test(s) && !chartPairFor(s))
  if (cold) await resolveChartPair(cold).catch(() => null)
  const { symbols, junk } = cleanSparkSymbols(asked)
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
