import type { Metadata } from 'next'
import { chartPairFor, normalizeChartSymbol } from '@/lib/charts'
import Footer from '@/components/Footer'
import TokenPageView from '@/components/TokenPageView'

// /t/<symbol> — the shareable token chart page. The same CandleChart the
// in-chat overlay uses, standalone: live candles, timeframes, and
// trade-in-chat CTAs that PREFILL the composer (never auto-send). Symbols
// without a candle source still get an honest page — the token can be
// tradable in chat without being chartable yet (Robinhood stocks, stables).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ symbol: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params
  const norm = normalizeChartSymbol(symbol)
  const pair = chartPairFor(norm)
  const title = pair ? `${pair.label} live chart — Yeetful` : `${norm || 'Token'} — Yeetful`
  const description = pair
    ? `Live ${pair.label} candles, and one sentence to act on it — swap, DCA, or protect, signed only by your wallet.`
    : `Trade ${norm} from one sentence in chat — guarded, signed only by your wallet.`
  return { title, description, openGraph: { title, description } }
}

export default async function TokenPage({ params }: Params) {
  const { symbol } = await params
  const norm = normalizeChartSymbol(symbol)
  return (
    <>
      <main className="x-main">
        <TokenPageView symbol={norm} />
      </main>
      <Footer />
    </>
  )
}
