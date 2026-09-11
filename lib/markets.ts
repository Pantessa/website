// MARKETS — the shell's pure helpers (client-safe, no I/O). The /markets
// index and the /t/<symbol> frame read everything here; the chart engine,
// quotes, technicals, news and posts are other lanes' contracts
// (squad-markets-2026-09-11/README.md) and are NOT re-implemented here.
//
// Symbol identity is the existing `chartPairFor` (lib/charts.ts): a symbol
// this module lists must resolve there, or it never gets a row (pinned in
// the harness — a dead ticker must fail a gate, not render a dash forever).

import { chartPairFor, parseChartAsk, type Candle, type ChartPair, type ChartSource } from '@/lib/charts'
import { ROBINHOOD_TICKERS, ROBINHOOD_TICKER_NAMES } from '@/lib/robinhood-tickers'

// ── Sections ────────────────────────────────────────────────────────────────

export type MarketSectionId = 'equities' | 'crypto' | 'perps'

export interface MarketRow {
  symbol: string
  name: string
  source: ChartSource
}

export interface MarketSection {
  id: MarketSectionId
  title: string
  /** One line under the title — the venue + what "open" means there. */
  blurb: string
  rows: MarketRow[]
}

/** Coin names for the crypto majors the resolver charts. Curated — the
 *  resolver's own name map runs the other way (speech → symbol) and is
 *  private to lib/charts on purpose. Every key must clear chartPairFor. */
export const COIN_NAMES: Readonly<Record<string, string>> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  XRP: 'XRP',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  DOT: 'Polkadot',
  UNI: 'Uniswap',
  AAVE: 'Aave',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  POL: 'Polygon',
  NEAR: 'NEAR',
  ATOM: 'Cosmos',
  SUI: 'Sui',
  APT: 'Aptos',
  LDO: 'Lido',
  MKR: 'Maker',
  CRV: 'Curve',
  COMP: 'Compound',
  SNX: 'Synthetix',
  MORPHO: 'Morpho',
  INJ: 'Injective',
  TIA: 'Celestia',
  FIL: 'Filecoin',
  ONDO: 'Ondo',
  ENA: 'Ethena',
  PEPE: 'Pepe',
  SHIB: 'Shiba Inu',
  WLD: 'Worldcoin',
  JTO: 'Jito',
  JUP: 'Jupiter',
  AERO: 'Aerodrome',
  EIGEN: 'EigenLayer',
  HYPE: 'Hyperliquid',
  SYRUP: 'Maple',
  FARTCOIN: 'Fartcoin',
}

/** The crypto board's order — majors first, then the DeFi names the wallet
 *  layers already act on (Aave, Lido, Morpho, Uniswap…). */
const CRYPTO_ORDER = [
  'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'SUI', 'APT', 'NEAR', 'ATOM',
  'ARB', 'OP', 'POL', 'UNI', 'AAVE', 'LDO', 'MORPHO', 'MKR', 'CRV', 'COMP', 'SNX', 'INJ', 'TIA',
  'FIL', 'ONDO', 'ENA', 'PEPE', 'SHIB', 'WLD', 'JTO', 'JUP', 'AERO', 'EIGEN',
]

/** HL-only perp listings (majors chart on Coinbase spot and are not
 *  repeated here — the row's venue chip says where the candles come from). */
const PERP_ORDER = ['HYPE', 'SYRUP', 'FARTCOIN']

/** The rows a section shows, each already cleared by the resolver. A listed
 *  ticker the resolver refuses (feedless, delisted) is DROPPED, never dashed. */
function rowsFor(symbols: readonly string[], source: ChartSource, nameOf: (s: string) => string | undefined): MarketRow[] {
  const out: MarketRow[] = []
  for (const s of symbols) {
    const pair = chartPairFor(s)
    if (!pair || pair.source !== source || pair.symbol !== s) continue
    out.push({ symbol: s, name: nameOf(s) ?? s, source })
  }
  return out
}

/** Symbols a section's header strip leads with — the household names. */
export const FEATURED: Readonly<Record<MarketSectionId, readonly string[]>> = {
  equities: ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY'],
  crypto: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LINK'],
  perps: ['HYPE', 'SYRUP', 'FARTCOIN'],
}

export function marketSections(): MarketSection[] {
  const equities = rowsFor(
    ROBINHOOD_TICKERS.map(([s]) => s),
    'robinhood',
    (s) => ROBINHOOD_TICKER_NAMES[s],
  )
  // Featured names lead the table; the rest stay A→Z under them.
  const lead = FEATURED.equities.filter((s) => equities.some((r) => r.symbol === s))
  const equitiesOrdered = [
    ...lead.map((s) => equities.find((r) => r.symbol === s)!),
    ...equities.filter((r) => !lead.includes(r.symbol)),
  ]
  return [
    {
      id: 'equities',
      title: 'Digital equities, 24/7',
      blurb: 'Tokenized stocks on Robinhood Chain. The token trades around the clock; the NYSE tape it tracks keeps its hours.',
      rows: equitiesOrdered,
    },
    {
      id: 'crypto',
      title: 'Crypto',
      blurb: 'Spot majors and the DeFi names your wallet already acts on. Coinbase candles, Uniswap and CoW fills.',
      rows: rowsFor(CRYPTO_ORDER, 'coinbase', (s) => COIN_NAMES[s]),
    },
    {
      id: 'perps',
      title: 'Perps',
      blurb: 'Hyperliquid listings with no spot book here. Long or short with a stop the Guardian watches for you.',
      rows: rowsFor(PERP_ORDER, 'hyperliquid', (s) => COIN_NAMES[s]),
    },
  ]
}

/** Display name for any charted symbol (company for stocks, coin otherwise). */
export function symbolName(symbol: string): string {
  const pair = chartPairFor(symbol)
  const sym = pair?.symbol ?? symbol.toUpperCase()
  return ROBINHOOD_TICKER_NAMES[sym] ?? COIN_NAMES[sym] ?? sym
}

// ── Venue + session ─────────────────────────────────────────────────────────

/** The venue chip beside the symbol — where the token actually trades. */
export function venueLabel(pair: ChartPair | null): string {
  if (!pair) return 'Not charted yet'
  if (pair.source === 'robinhood') return 'Robinhood Chain · 24/7'
  if (pair.source === 'hyperliquid') return 'Hyperliquid perps'
  return 'Coinbase spot'
}

export interface SessionState {
  /** What the token itself does. Stocks: on-chain 24/7. Crypto/perps: 24/7. */
  token: '24/7'
  /** The underlying tape (NYSE) for stocks; null for crypto. */
  tape: { open: boolean; reopens: string | null } | null
  /** The one-line copy the header prints. */
  line: string
}

const ET = 'America/New_York'
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Wall-clock parts in New York for an instant. */
function etParts(d: Date): { dow: number; h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const dow = DOW.indexOf(get('weekday'))
  // 'hour' can print "24" at midnight in some engines — fold it.
  const h = Number(get('hour')) % 24
  const m = Number(get('minute'))
  return { dow, h, m }
}

/** NYSE regular session: Mon–Fri 09:30–16:00 ET. Holidays are NOT modelled
 *  (the copy says "reopens", never a promise about a specific day's tape). */
export function nyseSession(now: Date = new Date()): { open: boolean; reopens: string | null } {
  const { dow, h, m } = etParts(now)
  const mins = h * 60 + m
  const weekday = dow >= 1 && dow <= 5
  const open = weekday && mins >= 9 * 60 + 30 && mins < 16 * 60
  if (open) return { open: true, reopens: null }
  // Next open: today at 9:30 if it's a weekday before the bell, else the
  // next weekday's 9:30.
  let nextDow = dow
  if (!(weekday && mins < 9 * 60 + 30)) {
    do {
      nextDow = (nextDow + 1) % 7
    } while (nextDow === 0 || nextDow === 6)
  }
  const dayWord = nextDow === dow ? 'today' : DOW[nextDow]
  return { open: false, reopens: `${dayWord} 9:30 ET` }
}

export function sessionState(pair: ChartPair | null, now: Date = new Date()): SessionState {
  if (pair?.source === 'robinhood') {
    const tape = nyseSession(now)
    const line = tape.open
      ? 'Token trades 24/7 on Robinhood Chain · NYSE open'
      : `Token trades 24/7 on Robinhood Chain · NYSE closed, reopens ${tape.reopens}`
    return { token: '24/7', tape, line }
  }
  if (pair?.source === 'hyperliquid') return { token: '24/7', tape: null, line: 'Perp trades 24/7 on Hyperliquid' }
  if (pair) return { token: '24/7', tape: null, line: 'Spot trades 24/7' }
  return { token: '24/7', tape: null, line: 'No candle feed yet — still tradable in chat' }
}

// ── Tab strip (the #705 idiom: ?tab= mirrored via replaceState) ─────────────

export type MarketTab = 'overview' | 'news' | 'community' | 'technicals' | 'trade'

export const MARKET_TABS: { tab: MarketTab; label: string }[] = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'news', label: 'News' },
  { tab: 'community', label: 'Community' },
  { tab: 'technicals', label: 'Technicals' },
  { tab: 'trade', label: 'Trade' },
]

export const DEFAULT_MARKET_TAB: MarketTab = 'overview'

export function parseMarketTab(search: string): MarketTab {
  const raw = new URLSearchParams(search).get('tab')
  return raw && MARKET_TABS.some((t) => t.tab === raw) ? (raw as MarketTab) : DEFAULT_MARKET_TAB
}

/** The URL for a tab, preserving every other param; the default tab drops
 *  the param so /t/AAPL and /t/AAPL?tab=overview are the same address. */
export function marketTabUrl(tab: MarketTab, pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  if (tab === DEFAULT_MARKET_TAB) params.delete('tab')
  else params.set('tab', tab)
  const q = params.toString()
  return q ? `${pathname}?${q}` : pathname
}

/** replaceState, not router.replace — UI state catching the URL up, not a
 *  navigation (see lib/app-tab-url for why the `null` state matters). */
export function syncMarketTab(tab: MarketTab): void {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  const next = marketTabUrl(tab, pathname, search)
  if (next === `${pathname}${search}`) return
  window.history.replaceState(null, '', next)
}

// ── Performance tiles (client-side from the existing candles endpoint) ─────
// The CHART lane ships lib/performance.ts; until then the Overview tab
// derives the same numbers from daily candles. Each tile is the percent
// move from the close nearest the span's start to the latest close, null
// when the series doesn't reach that far (Coinbase serves ~300 daily bars,
// so 1Y is honestly blank there).

export type PerfSpan = '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y'
export const PERF_SPANS: PerfSpan[] = ['1W', '1M', '3M', '6M', 'YTD', '1Y']

const DAY = 86_400

function spanStart(span: PerfSpan, nowSec: number): number {
  switch (span) {
    case '1W':
      return nowSec - 7 * DAY
    case '1M':
      return nowSec - 30 * DAY
    case '3M':
      return nowSec - 91 * DAY
    case '6M':
      return nowSec - 182 * DAY
    case '1Y':
      return nowSec - 365 * DAY
    case 'YTD': {
      const d = new Date(nowSec * 1000)
      return Math.floor(Date.UTC(d.getUTCFullYear(), 0, 1) / 1000)
    }
  }
}

export function performanceFromCandles(
  candles: Candle[],
  nowSec = Math.floor(Date.now() / 1000),
): Record<PerfSpan, number | null> {
  const out = {} as Record<PerfSpan, number | null>
  const sorted = [...candles].sort((a, b) => a.t - b.t)
  const last = sorted[sorted.length - 1]
  for (const span of PERF_SPANS) {
    out[span] = null
    if (!last || sorted.length < 2) continue
    const start = spanStart(span, nowSec)
    // The series must actually reach back to the span's start (one bar of
    // slack): a 1Y tile computed from a 300-bar series would be a lie.
    if (sorted[0].t > start + DAY) continue
    // Closest bar at or before the start, else the first bar after it.
    let ref: Candle | null = null
    for (const c of sorted) {
      if (c.t <= start) ref = c
      else break
    }
    if (!ref) ref = sorted.find((c) => c.t >= start) ?? null
    if (!ref || !(ref.c > 0)) continue
    out[span] = ((last.c - ref.c) / ref.c) * 100
  }
  return out
}

/** 24h range + volume from an hourly series — "key stats" on the Overview. */
export function stats24h(candles: Candle[], nowSec = Math.floor(Date.now() / 1000)): { high: number; low: number; volume: number } | null {
  const window = candles.filter((c) => c.t >= nowSec - DAY)
  if (window.length < 2) return null
  let high = -Infinity
  let low = Infinity
  let volume = 0
  for (const c of window) {
    if (c.h > high) high = c.h
    if (c.l < low) low = c.l
    volume += Number.isFinite(c.v) ? c.v : 0
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null
  return { high, low, volume }
}

// ── Search + the chat/voice door ────────────────────────────────────────────

/** Resolve a typed query ("apple", "$COIN", "eth") to a charted pair, or
 *  null. Reuses the chart-ask resolver (company names, ticker rules) by
 *  phrasing the query as a chart ask — lib/charts.ts is the CHART lane's
 *  file, so its private name maps are reached through the public parser. */
export function resolveTickerQuery(query: string): ChartPair | null {
  const q = query.trim()
  if (!q || q.length > 40) return null
  const direct = chartPairFor(q)
  if (direct) return direct
  const ask = parseChartAsk(`show me the ${q} chart`)
  return ask?.pair ?? null
}

/** "open apple in markets", "markets aapl", "take me to the ETH market page"
 *  → the /t/<symbol> address. Null when it isn't a markets-navigation ask
 *  (a chart word alone stays the overlay's; a money verb stays the action
 *  layers'). Zero turns: the caller navigates. */
const MARKETS_WORD_RE = /\bmarkets?\b/i
const MARKETS_VERB_RE = /\b(?:buy|sell|swap|send|transfer|stake|unstake|supply|withdraw|borrow|repay|bridge|deposit|dca|long|short|protect|tile|rebalance|mint|list)\b/i

export function parseMarketsNavAsk(message: string): { symbol: string; href: string } | null {
  const text = message.trim()
  if (!text || text.length > 120 || !MARKETS_WORD_RE.test(text) || MARKETS_VERB_RE.test(text)) return null
  // "markets aapl" / "open apple in markets" / "aapl markets page" — strip
  // the markets words + fillers, resolve what's left as a ticker query.
  const rest = text
    .replace(MARKETS_WORD_RE, ' ')
    .replace(/\b(?:open|go\s+to|take\s+me\s+to|show\s+me|show|pull\s+up|bring\s+up|in|on|the|page|for|to|view|see|please|of)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!rest) return null
  const pair = resolveTickerQuery(rest)
  if (!pair) return null
  return { symbol: pair.symbol, href: `/t/${pair.symbol}` }
}
