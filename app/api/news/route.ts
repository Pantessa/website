import { NextRequest, NextResponse } from 'next/server'
import { getNews, NEWS_LIMIT_DEFAULT } from '@/lib/news'
import { normalizeChartSymbol } from '@/lib/charts'

// GET /api/news?symbol=AAPL&limit=20 — headlines for a CHARTED symbol from
// the keyless ladder in lib/news.ts (Nasdaq / Cointelegraph / Google News),
// cached 5 min per symbol, `feed` naming what actually served. A chartless
// symbol is refused by name (fail-closed, like the candles proxy) so the
// route can never be pointed at an arbitrary feed. Never 500s on a feed
// miss: an empty ladder is `{ items: [], feed: 'none' }`.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbol = normalizeChartSymbol(req.nextUrl.searchParams.get('symbol') ?? '')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? NEWS_LIMIT_DEFAULT)
  const news = await getNews(symbol, Number.isFinite(limit) ? limit : NEWS_LIMIT_DEFAULT)
  if (!news) return NextResponse.json({ error: `No live chart for ${symbol}, so no news feed either.` }, { status: 400 })
  return NextResponse.json(news, { headers: { 'cache-control': 'public, max-age=60, s-maxage=120' } })
}
