import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CHART_TFS, HL_PERPS_HANDOFF_GLOBAL, chartSymbolByName, isLiveOnlyHlPair, liveHlPerpNames, normalizeChartSymbol, perpTwinOf, resolveChartPair, warmHlPerps, type ChartTf } from '@/lib/charts'
import { parseMarketTab, parseVsParam } from '@/lib/markets'
import { symbolPageSeo } from '@/lib/markets-seo'
import { depthPlanFor, parseDepthSettings } from '@/lib/depth'
import { depthCardMeta, depthOgPath } from '@/lib/depth-share'
import Footer from '@/components/Footer'
import SymbolPage from '@/components/markets/shell/SymbolPage'
import { readTradability } from '@/lib/tradability-store'
import MarketsShell from '@/components/markets/shell/MarketsShell'
import HlPerpsPrime from '@/components/markets/shell/HlPerpsPrime'

// /t/<symbol> — THE symbol page (Markets, 2026-09-11; the cockpit, 2026-10-13):
// the one-line header strip, the tab strip (Overview · Chart · News ·
// Community · Technicals · Trade) right under it, the live chart on Overview
// and Chart, and the right column (order ticket · watchlist). The
// chart engine sits behind
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

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { symbol } = await params
  const sp = await searchParams
  // Warm the live perp table first (a miss on a cold process → one universe
  // read), so a perp the venue lists is titled and indexed as a chart.
  await resolveChartPair(symbol)
  const seo = symbolPageSeo(symbol)
  // A Depth link (`?view=depth`, the chart's Share from the Depth view) names
  // its own card: the book as X reads it (app/api/og/depth). Setting `images`
  // here outranks the folder's opengraph-image file; every other link keeps
  // the candle card (the key is left off, so the file wins).
  const depth = typeof sp.view === 'string' && sp.view === 'depth' && seo.pair && depthPlanFor(seo.pair, false).main ? seo.pair : null
  if (depth) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') q.set(k, v)
    const settings = parseDepthSettings(q.toString())
    const card = depthCardMeta(depth.symbol, settings, depth.source === 'coinbase')
    const image = { url: depthOgPath(depth.symbol, settings, Date.now()), width: 1200, height: 630, alt: card.alt }
    return {
      title: seo.title,
      description: seo.description,
      alternates: { canonical: seo.canonical },
      openGraph: { title: card.title, description: card.description, url: seo.canonical, type: 'website', images: [image] },
      twitter: { card: 'summary_large_image', title: card.title, description: card.description, images: [image] },
    }
  }
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
  // /t/apple, /t/bitcoin, /t/tesla — a name typed or shared where the
  // ticker goes. The chart module knows these names (speech says "apple");
  // the page used to say "APPLE is not listed" anyway (pre-gtm 2026-10-06).
  // Redirect onto the ticker's page, query kept, so the shared URL lands.
  // The live perp table warms on a miss (lib/charts resolveChartPair): /t/ZK
  // charts on a cold process, and only a symbol the venue does not list
  // falls through to the name redirect + the honest chartless page.
  const pair = await resolveChartPair(norm)
  if (!pair) {
    const named = chartSymbolByName(norm)
    if (named) {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') q.set(k, v)
      const qs = q.toString()
      redirect(`/t/${named}${qs ? `?${qs}` : ''}`)
    }
  }
  const seo = symbolPageSeo(norm)
  // ?tab= and ?tf= are deep links (every gauge is a link target): the server
  // renders the addressed tab so the HTML matches the URL — the client then
  // owns the switch (replaceState, the #705 idiom). Unknown values → default.
  const tabRaw = typeof sp.tab === 'string' ? sp.tab : ''
  const initialTab = parseMarketTab(tabRaw ? `?tab=${encodeURIComponent(tabRaw)}` : '')
  // ?tf=1s was the print frame until it widened to 10s (2026-10-15); a shared
  // 1s link still opens on it.
  const tfRaw = typeof sp.tf === 'string' ? (sp.tf === '1s' ? '10s' : sp.tf) : ''
  const initialTf = CHART_TFS.some((t) => t.key === tfRaw) ? (tfRaw as ChartTf) : undefined
  // ?vs=<symbol> — compare mode (MK2): the server renders the pill so the
  // HTML matches the URL; the client mirrors changes back (replaceState).
  const vsRaw = typeof sp.vs === 'string' ? sp.vs : ''
  const initialVs = vsRaw ? parseVsParam(`?vs=${encodeURIComponent(vsRaw)}`, norm) : null
  // Which sides a venue can fill, read server-side so the header's act strip
  // is right on the FIRST paint: a Buy chip that renders and then vanishes is
  // worse than one that was never offered (lib/tradability-store; fail-soft
  // to {}, which offers everything).
  const tradable = await readTradability()
  // A perp only the live table knows (ZK, AZTEC, an xyz market…): the
  // browser's table is cold until a universe lands, and every client reader
  // calls the SYNC chartPairFor — the root-level ask-door pill before this
  // page even renders. Hand the listing down twice: an inline script the
  // browser runs at parse time (before hydration — lib/charts takes it on
  // its first lookup), and HlPerpsPrime for a soft navigation, which runs no
  // inline script but renders the wrapper before every child.
  // A STOCK whose perp the venue lists (`/t/ANT` beside `/t/ANTPERP`, lib/charts
  // "The perp twin") needs the table for the same reason: its header links to
  // the twin, and a link a warm server draws and a cold browser does not is a
  // hydration error. A stock resolves without the venue, so warm the table
  // here (one read per ten minutes per process, never thrown).
  if (pair?.source === 'robinhood') await warmHlPerps()
  const hlPerps = isLiveOnlyHlPair(pair) || (pair?.source === 'robinhood' && perpTwinOf(pair.symbol)) ? liveHlPerpNames() : null
  const handoff = hlPerps ? `window.${HL_PERPS_HANDOFF_GLOBAL}=${JSON.stringify(hlPerps).replace(/</g, '\\u003c')}` : null
  // The /markets frame (no .x-main) inside the markets shell (the app spine
  // on the left, no brochure nav): SymbolPage's <main class="sym"> and the
  // side column (ask + account strip over the watchlist rail) are its two
  // columns, and the footer sits under the page in the left column, so the
  // rail stays docked through the last footer line.
  return (
    <>
      {handoff && <script dangerouslySetInnerHTML={{ __html: handoff }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: seo.jsonLd }} />
      <HlPerpsPrime hlPerps={hlPerps}>
        <MarketsShell sym>
          <SymbolPage symbol={norm} initialTab={initialTab} initialTf={initialTf} initialVs={initialVs} tradable={tradable} />
          <div className="mkt-frame__foot">
            <Footer />
          </div>
        </MarketsShell>
      </HlPerpsPrime>
    </>
  )
}
