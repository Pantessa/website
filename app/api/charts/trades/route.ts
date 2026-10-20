import { NextRequest, NextResponse } from 'next/server'
import { resolveChartPair } from '@/lib/charts'
import { loadVenueTrades } from '@/lib/venue-trades'
import type { Print } from '@/lib/chart-live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The history of a print frame (10s): the chart venue's recent trades
// (lib/venue-trades). MarketChart reads it once on open and again every few
// seconds until Dune's first print takes over the live edge. The pair
// resolver is the gate: symbols outside lib/charts' map never reach a venue.

const NO_STORE = { 'cache-control': 'no-store' }
const CACHE_MS = 4_000
type Entry = { at: number; prints: Print[] }
const g = globalThis as typeof globalThis & { __venueTrades?: Map<string, Entry>; __venueTradesInflight?: Map<string, Promise<Print[]>> }
const cache = (g.__venueTrades ??= new Map())
const inflight = (g.__venueTradesInflight ??= new Map())

export async function GET(req: NextRequest) {
  const symbolRaw = req.nextUrl.searchParams.get('symbol') ?? ''
  if (!/^[A-Za-z0-9$._:-]{1,24}$/.test(symbolRaw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400, headers: NO_STORE })
  const pair = await resolveChartPair(symbolRaw)
  if (!pair) return NextResponse.json({ symbol: symbolRaw.toUpperCase(), prints: [], error: 'no chart for this symbol' }, { status: 404, headers: NO_STORE })
  if (pair.source === 'robinhood') return NextResponse.json({ symbol: pair.symbol, source: pair.source, prints: [], error: 'a stock has no print frame' }, { status: 400, headers: NO_STORE })
  const key = `${pair.source}:${pair.pair}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json({ symbol: pair.symbol, source: pair.source, prints: hit.prints }, { headers: NO_STORE })
  try {
    let p = inflight.get(key)
    if (!p) {
      p = loadVenueTrades(pair).finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    const prints = await p
    cache.set(key, { at: Date.now(), prints })
    if (cache.size > 200) cache.delete(cache.keys().next().value as string)
    return NextResponse.json({ symbol: pair.symbol, source: pair.source, prints }, { headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ symbol: pair.symbol, source: pair.source, prints: hit?.prints ?? [], error: e instanceof Error ? e.message : 'trades unavailable' }, { status: 502, headers: NO_STORE })
  }
}
