// GET /api/markets/fundamentals?symbol=UNI — the Technicals tab's
// "Fundamentals" panel: the DefiLlama series (TVL, fees, revenue, holders
// revenue, DEX volume) for the protocol or chain a crypto symbol maps to.
// Public, no wallet. Keyless upstream (api.llama.fi), attribution rendered
// by the panel. lib/defillama-read caches ten minutes per symbol; this route
// never 500s — a symbol with no DefiLlama page answers `subject: null` with
// a reason, and an upstream outage answers a named error at 200 so the
// panel can say so and retry.
import { NextRequest, NextResponse } from 'next/server'
import { normalizeLlamaSymbol } from '@/lib/defillama'
import { readLlamaFundamentals } from '@/lib/defillama-read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = { 'cache-control': 'public, max-age=120, stale-while-revalidate=600' }

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('symbol') ?? ''
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(raw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  const symbol = normalizeLlamaSymbol(raw)
  try {
    const body = await readLlamaFundamentals(symbol)
    return NextResponse.json(body, { headers: HEADERS })
  } catch (e) {
    return NextResponse.json({ symbol, subject: null, reason: 'DefiLlama did not answer. Try again in a moment.', error: e instanceof Error ? e.message.slice(0, 160) : 'read failed', retry: true }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
