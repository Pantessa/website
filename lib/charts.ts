// Token charts: which tokens have a live candle source, and where the candles
// come from. Pure + client-safe — the same resolver decides (a) whether a
// surface shows the uniform chart button at all and (b) which upstream the
// /api/charts/candles proxy is allowed to hit. Fail-closed: a symbol outside
// the map gets NO button and the API refuses it, so a dead pair never renders
// an empty chart.
//
// Sources are keyless public market data:
//   coinbase    — Coinbase Exchange spot candles (USD products, majors)
//   hyperliquid — HL perp candleSnapshot (venue already in our allowlist)
// Robinhood tokenized stocks (AAPL, TSLA, …) are the declared follow-up: the
// source union grows a 'robinhood' member when a keyless candle feed lands —
// until then stock symbols resolve to null and stay chartless everywhere.

export type ChartSource = 'coinbase' | 'hyperliquid'

export type ChartTf = '15m' | '1h' | '4h' | '1d'

export const CHART_TFS: { key: ChartTf; label: string }[] = [
  { key: '15m', label: '15m' },
  { key: '1h', label: '1H' },
  { key: '4h', label: '4H' },
  { key: '1d', label: '1D' },
]

export interface ChartPair {
  /** Canonical charted symbol (aliases collapse: WETH → ETH). */
  symbol: string
  source: ChartSource
  /** Upstream product id — Coinbase product ('ETH-USD') or HL coin ('HYPE'). */
  pair: string
  /** Human pair label ('ETH / USD'). */
  label: string
}

export interface Candle {
  /** Unix seconds, candle open time. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** Coinbase Exchange USD spot products we chart. */
const COINBASE_USD = new Set([
  'ETH', 'BTC', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR',
  'LINK', 'UNI', 'AAVE', 'LDO', 'CRV', 'COMP', 'MKR', 'SNX', 'MORPHO',
  'ARB', 'OP', 'POL', 'SUI', 'APT', 'INJ', 'TIA', 'FIL', 'ONDO', 'ENA',
  'PEPE', 'SHIB', 'WLD', 'JTO', 'JUP', 'AERO', 'EIGEN',
])

/** Wrapped/staked forms that chart as their underlying USD pair. */
const COINBASE_ALIASES: Record<string, string> = {
  WETH: 'ETH',
  WBTC: 'BTC',
  CBBTC: 'BTC',
  MATIC: 'POL',
}

/** HL perp listings we chart when Coinbase has no USD product. */
const HYPERLIQUID_PERPS = new Set(['HYPE', 'SYRUP', 'FARTCOIN'])

/** Stables chart flat by construction — deliberately chartless. */
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDG', 'GHO', 'USDE', 'PYUSD', 'USDS', 'USDBC'])

export function normalizeChartSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Resolve a token symbol to its candle source, or null (no chart button,
 *  no API pass-through). Aliases collapse first, stables refuse early. */
export function chartPairFor(symbolRaw: string): ChartPair | null {
  const norm = normalizeChartSymbol(symbolRaw)
  if (!norm || norm.length > 12 || STABLES.has(norm)) return null
  const symbol = COINBASE_ALIASES[norm] ?? norm
  if (COINBASE_USD.has(symbol)) {
    return { symbol, source: 'coinbase', pair: `${symbol}-USD`, label: `${symbol} / USD` }
  }
  if (HYPERLIQUID_PERPS.has(symbol)) {
    return { symbol, source: 'hyperliquid', pair: symbol, label: `${symbol} / USD` }
  }
  return null
}

/** Percent move from the candle nearest 24h ago to the latest close.
 *  Null until the series spans enough history to say something honest. */
export function changePct24h(candles: Candle[], nowSec = Math.floor(Date.now() / 1000)): number | null {
  if (candles.length < 2) return null
  const last = candles[candles.length - 1]
  const cutoff = nowSec - 24 * 3600
  let base: Candle | null = null
  for (const c of candles) {
    if (c.t <= cutoff) base = c
    else break
  }
  if (!base) base = candles[0]
  if (!(base.c > 0)) return null
  return ((last.c - base.c) / base.c) * 100
}

/** Group fine candles into coarser buckets (Coinbase has no native 4h). */
export function aggregateCandles(candles: Candle[], bucketSec: number): Candle[] {
  const out = new Map<number, Candle>()
  for (const c of candles) {
    const t = Math.floor(c.t / bucketSec) * bucketSec
    const cur = out.get(t)
    if (!cur) {
      out.set(t, { t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })
    } else {
      cur.h = Math.max(cur.h, c.h)
      cur.l = Math.min(cur.l, c.l)
      cur.c = c.c
      cur.v += c.v
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t)
}
