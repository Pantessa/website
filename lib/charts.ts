// Token charts: which tokens have a live candle source, and where the candles
// come from. Pure + client-safe — the same resolver decides (a) whether a
// surface shows the uniform chart button at all and (b) which upstream the
// /api/charts/candles proxy is allowed to hit. Fail-closed: a symbol outside
// the map gets NO button and the API refuses it, so a dead pair never renders
// an empty chart.
//
// Sources are keyless public market data:
//   coinbase    — Coinbase Exchange spot candles (USD products, majors)
//   hyperliquid — HL perp candleSnapshot (venue already in our allowlist).
//                 The perp set is the venue's LIVE universe (lib/hl-universe,
//                 main book + the xyz dex, cached 10 min) over a static
//                 fallback — any perp a visitor picks on /live or the deck
//                 charts, quotes and alerts (2026-10-13; ZK / AZTEC / PURR /
//                 GRIFFAIN / kPEPE used to have no pair at all). Cold, the
//                 table is the static set: server entry points call
//                 resolveChartPair (miss → warm → retry) and the /t page
//                 hands its client shell the live list (primeHlUniverse).
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
import { hlPerpUniverseCached, hlPerpUniverseFresh, hlUniverses, primeHlUniverse, type HlDex } from '@/lib/hl-universe'

export type ChartTf = '1s' | '1m' | '15m' | '1h' | '4h' | '1d'

export const CHART_TFS: { key: ChartTf; label: string }[] = [
  { key: '1s', label: '1s' },
  { key: '1m', label: '1m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1H' },
  { key: '4h', label: '4H' },
  { key: '1d', label: '1D' },
]

/** A PRINT frame: bars built from the stream's executions (lib/chart-live),
 *  not from a venue's candles — no venue serves it, the relay backfills it. */
export const PRINT_TFS: readonly ChartTf[] = ['1s']
export function isPrintTf(tf: ChartTf): boolean {
  return PRINT_TFS.includes(tf)
}

/** The frames a venue's candles serve (everything but the print frames). */
export const VENUE_TFS: { key: ChartTf; label: string }[] = CHART_TFS.filter((t) => !isPrintTf(t.key))

/** The frames a source can draw: a tokenized stock's tape (Robinhood's
 *  5-minute historicals, Yahoo behind it) has no minute bar and no prints,
 *  so 1s and 1m are a coin's and a perp's (2026-10-13, the live tail). */
export function tfsForSource(source: ChartSource | null | undefined): { key: ChartTf; label: string }[] {
  return source === 'robinhood' ? CHART_TFS.filter((t) => t.key !== '1m' && !isPrintTf(t.key)) : CHART_TFS
}

/** The frames the Technicals gauge reads: venue candles only. */
export function technicalsTfs(source: ChartSource | null | undefined): { key: ChartTf; label: string }[] {
  return tfsForSource(source).filter((t) => !isPrintTf(t.key))
}

/** The frame a token chart opens on: the day (Nate, 2026-09-16). The chart
 *  engine and the Technicals tab both read it, so the candles and the gauge
 *  open on the same frame. The landing's rehearsal still asks for 1H. */
export const DEFAULT_CHART_TF: ChartTf = '1d'

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
  // Base-native and newer listings (probed on Coinbase Exchange 2026-10-13,
  // Nate looking up VIRTUAL): every one answers /products/<SYM>-USD.
  'VIRTUAL', 'DEGEN', 'ZRO', 'WELL', 'TOSHI', 'KAITO', 'CLANKER', 'SPX', 'STRK', 'PENDLE', 'PYTH', 'W', 'ZEC', 'SEI',
])

/** Wrapped/staked forms that chart as their underlying USD pair. */
const COINBASE_ALIASES: Record<string, string> = {
  WETH: 'ETH',
  WBTC: 'BTC',
  CBBTC: 'BTC',
  MATIC: 'POL',
}

/** HL perp listings we chart when Coinbase has no USD product — the STATIC
 *  FALLBACK (and the only perps the free-text scanners read bare, see
 *  isMoneyAssetWord / parseChartAsk). The live table below extends it with
 *  every listed perp once a universe read has landed. */
const HYPERLIQUID_PERPS = new Set(['HYPE', 'SYRUP', 'FARTCOIN', 'BRETT', 'AIXBT'])

// ── The live Hyperliquid pair table ────────────────────────────────────────
// Canonical chart symbol → the venue's own coin spelling, derived from the
// cached universes (lib/hl-universe): 'ZK' → 'ZK', 'KPEPE' → 'kPEPE' (the
// venue's k-prefixed thousand-lots keep their case on the wire — candleSnapshot
// and metaAndAssetCtxs key on it), 'GOLD' → 'xyz:GOLD' (an xyz-dex perp whose
// ticker is not a Robinhood-Chain stock). PURE on its inputs so the harness
// pins the rules without a venue:
//   · Coinbase first — a coin Coinbase lists keeps its Coinbase pair
//     (chartPairFor checks it before this table; the table skips it too).
//   · Robinhood keeps its stocks — an xyz:NVDA perp never turns /t/NVDA into
//     a perp chart (the stock tape is the chart; the xyz perp is a venue row),
//     and a feedless listing (SATS) stays chartless rather than charting the
//     venue's same-named coin.
//   · stables never chart; the xyz index product (`:XYZ100`) is not a market
//     (lib/tape pickTapeMarkets drops it the same way); delisted rows are not
//     passed in (lib/hl-universe splits listed from delisted).
//   · the main book wins a ticker collision with the xyz dex.
export function hlChartTableFrom(main: Iterable<string>, xyz: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>()
  const take = (coin: string, ticker: string) => {
    const norm = normalizeChartSymbol(ticker)
    if (!norm || norm.length > 12 || STABLES.has(norm)) return
    const symbol = COINBASE_ALIASES[norm] ?? norm
    // The whole Robinhood-Chain listing set, feedless names included: SATS on
    // Robinhood Chain is not the venue's SATS perp — a ticker that names a
    // stock token never charts as a perp wearing the stock's name.
    if (COINBASE_USD.has(symbol) || ROBINHOOD_TICKER_SET.has(symbol) || out.has(symbol)) return
    out.set(symbol, coin)
  }
  for (const coin of main) {
    if (typeof coin !== 'string' || !coin || coin.includes(':')) continue
    take(coin, coin)
  }
  for (const coin of xyz) {
    if (typeof coin !== 'string') continue
    const i = coin.indexOf(':')
    if (i <= 0) continue
    const ticker = coin.slice(i + 1)
    if (!ticker || /^XYZ100$/i.test(ticker)) continue
    take(coin, ticker)
  }
  return out
}

/** The live table, rebuilt only when a universe read lands (identity-keyed
 *  on the cached universes, so a sync lookup costs a Map get). Empty while
 *  cold — chartPairFor then answers from the static set alone. */
let liveTableMemo: { main: unknown; xyz: unknown; table: Map<string, string> } | null = null
/** The server's handoff for a live-only perp page: an inline script the
 *  browser runs at PARSE time (app/t/[symbol]/page.tsx), before any bundle
 *  hydrates — so the first client lookup, wherever it sits in the tree (the
 *  ask-door pill at the root reads the path's symbol before the page
 *  renders), already holds the venue's listing. Read once, then dropped. */
declare global {
  // eslint-disable-next-line no-var
  var __pantessaHlPerps: { main?: unknown; xyz?: unknown } | undefined
}
export const HL_PERPS_HANDOFF_GLOBAL = '__pantessaHlPerps'
function takeHandoff(): void {
  const g = globalThis.__pantessaHlPerps
  if (!g) return
  globalThis.__pantessaHlPerps = undefined
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  primeHlPerps({ main: list(g.main), xyz: list(g.xyz) })
}
function liveHlTable(): Map<string, string> {
  if (!hlPerpUniverseCached('main')) takeHandoff()
  const main = hlPerpUniverseCached('main')
  const xyz = hlPerpUniverseCached('xyz')
  if (!liveTableMemo || liveTableMemo.main !== main || liveTableMemo.xyz !== xyz) {
    liveTableMemo = { main, xyz, table: hlChartTableFrom(main?.listed ?? [], xyz?.listed ?? []) }
  }
  return liveTableMemo.table
}

/** The venue coin a canonical symbol charts as on Hyperliquid, or null: the
 *  static set first (its coin IS the symbol), then the live table. */
function hlPerpCoinFor(symbol: string): string | null {
  if (HYPERLIQUID_PERPS.has(symbol)) return symbol
  return liveHlTable().get(symbol) ?? null
}

/** A perp that charts ONLY through the live table (not the static set).
 *  The free-text scanners (parseChartAsk, chartSymbolsIn) read these only
 *  when clearly typed as a ticker — the venue lists ME, AI, IP, OM, MOVE,
 *  GOAT, BABY, PUMP…, and "move my eth" is not a MOVE chart. */
export function isLiveOnlyHlPair(pair: ChartPair | null | undefined): boolean {
  return !!pair && pair.source === 'hyperliquid' && !HYPERLIQUID_PERPS.has(pair.symbol)
}

/** Has a live universe read landed in this process (the table is more than
 *  the static set)? Sync. */
export function hlPerpsWarm(): boolean {
  return hlPerpUniverseCached('main') !== null
}

/**
 * Warm the live table: one `meta` read per dex (cached 10 min, inflight
 * shared, a failure retried after a minute and NEVER thrown — the static set
 * holds). Resolves once both dexes have answered or failed; true when at
 * least the main book is held.
 */
export async function warmHlPerps(): Promise<boolean> {
  const { main } = await hlUniverses()
  return main !== null
}

/**
 * chartPairFor with the live table warmed on a miss — for SERVER entry
 * points that may run on a cold process (the candles proxy, readQuotes, the
 * /t page, the venue map): a symbol the static table does not know is
 * refused only after the venue's universe has been read (once per 10 min).
 * A hit, a stable or a fresh table never costs a read.
 */
export async function resolveChartPair(symbolRaw: string): Promise<ChartPair | null> {
  const direct = chartPairFor(symbolRaw)
  if (direct) return direct
  const norm = normalizeChartSymbol(symbolRaw)
  if (!norm || norm.length > 12 || STABLES.has(norm)) return null
  if (hlPerpUniverseFresh('main') && hlPerpUniverseFresh('xyz')) return null
  await warmHlPerps()
  return chartPairFor(symbolRaw)
}

/** The listed perp names the live table was built from — what a server
 *  render hands its client shell so the browser's table matches before its
 *  first paint (SymbolPage → primeHlPerps). Null while cold. */
export function liveHlPerpNames(): { main: string[]; xyz: string[] } | null {
  const main = hlPerpUniverseCached('main')
  if (!main) return null
  const xyz = hlPerpUniverseCached('xyz')
  return { main: [...main.listed], xyz: xyz ? [...xyz.listed] : [] }
}

/** Prime the live table from names already in hand (the server's handoff,
 *  or a universe another reader just fetched). Idempotent; a payload too
 *  small to be the venue is ignored (lib/hl-universe primeHlUniverse). */
export function primeHlPerps(names: { main: readonly string[]; xyz?: readonly string[] }): void {
  const rows = (list: readonly string[]) => list.map((name) => ({ name }))
  if (names.main.length) primeHlUniverse('main' satisfies HlDex, rows(names.main))
  if (names.xyz?.length) primeHlUniverse('xyz' satisfies HlDex, rows(names.xyz))
}

/** Listed on Robinhood Chain but with NO quote on Robinhood's market-data
 *  feed (probed 2026-09-10 across all 201 listings: a batch historicals call
 *  returns an empty instrument for exactly these two; PONS joined the list
 *  by 2026-10-13 — `missing_instruments` on Robinhood, "No data found" on
 *  Yahoo, a CoinGecko-imaged token, not an equity). They stay chartless BY
 *  NAME rather than growing a button over an empty chart. */
const ROBINHOOD_FEEDLESS = new Set(['CASHCAT', 'SATS', 'PONS'])

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
 *  no API pass-through). Aliases collapse first, stables refuse early;
 *  Coinbase before Hyperliquid (static set, then the live table) before the
 *  Robinhood-Chain stocks. Sync — see resolveChartPair for the server path
 *  that warms the live table on a miss. */
export function chartPairFor(symbolRaw: string): ChartPair | null {
  const norm = normalizeChartSymbol(symbolRaw)
  if (!norm || norm.length > 12 || STABLES.has(norm)) return null
  const symbol = COINBASE_ALIASES[norm] ?? norm
  if (COINBASE_USD.has(symbol)) {
    return { symbol, source: 'coinbase', pair: `${symbol}-USD`, label: `${symbol} / USD` }
  }
  const coin = hlPerpCoinFor(symbol)
  if (coin) {
    return { symbol, source: 'hyperliquid', pair: coin, label: `${symbol} / USD` }
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

/** A household name → the ticker it charts ("apple" → AAPL, "bitcoin" →
 *  BTC), or null. The /t/<symbol> page redirects a named URL onto the
 *  ticker's page (pre-gtm 2026-10-06: /t/apple rendered "APPLE is not
 *  listed" beside a chart module that knew the name), and the money-shape
 *  gate counts a name as evidence of an asset. */
export function chartSymbolByName(raw: string): string | null {
  const norm = normalizeChartSymbol(raw)
  if (!norm) return null
  const sym = CHART_NAMES[norm] ?? CHART_STOCK_NAMES[norm]
  return sym && chartPairFor(sym) ? sym : null
}

/** Does this one word name an asset a stranger could mean money by? A coin
 *  we chart (BTC, SOL, DOGE, HYPE…), a household name (apple, bitcoin), or a
 *  stock ticker of four+ letters that is not also an English word. Short or
 *  word-shaped stock tickers ("on", "run", "now", "snap") are prose until a
 *  sentence sizes them — the English-word fence below is the same one the
 *  chart-ask parser uses. Pure; lib/ask-failure-shape reads it. */
export function isMoneyAssetWord(word: string): boolean {
  const norm = normalizeChartSymbol(word)
  if (!norm || norm.length < 3 || norm.length > 12) return false
  if (CHART_NAMES[norm] || CHART_STOCK_NAMES[norm]) return true
  const sym = COINBASE_ALIASES[norm] ?? norm
  // The STATIC perp set only, never the live table: a single word has no
  // sentence to tell "move" from MOVE or "pump" from PUMP, and a sized ask
  // ("buy $20 of AZTEC") is money-shaped by its verb + amount already.
  if (COINBASE_USD.has(sym) || HYPERLIQUID_PERPS.has(sym)) return true
  return norm.length >= 4 && !ENGLISH_WORD_TICKERS.has(norm) && isChartedStock(norm)
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
    let pair = chartPairFor(sym)
    // A stock reached by a lowercase bare ticker must be unmistakably a
    // ticker: four+ letters and not an English word ("aapl", "nvda" — yes;
    // "cost", "on", "now" — no).
    if (pair?.source === 'robinhood' && !byName && !ticker && (raw.length < 4 || ENGLISH_WORD_TICKERS.has(raw))) continue
    // A perp only the live table knows (AI, MOVE, GOAT, PUMP…) must be
    // typed as a ticker ("$AI", or AI in a lowercase sentence) — a bare
    // lowercase word reads as it did before the table existed: no feed for
    // it (the chartless answer still names the word), never a MOVE chart.
    if (isLiveOnlyHlPair(pair) && !byName && !typedAsTicker(w, text)) pair = null
    if (pair) return { symbol: pair.symbol, pair }
    // Remember the first ticker-shaped word so a chartless ask can name it.
    if (!named && /^[A-Z][A-Z0-9]{1,11}$/.test(sym) && /[A-Z]/.test(sym)) named = sym
  }
  return named ? { symbol: named, pair: null } : null
}

// ── MARKETS/MSG ──────────────────────────────────────────────────────────
/** Every symbol chartPairFor accepts STATICALLY, in canonical form (aliases
 *  collapsed, stables + feedless listings excluded): coins, then the static
 *  perps, then the charted Robinhood-Chain stocks. The sitemap's /t/<sym>
 *  set reads THIS, so a symbol is indexed iff it charts on a cold process —
 *  the live perp table (hundreds of venue listings that come and go) charts
 *  on demand and is deliberately NOT indexed. */
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

/** Chain and venue names that double as chart names or tickers ("on
 *  arbitrum" is not ARB, "supply USDC to aave" is not AAVE, "stake on lido"
 *  is not LDO). After a place preposition they name WHERE, so there they
 *  count as a token only when clearly typed as one ("$AAVE", or AAVE in a
 *  lowercase sentence); "buy $5 of aave" still names the token. */
const PLACE_PREPOSITIONS = new Set(['on', 'to', 'with', 'via', 'at', 'from', 'into', 'using', 'through', 'onto'])
const TRADE_PLACE_WORDS = new Set([
  'ETHEREUM', 'ARBITRUM', 'OPTIMISM', 'POLYGON', 'HYPERLIQUID', 'UNISWAP', 'LIDO', 'CURVE',
  'COMPOUND', 'AAVE', 'MORPHO', 'AERODROME', 'JUPITER', 'OP', 'ARB', 'UNI',
])

/**
 * Every CHARTED symbol a sentence names, in order, with the word index it sat
 * at — the same word rules as parseChartAsk (tickers vs English words, names →
 * tickers), minus the chart-word gate, plus a chain/venue fence. Used to tag a
 * trade's fills with the symbols it moved (lib/fill-symbols.ts). Stables and
 * unknown tokens never appear.
 */
export function chartSymbolsIn(text: string): { symbol: string; at: number }[] {
  const words = text
    .slice(0, 400)
    .replace(/\bS\s*&\s*P(?:\s*500)?\b/gi, ' SPY ')
    .replace(/['’]s\b/gi, '')
    .split(/[^A-Za-z0-9$]+/)
    .filter(Boolean)
  const out: { symbol: string; at: number }[] = []
  words.forEach((w, at) => {
    const raw = w.replace(/^\$/, '').toUpperCase()
    if (!raw) return
    const typed = typedAsTicker(w, text)
    const ticker = typed && isChartedStock(raw)
    if (!ticker && CHART_STOPWORDS.has(raw)) return
    if (TRADE_PLACE_WORDS.has(raw) && !typed && at > 0 && PLACE_PREPOSITIONS.has(words[at - 1].toLowerCase())) return
    const byName = CHART_NAMES[raw] ?? CHART_STOCK_NAMES[raw]
    const pair = chartPairFor(byName ?? raw)
    if (!pair) return
    if (pair.source === 'robinhood' && !byName && !ticker && (raw.length < 4 || ENGLISH_WORD_TICKERS.has(raw))) return
    if (isLiveOnlyHlPair(pair) && !byName && !typed) return
    out.push({ symbol: pair.symbol, at })
  })
  return out
}
