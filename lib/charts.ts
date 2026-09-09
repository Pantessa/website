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

// ── Chart asks ──────────────────────────────────────────────────────────────
// "Show me the ETH chart" / "pull up bitcoin candles" / "chart HYPE" are a
// READ, and the product already owns the artifact (ChartOverlay) — but the
// phrasing fell past every native gate to the planner, which holds no candle
// feed and answered with prose. The voice door (2026-09-09) made that gap
// loud: a spoken "show me the ETH charts" must POP the chart, not narrate it.
// The parser is shared by the client intercept (instant, no turn burned) and
// the route's native gate (API / embed consumers get an honest artifact reply).
//
// Fail-closed by construction: a chart WORD is required, a money verb refuses
// (the action layers own "buy $50 of ETH and show the chart"), and the symbol
// still has to clear chartPairFor — a named-but-chartless token comes back
// with `pair: null` so the reply can say why, never guess a feed.

export interface ChartAsk {
  /** What the user named, upper-cased (the canonical symbol when charted). */
  symbol: string
  /** The candle source, or null when the token is named but chartless. */
  pair: ChartPair | null
}

const CHART_WORD_RE = /\b(?:charts?|candles?|candlesticks?|price\s+(?:chart|graph|action|history)|graph)\b/i
/** Asks that DO something with money belong to the action layers, chart word or not. */
const CHART_ACTION_VERB_RE = /\b(?:buy|sell|swap|send|transfer|stake|unstake|supply|withdraw|borrow|repay|bridge|deposit|dca|long|short|protect|tile|rebalance|mint|list)\b/i

/** Spoken/typed token names → the charted symbol (speech never says "ETH"). */
const CHART_NAMES: Record<string, string> = {
  ETHEREUM: 'ETH', ETHER: 'ETH', BITCOIN: 'BTC', SOLANA: 'SOL', DOGECOIN: 'DOGE',
  RIPPLE: 'XRP', CARDANO: 'ADA', AVALANCHE: 'AVAX', POLKADOT: 'DOT', COSMOS: 'ATOM',
  CHAINLINK: 'LINK', UNISWAP: 'UNI', LIDO: 'LDO', CURVE: 'CRV', COMPOUND: 'COMP',
  MAKER: 'MKR', SYNTHETIX: 'SNX', ARBITRUM: 'ARB', OPTIMISM: 'OP', POLYGON: 'POL',
  MATIC: 'POL', APTOS: 'APT', INJECTIVE: 'INJ', CELESTIA: 'TIA', FILECOIN: 'FIL',
  ETHENA: 'ENA', SHIBA: 'SHIB', WORLDCOIN: 'WLD', JUPITER: 'JUP', AERODROME: 'AERO',
  EIGENLAYER: 'EIGEN', HYPERLIQUID: 'HYPE',
}

/** Words that sit around a chart ask and must never be read as a ticker. */
const CHART_STOPWORDS = new Set([
  'SHOW', 'ME', 'THE', 'A', 'AN', 'MY', 'LIVE', 'PRICE', 'CHART', 'CHARTS', 'CANDLE', 'CANDLES',
  'CANDLESTICK', 'CANDLESTICKS', 'GRAPH', 'ACTION', 'HISTORY', 'FOR', 'OF', 'ON', 'IN', 'TO', 'UP',
  'PULL', 'OPEN', 'BRING', 'DISPLAY', 'SEE', 'VIEW', 'GIVE', 'GET', 'LET', 'LETS', 'LOOK', 'AT',
  'CAN', 'I', 'YOU', 'PLEASE', 'WANT', 'WOULD', 'LIKE', 'AND', 'WHAT', 'WHATS', 'IS', 'DOING',
  'HOW', 'TODAY', 'NOW', 'RIGHT', 'THIS', 'THAT', 'IT', 'ITS', 'WITH', 'USD', 'DOLLARS', 'TOKEN',
  'COIN', 'PLEASE', 'HEY', 'OK', 'OKAY', 'PANTESSA', 'YEETFUL', 'POP', 'LAST', 'WEEK', 'DAY', 'HOUR',
  'MINUTE', 'MONTH', 'YEAR', 'ALL', 'SOME', 'ANY', 'JUST', 'ALSO', 'THEN', 'THERE', 'HERE', 'ARE',
  'OVER', 'FROM', 'ABOUT', 'DO', 'DOES', 'HAVE', 'HAS', 'GOT', 'GO', 'GOING', 'WERE', 'WAS', 'BE',
])

/**
 * Parse a chart ask. null when the message isn't one (no chart word, or it
 * carries a money verb, or no token is named). With a chart word + a named
 * token: `{ symbol, pair }` — `pair` null when we hold no feed for it.
 */
export function parseChartAsk(message: string): ChartAsk | null {
  const text = message.trim()
  if (!text || text.length > 200 || !CHART_WORD_RE.test(text)) return null
  if (CHART_ACTION_VERB_RE.test(text)) return null
  // Tokens: "$ETH", "ETH", "eth's", "bitcoin". Possessive + punctuation dropped.
  const words = text.replace(/['’]s\b/gi, '').split(/[^A-Za-z0-9$]+/).filter(Boolean)
  let named: string | null = null
  for (const w of words) {
    const raw = w.replace(/^\$/, '').toUpperCase()
    if (!raw || CHART_STOPWORDS.has(raw)) continue
    const sym = CHART_NAMES[raw] ?? raw
    const pair = chartPairFor(sym)
    if (pair) return { symbol: pair.symbol, pair }
    // Remember the first ticker-shaped word so a chartless ask can name it.
    if (!named && /^[A-Z][A-Z0-9]{1,11}$/.test(sym) && /[A-Z]/.test(sym)) named = sym
  }
  return named ? { symbol: named, pair: null } : null
}
