// The Depth view's book, read on the server for the share card
// (app/api/og/depth). The same books the chart draws in the browser
// (lib/depth-feed): Coinbase's full level-2 spot book for a Coinbase coin,
// Hyperliquid's l2Book at 3 significant figures for a perp (the coarse, wide
// picture the chart asks for, so the card and the screen agree). Keyless,
// never throws: a venue that does not answer is `null`, and the card falls
// back to the symbol's own card. 10s cache per book.

import { resolveChartPair, type ChartPair } from './charts'
import { bookFromLevels, depthPlanFor, type DepthBook, type DepthVenue } from './depth'
import { bookProductFor } from './depth-feed'

const TTL_MS = 10_000
const cache = new Map<string, { at: number; book: DepthBook | null }>()

export interface ServerDepthBook {
  pair: ChartPair
  venue: DepthVenue
  book: DepthBook
}

async function coinbaseBook(product: string): Promise<DepthBook | null> {
  const res = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/book?level=2`, {
    headers: { accept: 'application/json', 'user-agent': 'pantessa-markets' },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const d = (await res.json()) as { bids?: [string, string, unknown][]; asks?: [string, string, unknown][] }
  const side = (rows: [string, string, unknown][] | undefined) => (rows ?? []).map((r) => ({ px: Number(r[0]), size: Number(r[1]) }))
  return bookFromLevels(side(d.bids), side(d.asks), Date.now())
}

async function hyperliquidBook(coin: string): Promise<DepthBook | null> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'l2Book', coin, nSigFigs: 3 }),
    signal: AbortSignal.timeout(6_000),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const d = (await res.json()) as { levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] }
  const side = (rows: { px: string; sz: string }[] | undefined) => (rows ?? []).map((r) => ({ px: Number(r.px), size: Number(r.sz) }))
  return bookFromLevels(side(d.levels?.[0]), side(d.levels?.[1]), Date.now())
}

/** The book the Depth view draws for this symbol, or null (no book, no answer). */
export async function readServerDepthBook(symbol: string): Promise<ServerDepthBook | null> {
  const pair = await resolveChartPair(symbol)
  if (!pair) return null
  const venue = depthPlanFor(pair, false).main
  if (!venue) return null
  const product = bookProductFor(venue, pair)
  const key = `${venue}:${product}`
  const hit = cache.get(key)
  let book: DepthBook | null
  if (hit && Date.now() - hit.at < TTL_MS) book = hit.book
  else {
    try {
      book = venue === 'coinbase' ? await coinbaseBook(product) : await hyperliquidBook(product)
    } catch {
      book = null
    }
    cache.set(key, { at: Date.now(), book })
  }
  if (!book || book.mid == null) return null
  return { pair, venue, book }
}
