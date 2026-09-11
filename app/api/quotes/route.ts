import { NextRequest, NextResponse } from 'next/server'
import { cleanQuoteSymbols, readQuotes, QUOTES_MAX_SYMBOLS } from '@/lib/quotes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/quotes?symbols=AAPL,ETH,HYPE — the README "Quotes" contract
// (MARKETS/WATCH owns it). Batched per request, cached per symbol ≤15s in
// lib/quotes, NEVER 500 on a feed miss: a symbol with no quote is omitted
// from `quotes` and listed in `missing`; junk that doesn't even normalize
// is listed in `junk`. Public, keyless, no auth — it is market data.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbols') ?? ''
  const { symbols, junk } = cleanQuoteSymbols(raw.split(',').map((s) => s.trim()).filter(Boolean))
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: {}, missing: [], junk, max: QUOTES_MAX_SYMBOLS }, { headers: { 'cache-control': 'no-store' } })
  }
  try {
    const { quotes, missing } = await readQuotes(symbols)
    return NextResponse.json({ quotes, missing, junk, asOf: Date.now() }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    // The reader already swallows per-feed failures; this is the belt.
    console.warn(`[quotes] reader threw: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ quotes: {}, missing: symbols, junk, asOf: Date.now() }, { headers: { 'cache-control': 'no-store' } })
  }
}
