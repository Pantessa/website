// GET /api/markets/book?symbol=UNI — the battlefield's ramparts: Hyperliquid's
// resting order book for the coin (keyless `l2Book`, 3 significant figures:
// twenty price rungs a side, about ±2% of the mid). Public, no wallet, 5s
// cache per coin, never a 500: a coin Hyperliquid does not list answers empty
// sides with `missing` set, and the field draws no walls.
import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor } from '@/lib/charts'
import type { BookBody } from '@/lib/derivs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 5_000
const cache = new Map<string, { at: number; body: BookBody }>()

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbol') ?? ''
  if (!/^[A-Za-z0-9]{1,12}$/.test(raw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  const pair = chartPairFor(raw)
  if (!pair) return NextResponse.json({ error: 'no chart for that symbol' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  const coin = pair.source === 'hyperliquid' ? pair.pair : pair.symbol
  const hit = cache.get(coin)
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, { headers: { 'cache-control': 'public, max-age=5' } })
  let body: BookBody = { symbol: pair.symbol, bids: [], asks: [], mid: null, at: Date.now(), missing: 'Hyperliquid' }
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin, nSigFigs: 3 }), signal: AbortSignal.timeout(6_000), cache: 'no-store' })
    if (res.ok) {
      const d = (await res.json()) as { levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] }
      const side = (rows: { px: string; sz: string }[] | undefined) => (rows ?? []).map((r) => ({ px: Number(r.px), usd: Number(r.px) * Number(r.sz) })).filter((l) => l.px > 0 && l.usd > 0)
      const bids = side(d.levels?.[0])
      const asks = side(d.levels?.[1])
      if (bids.length && asks.length) body = { symbol: pair.symbol, bids, asks, mid: (bids[0].px + asks[0].px) / 2, at: Date.now() }
    }
  } catch {
    /* no walls this read */
  }
  cache.set(coin, { at: Date.now(), body })
  return NextResponse.json(body, { headers: { 'cache-control': body.missing ? 'no-store' : 'public, max-age=5' } })
}
