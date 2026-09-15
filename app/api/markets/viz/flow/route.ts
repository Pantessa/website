import { NextRequest, NextResponse } from 'next/server'
import { readFlow, isIndexSymbol } from '@/lib/viz/flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/viz/flow?symbol=ETH — where a symbol's money lives across
// dapps (VIZ lane). 60s cache per symbol; every source fail-soft: a source
// that can't be read comes back with usd:null + gap, NEVER a zero. Public,
// keyless, market data. Never 500s: a thrown reader → an all-gaps body.
// 404 for a symbol the index doesn't list; the cache is bounded (FLOW_CACHE_MAX).
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase()
  if (!symbol || !/^[A-Z0-9.$-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  // Only the index's own symbols reach the readers (QA-1): an unknown ticker
  // is a 404, never a fan-out of RPC reads on a stranger's string.
  if (!isIndexSymbol(symbol)) {
    return NextResponse.json({ error: 'unknown symbol' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  }
  try {
    const body = await readFlow(symbol)
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.warn(`[viz/flow] reader threw for ${symbol}: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ symbol, sources: [], asOf: Date.now(), error: 'reader unavailable' }, { headers: { 'cache-control': 'no-store' } })
  }
}
