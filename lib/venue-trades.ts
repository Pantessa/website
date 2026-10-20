// The venue's own recent trades: the HISTORY of a print frame (10s).
//
// A print frame's bars are built from executions, and Dune's relay only holds
// what it saw since its upstream opened (a cold serverless instance: nothing),
// so a 10s chart opened empty and waited minutes for a thin coin's prints —
// UNI printed 3 times in 45 s across Ethereum + Arbitrum, Base never (Dune's
// trial doesn't carry it). Nate, 2026-10-15: "draw using other data for the
// line parts but then start drawing with dune realtime data." The history is
// the chart venue's public trade tape; Dune takes over at its first print
// (lib/chart-live seedThenPrints).
//
//  · Coinbase Exchange `GET /products/<pair>/trades` — keyless, newest first,
//    1,000 a page, older pages by the `cb-after` cursor. 1,000 UNI trades
//    measured ≈ an hour; ETH needs a few pages for half an hour.
//  · Hyperliquid `recentTrades` — keyless, the last ~10 only (Dune's
//    HyperCore feed is dense, so the relay fills a perp's frame in seconds).
//  · A tokenized stock has no print frame (lib/charts tfsForSource).

import type { ChartPair } from '@/lib/charts'
import type { Print } from '@/lib/chart-live'

/** How far back the history reaches: the browser keeps half an hour of prints. */
export const VENUE_TRADES_SPAN_MS = 30 * 60_000
/** Coinbase pages a request may read before it settles for less than the span. */
export const COINBASE_TRADE_PAGES = 4
const TIMEOUT_MS = 6_000

/** One Coinbase Exchange trade row → a print (null when it isn't one). */
export function printFromCoinbase(row: unknown): Print | null {
  if (!row || typeof row !== 'object') return null
  const r = row as { price?: unknown; size?: unknown; time?: unknown; side?: unknown }
  const price = Number(r.price)
  const size = Number(r.size)
  const at = typeof r.time === 'string' ? Date.parse(r.time) : NaN
  if (!(price > 0) || !Number.isFinite(at)) return null
  // Coinbase Exchange names the MAKER's side; the taker took the other one.
  const side = r.side === 'sell' ? 'buy' : r.side === 'buy' ? 'sell' : undefined
  return { at, price, size: Number.isFinite(size) && size > 0 ? size : 0, ...(side ? { side } : {}) }
}

/** One Hyperliquid `recentTrades` row → a print. */
export function printFromHl(row: unknown): Print | null {
  if (!row || typeof row !== 'object') return null
  const r = row as { px?: unknown; sz?: unknown; time?: unknown; side?: unknown }
  const price = Number(r.px)
  const size = Number(r.sz)
  const at = Number(r.time)
  if (!(price > 0) || !Number.isFinite(at) || at <= 0) return null
  // Hyperliquid names the aggressor: B bought, A sold.
  const side = r.side === 'B' ? 'buy' : r.side === 'A' ? 'sell' : undefined
  return { at, price, size: Number.isFinite(size) && size > 0 ? size : 0, ...(side ? { side } : {}) }
}

/** Oldest first, inside the span, no future stamps. */
export function trimPrints(prints: readonly Print[], now: number, spanMs = VENUE_TRADES_SPAN_MS): Print[] {
  return prints.filter((p) => p.at >= now - spanMs && p.at <= now + 5_000).sort((a, b) => a.at - b.at)
}

async function get(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', headers: { 'user-agent': 'pantessa', ...(init?.headers ?? {}) } })
  } finally {
    clearTimeout(timer)
  }
}

async function coinbaseTrades(product: string, now: number): Promise<Print[]> {
  const out: Print[] = []
  let after: string | null = null
  for (let page = 0; page < COINBASE_TRADE_PAGES; page++) {
    const res = await get(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/trades?limit=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    if (!res.ok) {
      if (page === 0) throw new Error(`coinbase trades ${res.status}`)
      break
    }
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const row of rows) {
      const p = printFromCoinbase(row)
      if (p) out.push(p)
    }
    const oldest = out.reduce((m, p) => Math.min(m, p.at), Infinity)
    after = res.headers.get('cb-after')
    if (!after || oldest <= now - VENUE_TRADES_SPAN_MS) break
  }
  return out
}

async function hlTrades(coin: string): Promise<Print[]> {
  const res = await get('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'recentTrades', coin }) })
  if (!res.ok) throw new Error(`hyperliquid trades ${res.status}`)
  const rows = (await res.json()) as unknown
  return Array.isArray(rows) ? rows.map(printFromHl).filter((p): p is Print => p !== null) : []
}

/** The pair's recent trades, oldest first, within the span. */
export async function loadVenueTrades(pair: ChartPair, now = Date.now()): Promise<Print[]> {
  if (pair.source === 'coinbase') return trimPrints(await coinbaseTrades(pair.pair, now), now)
  if (pair.source === 'hyperliquid') return trimPrints(await hlTrades(pair.pair), now)
  return []
}
