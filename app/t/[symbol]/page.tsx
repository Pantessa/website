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

type Params = { params: Promise<{ symbol: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

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

export default async function TokenPage({ params, searchParams }: Params) {
  const { symbol } = await params
  const sp = await searchParams
  const norm = normalizeChartSymbol(symbol)
  // ?tab=technicals opens the ratings view (deep-linkable — every gauge is a
  // link target); ?tf= picks its frame. Anything else is the chart.
  const tab = sp.tab === 'technicals' ? 'technicals' : 'chart'
  const tfRaw = typeof sp.tf === 'string' ? sp.tf : undefined
  // No .x-main here on purpose: the chart page is full-bleed, so the shell
  // owns the viewport and the footer sits just below the fold.
  return (
    <>
      <main>
        <TokenPageView symbol={norm} tab={tab} tf={tfRaw} />
      </main>
      <Footer />
    </>
  )
}
