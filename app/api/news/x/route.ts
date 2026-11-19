import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor, normalizeChartSymbol } from '@/lib/charts'
import { cashtagOf, listXPosts, xNewsConfig, xSearchLinks } from '@/lib/news-x'

// GET /api/news/x?symbol=BTC — the posts kept for a symbol's cashtag
// (lib/news-x.ts). A READ of what the cron already paid for: this route never
// asks X anything, so a page view (or a crawler) costs nothing. `links` are
// X's own search pages for the cashtag, offered whether or not we hold posts.
// A symbol with no cashtag (a look-only index) answers `cashtag: null`.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbol = normalizeChartSymbol(req.nextUrl.searchParams.get('symbol') ?? '')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  const pair = chartPairFor(symbol)
  if (!pair) return NextResponse.json({ error: `No live chart for ${symbol}, so no posts either.` }, { status: 400 })
  const cashtag = cashtagOf(pair)
  if (!cashtag) return NextResponse.json({ symbol: pair.symbol, cashtag: null, tracked: false, posts: [], asOf: null, links: null })
  const { posts, asOf } = await listXPosts(pair.symbol).catch(() => ({ posts: [], asOf: null }))
  return NextResponse.json(
    { symbol: pair.symbol, cashtag, tracked: xNewsConfig().symbols.includes(pair.symbol), posts, asOf, links: xSearchLinks(cashtag) },
    { headers: { 'cache-control': 'public, max-age=60, s-maxage=300' } },
  )
}
