import type { Metadata } from 'next'
import { normalizeChartSymbol } from '@/lib/charts'
import { symbolPageSeo } from '@/lib/markets-seo'
import Footer from '@/components/Footer'
import TokenPageView from '@/components/TokenPageView'

// /t/<symbol> — the shareable token chart page. The same CandleChart the
// in-chat overlay uses, standalone: live candles, timeframes, and
// trade-in-chat CTAs that PREFILL the composer (never auto-send). Symbols
// without a candle source still get an honest page — the token can be
// tradable in chat without being chartable yet (stables).
//
// SEO (MARKETS/MSG, 2026-09-11): every chartable symbol is a front door.
// Title, description, canonical (aliases collapse — /t/weth canonicalizes to
// /t/ETH), the Dataset + breadcrumb JSON-LD and the per-symbol OG card all
// read lib/markets-seo, so a symbol is indexed iff chartPairFor accepts it.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ symbol: string }> }

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

export default async function TokenPage({ params }: Params) {
  const { symbol } = await params
  const norm = normalizeChartSymbol(symbol)
  const seo = symbolPageSeo(norm)
  // No .x-main here on purpose: the chart page is full-bleed, so the shell
  // owns the viewport and the footer sits just below the fold.
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: seo.jsonLd }} />
      <main>
        <TokenPageView symbol={norm} />
      </main>
      <Footer />
    </>
  )
}
