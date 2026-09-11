import type { Metadata } from 'next'
import { chartPairFor, normalizeChartSymbol } from '@/lib/charts'
import Footer from '@/components/Footer'
import SymbolPage from '@/components/markets/shell/SymbolPage'

// /t/<symbol> — THE symbol page (Markets, 2026-09-11): header, the live
// chart, the tab strip (Overview · News · Community · Technicals · Trade)
// and the right rail. The same CandleChart the in-chat overlay uses sits
// behind components/markets/chart/ChartMount. Symbols without a candle
// source still get an honest page — the token can be tradable in chat
// without being chartable yet (stables, feedless listings).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ symbol: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params
  const norm = normalizeChartSymbol(symbol)
  const pair = chartPairFor(norm)
  const title = pair ? `${pair.label} live chart — Pantessa` : `${norm || 'Token'} — Pantessa`
  const description = pair
    ? `Live ${pair.label} candles, and one sentence to act on it — swap, DCA, or protect, signed only by your wallet.`
    : `Trade ${norm} from one sentence in chat — guarded, signed only by your wallet.`
  return { title, description, openGraph: { title, description } }
}

export default async function TokenPage({ params }: Params) {
  const { symbol } = await params
  const norm = normalizeChartSymbol(symbol)
  // No .x-main here on purpose: the symbol page owns its own gutters (the
  // chart wants the width; the tab grid and rail sit inside .sym).
  return (
    <>
      <main>
        <SymbolPage symbol={norm} />
      </main>
      <Footer />
    </>
  )
}
