// A charted pair → the symbol description the library asks for. Pure,
// pinned (scripts/tv-pins).
//
// Honesty rules carried over from the built-in chart:
//  · the frames offered are the frames the source really serves
//    (lib/charts tfsForSource): a stock and an index get no minute bar and
//    no print frame
//  · an index is DELAYED data and says so (`delayed_streaming`, 15 minutes)
//  · every market is described as round-the-clock in UTC. A stock's tape
//    has pre- and post-market bars and our 4-hour bars are cut on UTC
//    boundaries; telling the library "09:30 to 16:00 New York" would make
//    it drop the extended-hours bars and move the others. The market-status
//    badge is switched off in the widget for the same reason: it would read
//    "open" on a Sunday.

import { CHART_FEED_LABELS, chartUnitOf, type ChartPair } from '@/lib/charts'
import { hasSecondsFrame, intradayMultipliers, resolutionsForSource } from './resolution'
import type { TvSearchResult, TvSymbolInfo } from './types'

/** 10^decimals for a price of this size: cents on a big number, more places
 *  as the price shrinks (a meme coin at $0.0000012 still moves a tick). */
export function pricescaleFor(price: number | null | undefined, unit: 'usd' | 'level' | 'yield' = 'usd'): number {
  if (unit === 'yield') return 1_000
  if (unit === 'level') return 100
  if (!price || !(price > 0)) return 10_000
  if (price >= 100) return 100
  if (price >= 1) return 10_000
  if (price >= 0.01) return 1_000_000
  if (price >= 0.0001) return 100_000_000
  return 10_000_000_000
}

const TYPE_OF: Readonly<Record<ChartPair['source'], string>> = { coinbase: 'crypto', hyperliquid: 'crypto', robinhood: 'stock', index: 'index' }

/** The library's description of a pair. `lastPrice` only sizes the decimals. */
export function symbolInfoFor(pair: ChartPair, lastPrice: number | null): TvSymbolInfo {
  const delayed = pair.source === 'index'
  const exchange = CHART_FEED_LABELS[pair.source]
  return {
    name: pair.symbol,
    ticker: pair.symbol,
    description: pair.label,
    type: TYPE_OF[pair.source],
    session: '24x7',
    exchange,
    listed_exchange: exchange,
    timezone: 'Etc/UTC',
    format: 'price',
    pricescale: pricescaleFor(lastPrice, chartUnitOf(pair)),
    minmov: 1,
    has_intraday: true,
    intraday_multipliers: intradayMultipliers(pair.source),
    has_seconds: hasSecondsFrame(pair.source),
    ...(hasSecondsFrame(pair.source) ? { seconds_multipliers: ['10'] } : {}),
    has_daily: true,
    daily_multipliers: ['1'],
    has_weekly_and_monthly: false,
    has_empty_bars: false,
    supported_resolutions: resolutionsForSource(pair.source),
    visible_plots_set: delayed ? 'ohlc' : 'ohlcv',
    volume_precision: 2,
    data_status: delayed ? 'delayed_streaming' : 'streaming',
    ...(delayed ? { delay: 900 } : {}),
  }
}

/** One search row. */
export function searchRowFor(pair: ChartPair): TvSearchResult {
  return { symbol: pair.symbol, ticker: pair.symbol, description: pair.label, exchange: CHART_FEED_LABELS[pair.source], type: TYPE_OF[pair.source] }
}

/**
 * The symbols a typed query finds, best first: an exact ticker, then tickers
 * that start with it, then tickers and names that contain it. Capped.
 */
export function searchPairs(query: string, universe: readonly ChartPair[], cap = 30): ChartPair[] {
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '')
  if (!q) return universe.slice(0, cap)
  const rank = (p: ChartPair): number => {
    const sym = p.symbol.toUpperCase()
    const label = p.label.toUpperCase()
    if (sym === q) return 0
    if (sym.startsWith(q)) return 1
    if (sym.includes(q)) return 2
    if (label.includes(q)) return 3
    return 9
  }
  return universe
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.p.symbol.localeCompare(b.p.symbol))
    .slice(0, cap)
    .map((x) => x.p)
}
