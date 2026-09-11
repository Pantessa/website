import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor } from '@/lib/charts'
import { poolPriceFor } from '@/lib/pool-price'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pool-price honesty for the chart: what $100 of USDG buys in the Robinhood
// Chain pool RIGHT NOW, next to the tape the candles draw. Only stock
// symbols (source 'robinhood') ever reach the quoters — every other symbol
// gets `pool: null` with the reason, and a quote miss is `pool: null` too.
// Never a 500: a dotted line that can't be drawn is simply not drawn.

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  }
  const pair = chartPairFor(symbolRaw)
  const headers = { 'cache-control': 'no-store' }
  if (!pair) return NextResponse.json({ symbol: symbolRaw.toUpperCase(), pool: null, reason: 'no chart source' }, { headers })
  if (pair.source !== 'robinhood') {
    return NextResponse.json({ symbol: pair.symbol, pool: null, reason: 'not a Robinhood Chain listing' }, { headers })
  }
  const pool = await poolPriceFor(pair.symbol)
  return NextResponse.json(pool ? { symbol: pair.symbol, pool } : { symbol: pair.symbol, pool: null, reason: 'quote unavailable' }, { headers })
}
