// GET /api/markets/derivs?symbol=UNI&tf=1d — the battlefield's positioning
// read (lib/derivs): long/short account share, open interest history and
// funding for the symbol's USDT perpetual, and Hyperliquid's own book.
// Public, no wallet, keyless upstreams (lib/derivs-read names the exchange
// in `source` and every reader that did not answer in `missing`). Never a
// 500: a symbol with no perpetual answers empty series and the field draws
// without them. Tokenized stocks have no perpetual and are refused by name.
import { NextRequest, NextResponse } from 'next/server'
import { CHART_TFS, chartPairFor, type ChartTf } from '@/lib/charts'
import { readDerivs } from '@/lib/derivs-read'
import type { DerivsBody } from '@/lib/derivs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'cache-control': 'public, max-age=30, stale-while-revalidate=120' }
const empty = (symbol: string, tf: string, missing: string[]): DerivsBody => ({ symbol, tf, source: null, oiUnit: 'coin', oi: [], ratio: [], funding8h: null, hl: null, missing })

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbol') ?? ''
  const tf = (req.nextUrl.searchParams.get('tf') ?? '1d') as ChartTf
  if (!/^[A-Za-z0-9]{1,12}$/.test(raw) || !CHART_TFS.some((t) => t.key === tf)) return NextResponse.json({ error: 'bad symbol or tf' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  const pair = chartPairFor(raw)
  if (!pair) return NextResponse.json({ error: 'no chart for that symbol' }, { status: 404, headers: { 'cache-control': 'no-store' } })
  if (pair.source === 'robinhood') return NextResponse.json({ ...empty(pair.symbol, tf, []), reason: 'A tokenized stock has no perpetual market to read.' }, { headers: HEADERS })
  try {
    return NextResponse.json(await readDerivs(pair.symbol, tf), { headers: HEADERS })
  } catch {
    return NextResponse.json(empty(pair.symbol, tf, ['Bybit', 'Binance', 'OKX', 'Hyperliquid']), { headers: { 'cache-control': 'no-store' } })
  }
}
