// GET /api/markets/spot-book?symbol=UNI — the battlefield's SPOT board:
// Coinbase Exchange's aggregated order book for the coin's USD product
// (public `book?level=2`, every resting price, keyless). 15s cache per
// product, never a 500: a symbol Coinbase doesn't list answers empty sides
// with `missing` set.
import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor } from '@/lib/charts'
import type { BookBody } from '@/lib/derivs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 15_000
/** The board draws ±10%; the book is cut there so a BTC book stays small on the wire. */
const KEEP_PCT = 12
const cache = new Map<string, { at: number; body: BookBody }>()

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbol') ?? ''
  if (!/^[A-Za-z0-9]{1,12}$/.test(raw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  const pair = chartPairFor(raw)
  if (!pair) return NextResponse.json({ error: 'no chart for that symbol' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  const product = pair.source === 'coinbase' ? pair.pair : `${pair.symbol}-USD`
  const hit = cache.get(product)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, { headers: { 'cache-control': 'public, max-age=10' } })
  let body: BookBody = { symbol: pair.symbol, bids: [], asks: [], mid: null, at: Date.now(), missing: 'Coinbase' }
  try {
    const res = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/book?level=2`, { headers: { accept: 'application/json', 'user-agent': 'pantessa-markets' }, signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (res.ok) {
      const d = (await res.json()) as { bids?: [string, string, unknown][]; asks?: [string, string, unknown][] }
      const side = (rows: [string, string, unknown][] | undefined) => (rows ?? []).map((r) => ({ px: Number(r[0]), usd: Number(r[0]) * Number(r[1]) })).filter((l) => l.px > 0 && l.usd > 0)
      const bids = side(d.bids)
      const asks = side(d.asks)
      if (bids.length && asks.length) {
        const mid = (bids[0].px + asks[0].px) / 2
        body = { symbol: pair.symbol, bids: bids.filter((l) => l.px >= mid * (1 - KEEP_PCT / 100)), asks: asks.filter((l) => l.px <= mid * (1 + KEEP_PCT / 100)), mid, at: Date.now() }
      }
    }
  } catch {
    /* no book this read */
  }
  cache.set(product, { at: Date.now(), body })
  return NextResponse.json(body, { headers: { 'cache-control': body.missing ? 'no-store' : 'public, max-age=10' } })
}
