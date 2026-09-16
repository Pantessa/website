import { NextRequest, NextResponse } from 'next/server'
import { readFills } from '@/lib/viz/fills'
import { isIndexSymbol } from '@/lib/viz/flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// GET /api/markets/viz/fills?symbol=ETH&address=0x… — the wallet's own SIGNED
// executions on a symbol (VIZ lane): markers the chart draws on their bars.
// Public by address like /api/wallet (signed turns are on-chain public data;
// nothing here spends or signs). Internal/harness rows are fenced out. 60s
// cache per symbol+address (bounded). 400 on a bad address, 404 for a symbol
// the index doesn't list, never 500 (a reader failure → an empty list + error).
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase()
  const address = (req.nextUrl.searchParams.get('address') ?? '').trim()
  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  if (!symbol || !isIndexSymbol(symbol)) {
    return NextResponse.json({ error: 'unknown symbol' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  }
  try {
    const body = await readFills(symbol, address)
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.warn(`[viz/fills] reader threw for ${symbol}: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ symbol, address: address.toLowerCase(), fills: [], asOf: Date.now(), error: 'reader unavailable' }, { headers: { 'cache-control': 'no-store' } })
  }
}
