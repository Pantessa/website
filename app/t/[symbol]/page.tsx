import type { Metadata } from 'next'
import { CHART_TFS, normalizeChartSymbol, type ChartTf } from '@/lib/charts'
import { parseMarketTab } from '@/lib/markets'
import { symbolPageSeo } from '@/lib/markets-seo'
import Footer from '@/components/Footer'
import SymbolPage from '@/components/markets/shell/SymbolPage'
import MarketsShell from '@/components/markets/shell/MarketsShell'

// /t/<symbol> — THE symbol page (Markets, 2026-09-11): header, the live
// chart, the tab strip (Overview · News · Community · Technicals · Trade)
// and the right rail. The chart engine sits behind
// components/markets/chart/ChartMount. Symbols without a candle source
// still get an honest page — the token can be tradable in chat without
// being chartable yet (stables, feedless listings).
//
// SEO (MARKETS/MSG): every chartable symbol is a front door. Title,
// description, canonical (aliases collapse — /t/weth canonicalizes to
// /t/ETH), the Dataset + breadcrumb JSON-LD and the per-symbol OG card all
// read lib/markets-seo, so a symbol is indexed iff chartPairFor accepts it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ symbol: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params
  const seo = symbolPageSeo(symbol)
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonical },
    // Chartless symbols are honest pages, not index fodder.
    robots: seo.pair ? undefined : { index: false, follow: true },
    openGraph: { title: seo.title, description: seo.description, url: seo.canonical, type: 'website' },
    twitter: { card: 'summary_large_image', title: seo.title, description: seo.description },
  }
}

export default async function TokenPage({ params, searchParams }: Params) {
  const { symbol } = await params
  const sp = await searchParams
  const norm = normalizeChartSymbol(symbol)
  const seo = symbolPageSeo(norm)
  // ?tab= and ?tf= are deep links (every gauge is a link target): the server
  // renders the addressed tab so the HTML matches the URL — the client then
  // owns the switch (replaceState, the #705 idiom). Unknown values → default.
  const tabRaw = typeof sp.tab === 'string' ? sp.tab : ''
  const initialTab = parseMarketTab(tabRaw ? `?tab=${encodeURIComponent(tabRaw)}` : '')
  const tfRaw = typeof sp.tf === 'string' ? sp.tf : ''
  const initialTf = CHART_TFS.some((t) => t.key === tfRaw) ? (tfRaw as ChartTf) : undefined
  // The /markets frame (no .x-main) inside the markets shell (the app spine
  // on the left, no brochure nav): SymbolPage's <main class="sym"> and the
  // side column (ask + account strip over the watchlist rail) are its two
  // columns, and the footer sits under the page in the left column, so the
  // rail stays docked through the last footer line.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: seo.jsonLd }} />
      <MarketsShell sym>
        <SymbolPage symbol={norm} initialTab={initialTab} initialTf={initialTf} />
        <div className="mkt-frame__foot">
          <Footer />
        </div>
      </MarketsShell>
    </>
  )
}
