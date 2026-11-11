// What a scan searches for: the words a post about one asset uses (squad
// called-it, lane JUDGE). The X query OR-s these inside one parenthesis
// (lib/called-it/source builds it), so every term costs reads: a term that
// matches ordinary English ("uni", "link", "near") would bill a scan for
// thousands of posts about nothing. Rules:
//   · the ticker as a cashtag and a hashtag, always;
//   · the bare ticker only when it is not an English word and has 3+ letters;
//   · the asset's name from the chart registry (the name the symbol page
//     shows), unless that name is itself an ordinary word ("Curve", "Maker");
//   · known aliases (curated below);
//   · market proxies (BTC, ETH, the stock indexes) also get the market-call
//     words, because the loudest calls often do not name the asset.
// Pure apart from the registry reads; pinned in scripts/called-judge-pins.ts.
import { chartPairFor, normalizeChartSymbol } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import { ROBINHOOD_TICKER_NAMES } from '@/lib/robinhood-tickers'

/** Tickers that are English words (or read as one in a sentence). Searched only as $X / #X / the project's name. */
export const ENGLISH_WORD_TICKERS: ReadonlySet<string> = new Set([
  'UNI', 'OP', 'NEAR', 'LINK', 'ARB', 'COMP', 'GAS', 'ONE', 'SUI', 'DOT', 'ATOM', 'CRV', 'APT', 'INJ', 'FIL', 'JUP', 'WELL', 'SPX', 'SEI', 'W', 'POL',
  'ZRO', 'TIA', 'ENA', 'DEGEN', 'AERO', 'PEPE', 'WLD', 'JTO', 'STRK', 'PYTH', 'ZEC', 'TOSHI', 'MORPHO', 'EIGEN', 'ONDO', 'MKR', 'SNX', 'LDO',
  'HYPE', 'MEME', 'MOVE', 'PUMP', 'TRUMP', 'AI', 'GOLD', 'SILVER', 'OIL', 'CL', 'GAME', 'MAGIC', 'BLUR', 'ID', 'RENDER', 'IO', 'ME', 'GOAT',
  'F', 'T', 'A', 'C', 'O', 'V', 'X', 'ON', 'RUN', 'NOW', 'SNAP', 'NET', 'BULL', 'TEAM', 'CAT', 'DOG', 'COIN', 'HOOD', 'ALL', 'ARE', 'CAR', 'FUN',
  'FAST', 'PLAY', 'GO', 'HAS', 'IT', 'MAIN', 'BIG', 'KEY', 'LOW', 'HIGH', 'OPEN', 'PATH', 'RACE', 'REAL', 'TRIP', 'WAY', 'ZM', 'NU', 'U', 'Z',
  'GLD', 'SLV', 'USO',
])

/** Names that are ordinary words: a bare search on them reads everything. */
const ENGLISH_WORD_NAMES: ReadonlySet<string> = new Set([
  'curve', 'compound', 'maker', 'optimism', 'polygon', 'cosmos', 'near', 'ripple', 'gold', 'silver', 'oil', 'strategy', 'circle', 'pepe', 'sui',
  'jupiter', 'celestia', 'aptos', 'well', 'zoom', 'snap', 'target', 'block', 'visa', 'ford',
])

/** Curated aliases the registry does not carry. Never a bare English word. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  BTC: ['Bitcoin', 'XBT'],
  ETH: ['Ethereum', 'Ether'],
  SOL: ['Solana'],
  UNI: ['Uniswap'],
  LINK: ['Chainlink'],
  OP: ['Optimism network', 'Optimism token'],
  ARB: ['Arbitrum'],
  NEAR: ['NEAR Protocol'],
  CRV: ['Curve Finance'],
  COMP: ['Compound Finance'],
  MKR: ['MakerDAO'],
  POL: ['Polygon token', 'MATIC'],
  DOGE: ['Dogecoin'],
  HYPE: ['Hyperliquid'],
  SP500: ['S&P 500', 'S&P', 'SPX', 'SPY', 'ES_F'],
  SPY: ['S&P 500', 'S&P'],
  NDX: ['Nasdaq 100', 'Nasdaq', 'QQQ', 'NQ_F'],
  QQQ: ['Nasdaq 100', 'Nasdaq'],
  DJI: ['Dow Jones', 'the Dow'],
  RUT: ['Russell 2000', 'IWM'],
  MSTR: ['MicroStrategy'],
}

/** Symbols whose calls are often calls on the whole market. */
export const MARKET_PROXIES: ReadonlySet<string> = new Set(['BTC', 'ETH', 'SP500', 'SPY', 'NDX', 'QQQ', 'DJI', 'RUT'])

/** The words a market call uses when it does not name the asset. */
export const MARKET_CALL_WORDS: readonly string[] = ['bottom', 'top', 'cycle', 'supercycle', 'capitulation', 'all-time high', 'ath', 'bull', 'bear']

/** The charted spelling: WETH → ETH, `$btc` → BTC. */
export function canonicalSymbol(symbol: string): string {
  const norm = normalizeChartSymbol(symbol)
  return chartPairFor(norm)?.symbol ?? norm
}

export function isMarketProxy(symbol: string): boolean {
  return MARKET_PROXIES.has(canonicalSymbol(symbol))
}

/** "Apple Inc." → "Apple" (a company's corporate tail only narrows the search). */
function trimCompany(raw: string): string {
  return raw
    .replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Ltd\.?|PLC|Holdings|Group|Company|Class [A-C]|N\.V\.|S\.A\.|SE|AG)(\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTerms(sym: string): string[] {
  const out: string[] = []
  const name = trimCompany(ROBINHOOD_TICKER_NAMES[sym] ?? symbolName(sym))
  if (name && name.toUpperCase() !== sym && !ENGLISH_WORD_NAMES.has(name.toLowerCase())) out.push(name)
  return out
}

/** The search terms for one symbol, de-duplicated (case-insensitive), most specific first. */
export function termsFor(symbol: string): string[] {
  const sym = canonicalSymbol(symbol)
  if (!sym) return []
  const terms: string[] = []
  const alpha = /^[A-Z][A-Z0-9]*$/.test(sym)
  if (alpha) terms.push(`$${sym}`, `#${sym}`)
  if (alpha && sym.length >= 3 && !ENGLISH_WORD_TICKERS.has(sym)) terms.push(sym)
  terms.push(...nameTerms(sym))
  terms.push(...(ALIASES[sym] ?? []))
  if (MARKET_PROXIES.has(sym)) terms.push(...MARKET_CALL_WORDS)
  const seen = new Set<string>()
  return terms.filter((t) => {
    const k = t.toLowerCase()
    if (!t.trim() || seen.has(k)) return false
    seen.add(k)
    return true
  })
}
