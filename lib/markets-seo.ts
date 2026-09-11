// ─────────────────────────────────────────────────────────────────────────
//  MARKETS SEO — titles, descriptions, canonicals, JSON-LD and the OG-card
//  candle drawing for every /t/<symbol> page, plus the same pattern for
//  /lists/<slug> (WATCH renders the page; the meta comes from here so the
//  two families read as one).
//
//  Honesty rules baked in:
//    · a page exists for every symbol chartPairFor accepts and NO other —
//      the sitemap, the OG allowlist and the title all read the same gate;
//    · the JSON-LD is a Dataset (the page IS a live OHLC series from a named
//      feed) + a BreadcrumbList. NOT FinancialProduct: Pantessa is not the
//      issuer of AAPL or ETH, and claiming an offer we don't make is exactly
//      the kind of structured lie that gets a domain flagged;
//    · a stock title says 24/7 and Robinhood Chain — that is what trades
//      here — and the description names the tape.
//  Server-safe and client-safe (pure; no fetch, no env beyond SITE_URL).
// ─────────────────────────────────────────────────────────────────────────

import { chartPairFor, normalizeChartSymbol, type Candle, type ChartPair } from '@/lib/charts'
import { ROBINHOOD_TICKER_NAMES } from '@/lib/robinhood-tickers'
import { SITE_URL } from '@/lib/site-url'
import { TAPE_FOOTNOTE } from '@/lib/markets-copy'

/** Display names for the coins we chart (symbol when unknown — never guess). */
const COIN_NAMES: Record<string, string> = {
  ETH: 'Ether', BTC: 'Bitcoin', SOL: 'Solana', DOGE: 'Dogecoin', XRP: 'XRP', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR', LINK: 'Chainlink',
  UNI: 'Uniswap', AAVE: 'Aave', LDO: 'Lido DAO', CRV: 'Curve', COMP: 'Compound', MKR: 'Maker',
  SNX: 'Synthetix', MORPHO: 'Morpho', ARB: 'Arbitrum', OP: 'Optimism', POL: 'Polygon',
  SUI: 'Sui', APT: 'Aptos', INJ: 'Injective', TIA: 'Celestia', FIL: 'Filecoin', ONDO: 'Ondo',
  ENA: 'Ethena', PEPE: 'Pepe', SHIB: 'Shiba Inu', WLD: 'Worldcoin', JTO: 'Jito', JUP: 'Jupiter',
  AERO: 'Aerodrome', EIGEN: 'EigenLayer', HYPE: 'Hyperliquid', SYRUP: 'Maple', FARTCOIN: 'Fartcoin',
}

/** Human name for a charted symbol: the issuer's company name for stocks,
 *  the coin's name for crypto, the symbol itself when we have no name. */
export function symbolName(symbol: string): string {
  const s = normalizeChartSymbol(symbol)
  return ROBINHOOD_TICKER_NAMES[s] ?? COIN_NAMES[s] ?? s
}

export interface SymbolSeo {
  /** Canonical symbol (aliases collapsed; WETH → ETH). */
  symbol: string
  pair: ChartPair | null
  name: string
  title: string
  description: string
  canonical: string
  ogAlt: string
  /** Serialized JSON-LD (Dataset + BreadcrumbList) — chartless symbols get breadcrumbs only. */
  jsonLd: string
}

const FEED_LINE: Record<ChartPair['source'], string> = {
  robinhood: 'Robinhood’s 24/7 market-data tape — the print the on-chain token tracks',
  coinbase: 'Coinbase spot',
  hyperliquid: 'Hyperliquid perps',
}

export function symbolPageSeo(symbolRaw: string): SymbolSeo {
  const norm = normalizeChartSymbol(symbolRaw)
  const pair = chartPairFor(norm)
  const symbol = pair?.symbol ?? norm
  const name = symbolName(symbol)
  const canonical = `${SITE_URL}/t/${symbol}`

  let title: string
  let description: string
  if (!pair) {
    title = `${symbol || 'Token'} — Pantessa Markets`
    description = `No live chart for ${symbol || 'this token'} yet. You can still trade it from one sentence in chat — guarded, signed only by your wallet.`
  } else if (pair.source === 'robinhood') {
    title = `${symbol} 24/7 — trade ${name} on Robinhood Chain | Pantessa Markets`
    description = `Live ${symbol} chart from ${FEED_LINE.robinhood}. Buy, sell or DCA ${name} from the chart — guarded transactions, signed only by your wallet. Unlimited watchlists and alerts, free.`
  } else if (pair.source === 'hyperliquid') {
    title = `${symbol} perps live chart — long or short from the chart | Pantessa Markets`
    description = `Live ${symbol} / USD candles from ${FEED_LINE.hyperliquid}. Open a sized long or short with a stop from the chart — guarded, signed only by your wallet.`
  } else {
    title = `${symbol} live chart — trade ${name} from the chart | Pantessa Markets`
    description = `Live ${symbol} / USD candles from ${FEED_LINE.coinbase}. Swap, DCA or protect ${name} from the chart — one sentence, guarded, your wallet signs.`
  }

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Markets', item: `${SITE_URL}/markets` },
      { '@type': 'ListItem', position: 2, name: symbol, item: canonical },
    ],
  }
  const dataset = pair
    ? {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: `${symbol} / USD candles`,
        description: `Live OHLCV candles for ${name} (${symbol}) from ${FEED_LINE[pair.source]}, 15-minute to daily. ${TAPE_FOOTNOTE}.`,
        url: canonical,
        keywords: [symbol, name, 'live chart', pair.source === 'robinhood' ? 'tokenized stock' : pair.source === 'hyperliquid' ? 'perpetual' : 'spot', 'Robinhood Chain', 'Pantessa Markets'],
        variableMeasured: ['open', 'high', 'low', 'close', 'volume'],
        isAccessibleForFree: true,
        creator: { '@type': 'Organization', name: 'Pantessa', url: SITE_URL },
        provider: { '@type': 'Organization', name: 'Pantessa', url: SITE_URL },
        sourceOrganization: {
          '@type': 'Organization',
          name: pair.source === 'robinhood' ? 'Robinhood' : pair.source === 'coinbase' ? 'Coinbase' : 'Hyperliquid',
        },
      }
    : null
  return {
    symbol,
    pair,
    name,
    title,
    description,
    canonical,
    ogAlt: pair ? `${symbol} live chart — ${name} on Pantessa Markets` : `${symbol} on Pantessa Markets`,
    jsonLd: JSON.stringify(dataset ? [dataset, crumbs] : [crumbs]),
  }
}

// ── /lists/<slug> — the same pattern for public watchlists (WATCH owns the
//    page; import this so list cards read as the symbol cards' sibling) ────

export interface ListSeoInput {
  slug: string
  name: string
  symbols: string[]
  /** "@nate" or a short address — shown as the curator, never a raw wallet. */
  curatorLabel?: string | null
}

export interface ListSeo {
  title: string
  description: string
  canonical: string
  ogAlt: string
  jsonLd: string
  /** Symbols we can chart / not — the honest split the page + the card show. */
  chartable: string[]
  notYet: string[]
}

export function listPageSeo(input: ListSeoInput): ListSeo {
  const chartable: string[] = []
  const notYet: string[] = []
  for (const raw of input.symbols) {
    const p = chartPairFor(raw)
    ;(p ? chartable : notYet).push(p?.symbol ?? normalizeChartSymbol(raw))
  }
  const stocks = chartable.filter((s) => chartPairFor(s)?.source === 'robinhood').length
  const canonical = `${SITE_URL}/lists/${input.slug}`
  const by = input.curatorLabel ? ` by ${input.curatorLabel}` : ''
  const title = `${input.name} — a watchlist${by} | Pantessa Markets`
  const description = `${chartable.length} symbol${chartable.length === 1 ? '' : 's'}${stocks ? `, ${stocks} tradable 24/7 on Robinhood Chain` : ''} — every one chartable, every chart the order form. Fork it free; there is no limit on lists.`
  const jsonLd = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: input.name,
      url: canonical,
      numberOfItems: chartable.length,
      itemListElement: chartable.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s, url: `${SITE_URL}/t/${s}` })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Markets', item: `${SITE_URL}/markets` },
        { '@type': 'ListItem', position: 2, name: input.name, item: canonical },
      ],
    },
  ])
  return { title, description, canonical, ogAlt: `${input.name} — a Pantessa Markets watchlist`, jsonLd, chartable, notYet }
}

// ── OG card candles — a pure SVG string (satori draws it as an <img>) ─────

export interface CandleSvgOptions {
  width: number
  height: number
  up: string
  down: string
  grid: string
  /** How many of the trailing candles to draw. */
  count?: number
}

/** Candlesticks as one SVG string. No text — the card labels the axes in
 *  its own font. Returns an empty-state grid when the series is too short. */
export function candleSvg(candles: Candle[], o: CandleSvgOptions): string {
  const pad = { l: 8, r: 8, t: 10, b: 10 }
  const w = o.width
  const h = o.height
  const rows = candles.slice(-(o.count ?? 60))
  const gridLines = [0.25, 0.5, 0.75]
    .map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" stroke="${o.grid}" stroke-width="1"/>`)
    .join('')
  if (rows.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${gridLines}</svg>`
  }
  let lo = Infinity
  let hi = -Infinity
  for (const c of rows) {
    if (c.l < lo) lo = c.l
    if (c.h > hi) hi = c.h
  }
  if (!(hi > lo)) hi = lo + 1
  const span = hi - lo
  const y = (p: number) => pad.t + ((hi - p) / span) * (h - pad.t - pad.b)
  const slot = (w - pad.l - pad.r) / rows.length
  const bodyW = Math.max(2, Math.min(14, slot * 0.62))
  const parts: string[] = []
  rows.forEach((c, i) => {
    const cx = pad.l + slot * i + slot / 2
    const col = c.c >= c.o ? o.up : o.down
    const top = y(Math.max(c.o, c.c))
    const bot = y(Math.min(c.o, c.c))
    const bh = Math.max(1.5, bot - top)
    parts.push(
      `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`,
      `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${col}"/>`,
    )
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${gridLines}${parts.join('')}</svg>`
}

/** Price formatting for the OG card — mirrors CandleChart's fmtPrice scale. */
export function fmtOgPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}
