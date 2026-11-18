import { NextRequest, NextResponse, after } from 'next/server'
import { getNews, NEWS_LIMIT_DEFAULT } from '@/lib/news'
import { normalizeChartSymbol } from '@/lib/charts'

// GET /api/news?symbol=AAPL&limit=20 — headlines for a CHARTED symbol, read
// from the news index (lib/news.ts: a dozen publishers' feeds, stored in
// Postgres, filed by symbol). `feeds` and `sources` name what is on the page.
// A chartless symbol is refused by name (fail-closed, like the candles proxy)
// so the route can never be pointed at an arbitrary feed. Never 500s on a
// feed miss: nothing indexed is `{ items: [], feed: 'none' }`. A feed read
// still running when the page is served finishes after the response.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const symbol = normalizeChartSymbol(req.nextUrl.searchParams.get('symbol') ?? '')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? NEWS_LIMIT_DEFAULT)
  const news = await getNews(symbol, Number.isFinite(limit) ? limit : NEWS_LIMIT_DEFAULT, { defer: (work) => after(() => work) })
  if (!news) return NextResponse.json({ error: `No live chart for ${symbol}, so no news feed either.` }, { status: 400 })
  // A page served while its feeds were still being read is not one to keep (review F6).
  return NextResponse.json(news, { headers: { 'cache-control': news.partial ? 'public, max-age=5, s-maxage=10' : 'public, max-age=60, s-maxage=120' } })
}
