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
//   robinhood   — Robinhood's own market-data historicals for the tokenized
//                 equities on Robinhood Chain (24/7 bounds — the same
//                 round-the-clock tape the on-chain stock tokens track; the
//                 proxy falls back to Yahoo Finance's chart feed when the
//                 primary is down, and says so in `feed`). Landed 2026-09-10;
//                 the ticker set is the static lib/robinhood-tickers snapshot
//                 minus the two listings the feed has no quote for.

export type ChartSource = 'coinbase' | 'hyperliquid' | 'robinhood'

/** Which upstream actually served a series — the honest eyebrow on the chart
 *  (a stock chart says "Yahoo Finance" while Robinhood's feed is down, never
 *  "Robinhood"). Coinbase and Hyperliquid have no fallback: feed === source. */
export type ChartFeed = ChartSource | 'yahoo'

export const CHART_FEED_LABELS: Record<ChartFeed, string> = {
  coinbase: 'Coinbase',
  hyperliquid: 'Hyperliquid',
  robinhood: 'Robinhood',
  yahoo: 'Yahoo Finance',
}

import { ROBINHOOD_TICKER_SET } from '@/lib/robinhood-tickers'

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

/** Listed on Robinhood Chain but with NO quote on Robinhood's market-data
 *  feed (probed 2026-09-10 across all 201 listings: a batch historicals call
 *  returns an empty instrument for exactly these two). They stay chartless
 *  BY NAME rather than growing a button over an empty chart. */
const ROBINHOOD_FEEDLESS = new Set(['CASHCAT', 'SATS'])

/** A tokenized equity we hold a candle feed for. Coins are checked FIRST in
 *  chartPairFor (nothing lists AAPL as a coin, and a ticker that collides
 *  with a Coinbase product would chart the coin — pinned in the harness). */
export function isChartedStock(symbolRaw: string): boolean {
  const sym = normalizeChartSymbol(symbolRaw)
  return ROBINHOOD_TICKER_SET.has(sym) && !ROBINHOOD_FEEDLESS.has(sym)
}

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
  if (isChartedStock(symbol)) {
    return { symbol, source: 'robinhood', pair: symbol, label: `${symbol} / USD` }
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

/** Company names → the Robinhood Chain ticker (speech says "apple", not
 *  "AAPL"). Curated household names only; every target must clear
 *  isChartedStock (harness-pinned) so a name never points at a dead chart. */
const CHART_STOCK_NAMES: Record<string, string> = {
  APPLE: 'AAPL', TESLA: 'TSLA', NVIDIA: 'NVDA', MICROSOFT: 'MSFT', AMAZON: 'AMZN',
  GOOGLE: 'GOOGL', ALPHABET: 'GOOGL', FACEBOOK: 'META', NETFLIX: 'NFLX', COINBASE: 'COIN',
  PALANTIR: 'PLTR', INTEL: 'INTC', ORACLE: 'ORCL', SALESFORCE: 'CRM', ADOBE: 'ADBE',
  BROADCOM: 'AVGO', SHOPIFY: 'SHOP', ROBLOX: 'RBLX', REDDIT: 'RDDT', RIVIAN: 'RIVN',
  SPACEX: 'SPCX', MICROSTRATEGY: 'MSTR', STRATEGY: 'MSTR', CIRCLE: 'CRCL', FIGMA: 'FIG',
  WEBULL: 'BULL', NASDAQ: 'QQQ', SP500: 'SPY', SPX: 'SPY', BOEING: 'BA', FORD: 'F',
  PFIZER: 'PFE', MODERNA: 'MRNA', LILLY: 'LLY', SNOWFLAKE: 'SNOW', DATADOG: 'DDOG',
  CLOUDFLARE: 'NET', CROWDSTRIKE: 'CRWD', SNAPCHAT: 'SNAP', ZOOM: 'ZM', TSMC: 'TSM',
  QUALCOMM: 'QCOM', MICRON: 'MU', CISCO: 'CSCO', GAMESTOP: 'GME', ALIBABA: 'BABA',
  ROCKETLAB: 'RKLB', EXXON: 'XOM', GOLD: 'GLD', SILVER: 'SLV', OIL: 'USO', NOKIA: 'NOK',
  COSTCO: 'COST', LULULEMON: 'LULU', UNITEDHEALTH: 'UNH', WORKDAY: 'WDAY', ATLASSIAN: 'TEAM',
  SERVICENOW: 'NOW', FORTINET: 'FTNT', ARISTA: 'ANET', MONGODB: 'MDB', CARVANA: 'CVNA',
  NUBANK: 'NU', RIGETTI: 'RGTI', CEREBRAS: 'CBRS', CARNIVAL: 'CCL', DELL: 'DELL', IBM: 'IBM',
}

/** Stock tickers that are also ordinary English words. Typed in lowercase
 *  inside a sentence they are prose ("show me the cost chart" is not a
 *  Costco ask); they chart only as "$COST", "COST", or by company name.
 *  Every ticker of three letters or fewer (ON, F, NOW, NET, RUN…) takes the
 *  same rule by length. */
const ENGLISH_WORD_TICKERS = new Set([
  'COST', 'PATH', 'SNAP', 'COIN', 'BULL', 'DRAM', 'LITE', 'NASA', 'POET', 'TEAM', 'HIMS',
  'LULU', 'ONTO', 'DELL', 'OUST', 'PENG', 'LUNR', 'JOBY', 'WULF',
])

/** Did the user CLEARLY type this word as a ticker? "$COIN" or "COIN" in an
 *  otherwise-lowercase sentence, yes; "coin" (a stopword) or "ON" inside a
 *  caps-lock message, no. */
function typedAsTicker(word: string, message: string): boolean {
  if (word.startsWith('$')) return true
  const bare = word.replace(/^\$/, '')
  return bare === bare.toUpperCase() && /[a-z]/.test(message)
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
  // "S&P 500" would split into "S" + "P" (P is a listed ticker) — fold the
  // index name onto its ETF before the split.
  const words = text
    .replace(/\bS\s*&\s*P(?:\s*500)?\b/gi, ' SPY ')
    .replace(/['’]s\b/gi, '')
    .split(/[^A-Za-z0-9$]+/)
    .filter(Boolean)
  let named: string | null = null
  for (const w of words) {
    const raw = w.replace(/^\$/, '').toUpperCase()
    if (!raw) continue
    // A listed equity beats the stopword list only when it was clearly
    // typed as a ticker ("$COIN", "COIN") — "chart on base" must never pop
    // ON Semiconductor, and "show me the coin chart" stays a non-ask.
    const ticker = typedAsTicker(w, text) && isChartedStock(raw)
    if (!ticker && CHART_STOPWORDS.has(raw)) continue
    const byName = CHART_NAMES[raw] ?? CHART_STOCK_NAMES[raw]
    const sym = byName ?? raw
    const pair = chartPairFor(sym)
    // A stock reached by a lowercase bare ticker must be unmistakably a
    // ticker: four+ letters and not an English word ("aapl", "nvda" — yes;
    // "cost", "on", "now" — no).
    if (pair?.source === 'robinhood' && !byName && !ticker && (raw.length < 4 || ENGLISH_WORD_TICKERS.has(raw))) continue
    if (pair) return { symbol: pair.symbol, pair }
    // Remember the first ticker-shaped word so a chartless ask can name it.
    if (!named && /^[A-Z][A-Z0-9]{1,11}$/.test(sym) && /[A-Z]/.test(sym)) named = sym
  }
  return named ? { symbol: named, pair: null } : null
}

// ── MARKETS/MSG ──────────────────────────────────────────────────────────
/** Every symbol chartPairFor accepts, in canonical form (aliases collapsed,
 *  stables + feedless listings excluded): coins, then perps, then the
 *  charted Robinhood-Chain stocks. The sitemap's /t/<sym> set and the OG
 *  route's allowlist read THIS, so a symbol is indexed iff it charts. */
export function chartableSymbols(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const pair = chartPairFor(s)
    if (pair && pair.symbol === s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  for (const s of COINBASE_USD) push(s)
  for (const s of HYPERLIQUID_PERPS) push(s)
  for (const s of [...ROBINHOOD_TICKER_SET].sort()) push(s)
  return out
}
