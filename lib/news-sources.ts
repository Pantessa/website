// The news index's SOURCES (2026-11-18): which feeds are read, which symbols a
// story is about, and how the same story from two feeds becomes one row.
// Pure and server-side; lib/news.ts fetches, lib/news-index.ts stores,
// scripts/news-sources-pins.ts pins every rule here.
//
// TWO KINDS OF FEED.
//   · A SITE feed is a publisher's whole front page (CoinDesk, Decrypt, The
//     Block …). It is read ONCE for every symbol, and each story is filed
//     under the symbols its own headline and summary name (`symbolsInText`).
//     A story that names none is not filed.
//   · A SYMBOL feed is asked about one symbol (Cointelegraph's tag feed,
//     Google News search, Yahoo's per-symbol feed, Nasdaq's). Its stories are
//     filed under that symbol.
//
// Every URL here answered 200 with items to our own honest user agent on
// 2026-11-18. Measured and left out: Blockworks (its feed's newest entry is
// from January), Forbes' section feeds (404; only /business/feed/ answers, so
// Forbes' crypto desk arrives through the Google News "majors" search),
// Reddit (refuses a feed read without its OAuth API).

import { ROBINHOOD_TICKER_NAMES } from '@/lib/robinhood-tickers'
import type { NewsFeed, NewsItem } from '@/lib/news-shared'

// ── the symbol tables ───────────────────────────────────────────────────────

/** Coins with a Cointelegraph tag feed (probed: ethereum/bitcoin/solana 200,
 *  an unmapped or wrong tag 404s and is skipped, so a bad guess here costs
 *  one read, never a lie). */
export const COINTELEGRAPH_TAGS: Record<string, string> = {
  ETH: 'ethereum', BTC: 'bitcoin', SOL: 'solana', DOGE: 'dogecoin', XRP: 'xrp', ADA: 'cardano',
  AVAX: 'avalanche', DOT: 'polkadot', ATOM: 'cosmos', NEAR: 'near-protocol', LINK: 'chainlink',
  UNI: 'uniswap', AAVE: 'aave', LDO: 'lido', ARB: 'arbitrum', OP: 'optimism', POL: 'polygon',
  SUI: 'sui', APT: 'aptos', TIA: 'celestia', FIL: 'filecoin', WLD: 'worldcoin', PEPE: 'pepe',
  SHIB: 'shiba-inu', ONDO: 'ondo', ENA: 'ethena', HYPE: 'hyperliquid',
}

/** Plain names for the Google News query — a bare ticker like "OP" or "SUI"
 *  matches the English word, the name keeps the search on the coin. */
export const COIN_NAMES: Record<string, string> = {
  ETH: 'Ethereum', BTC: 'Bitcoin', SOL: 'Solana', DOGE: 'Dogecoin', XRP: 'XRP', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR Protocol', LINK: 'Chainlink',
  UNI: 'Uniswap', AAVE: 'Aave', LDO: 'Lido', CRV: 'Curve', COMP: 'Compound', MKR: 'Maker',
  SNX: 'Synthetix', MORPHO: 'Morpho', ARB: 'Arbitrum', OP: 'Optimism', POL: 'Polygon', SUI: 'Sui',
  APT: 'Aptos', INJ: 'Injective', TIA: 'Celestia', FIL: 'Filecoin', ONDO: 'Ondo', ENA: 'Ethena',
  PEPE: 'Pepe', SHIB: 'Shiba Inu', WLD: 'Worldcoin', JTO: 'Jito', JUP: 'Jupiter', AERO: 'Aerodrome',
  EIGEN: 'EigenLayer', HYPE: 'Hyperliquid', SYRUP: 'Maple Finance SYRUP', FARTCOIN: 'Fartcoin',
}

/** Company name for a tokenized stock, trimmed of the corporate tail that
 *  only hurts a news query ("Apple Inc." → "Apple"). */
export function stockNewsName(symbol: string): string | null {
  const raw = ROBINHOOD_TICKER_NAMES[symbol]
  if (!raw) return null
  return raw.replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Ltd\.?|PLC|Holdings|Group|Company|Class [A-C])(\s|$)/gi, ' ').replace(/\s+/g, ' ').trim() || null
}

// ── which symbols a story names ─────────────────────────────────────────────

/** What a site feed mostly writes about: it picks the matcher its stories go through. */
export type FeedDesk = 'crypto' | 'markets'

/** The phrases that mean a coin where its plain name is also an English word
 *  or a different thing ("Optimism returns to markets", "compound interest").
 *  These REPLACE the name; the ticker rule below still applies. */
const COIN_PHRASES: Record<string, string[]> = {
  NEAR: ['NEAR Protocol', 'Near Protocol'],
  MKR: ['MakerDAO', 'Maker DAO', 'Sky Protocol'],
  COMP: ['Compound Finance', 'Compound Labs'],
  CRV: ['Curve Finance', 'Curve DAO'],
  OP: ['OP Mainnet', 'OP Stack', 'Optimism Foundation', 'Optimism Collective', 'Optimism Superchain', 'on Optimism', "Optimism's"],
  SYRUP: ['Maple Finance'],
  XRP: ['XRP', 'Ripple'],
  SHIB: ['Shiba Inu'],
}

/** Tickers that are also something else in capitals (an APT is a hacking
 *  group, DOGE was a government office): these need the name or a cashtag. */
const BARE_TICKER_BLOCK = new Set(['APT', 'DOGE'])

/** Company names that are also plain words or generic phrases: the ticker patterns still file them. */
const STOCK_NAME_BLOCK = new Set(['Strategy', 'Snap', 'Zoom', 'Nu', 'Pons', 'Carnival', 'Celsius', 'Coherent', 'Quantum Computing', 'Cash Cat', 'RVI', 'AXT', 'KLA', 'Futu'])

/** What headlines call a company when it is not the registered name. */
const STOCK_ALIASES: Record<string, string[]> = {
  META: ['Meta'], GOOGL: ['Google'], F: ['Ford'], MSTR: ['MicroStrategy'], TSM: ['TSMC'], ARM: ['Arm Holdings'], PLTR: ['Palantir'],
  MU: ['Micron'], CSCO: ['Cisco'], IBM: ['IBM'], SMCI: ['Super Micro', 'Supermicro'], XOM: ['Exxon'], LLY: ['Lilly'], NVDA: ['Nvidia'],
}

/** Coins a markets desk (CNBC, MarketWatch, Forbes) names by their plain name. */
const HOUSEHOLD_COINS = ['BTC', 'ETH', 'SOL', 'XRP']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A phrase as a whole-word, case-sensitive pattern. `\b` fails beside a non-word edge ("e.l.f."), so the edges are spelled out. */
const whole = (phrase: string) => `(?<![A-Za-z0-9])${esc(phrase)}(?![A-Za-z0-9])`

interface Matcher {
  symbol: string
  re: RegExp
}

function coinMatcher(symbol: string): Matcher {
  const name = COIN_NAMES[symbol]
  const phrases = COIN_PHRASES[symbol] ?? (name ? [name] : [])
  const parts = phrases.map(whole)
  // The ticker in capitals as its own word (never "ETHDenver"), three letters or more; a cashtag at any length.
  if (symbol.length >= 3 && !BARE_TICKER_BLOCK.has(symbol)) parts.push(whole(symbol))
  parts.push(`\\$${esc(symbol)}(?![A-Za-z0-9])`)
  return { symbol, re: new RegExp(parts.join('|')) }
}

function stockMatcher(symbol: string): Matcher {
  const t = esc(symbol)
  // $AAPL, (AAPL), NASDAQ: AAPL — the ways a markets desk writes a ticker.
  const parts = [`\\$${t}(?![A-Za-z0-9])`, `\\(${t}\\)`, `(?:NASDAQ|NYSE|AMEX|Nasdaq)\\s*:\\s*${t}(?![A-Za-z0-9])`]
  const name = stockNewsName(symbol)
  if (name && name.length >= 4 && !STOCK_NAME_BLOCK.has(name)) parts.push(whole(name))
  for (const a of STOCK_ALIASES[symbol] ?? []) parts.push(whole(a))
  return { symbol, re: new RegExp(parts.join('|')) }
}

let matchers: { coins: Matcher[]; household: Matcher[]; stocks: Matcher[] } | null = null
function allMatchers() {
  if (!matchers) {
    const coins = Object.keys(COIN_NAMES).map(coinMatcher)
    matchers = { coins, household: coins.filter((m) => HOUSEHOLD_COINS.includes(m.symbol)), stocks: Object.keys(ROBINHOOD_TICKER_NAMES).map(stockMatcher) }
  }
  return matchers
}

/** The symbols a story's own words name, as that desk writes them. A crypto
 *  desk's story is read for every coin; a markets desk's for every listed
 *  stock and the household coins. Pure. */
export function symbolsInText(text: string, desk: FeedDesk): string[] {
  const m = allMatchers()
  const set = desk === 'crypto' ? m.coins : [...m.stocks, ...m.household]
  const out: string[] = []
  for (const x of set) if (x.re.test(text)) out.push(x.symbol)
  return out
}

/** Does this text name this one coin? (The filter on a per-symbol feed that pads with related stories.) */
export function namesCoin(text: string, symbol: string): boolean {
  return coinMatcher(symbol).re.test(text)
}

/** Does this text name this one stock? Looser than the site-feed rule: the
 *  feed was already asked about the symbol, so its bare ticker counts too. */
export function namesStock(text: string, symbol: string): boolean {
  return stockMatcher(symbol).re.test(text) || (symbol.length >= 3 && new RegExp(whole(symbol)).test(text))
}

/** The headline test for a feed that was asked about ONE symbol and answers
 *  with whatever mentions it anywhere (measured 2026-11-18: Google News'
 *  majors search for "Bitcoin" led with a WSJ story on U.K. inflation, Yahoo's
 *  NVDA feed with a Red Cat earnings piece). Null where we hold no name to
 *  test with (a coin outside COIN_NAMES, a company whose name is a plain
 *  word): that feed is kept whole. */
export function headlineTestFor(symbol: string, kind: 'coin' | 'stock'): ((title: string) => boolean) | null {
  if (kind === 'coin') return COIN_NAMES[symbol] ? (t) => namesCoin(t, symbol) : null
  const name = stockNewsName(symbol)
  const named = (!!name && name.length >= 4 && !STOCK_NAME_BLOCK.has(name)) || !!STOCK_ALIASES[symbol]
  return named ? (t) => namesStock(t, symbol) : null
}

// ── the site feeds ──────────────────────────────────────────────────────────

export interface SiteFeed {
  /** Unique: the index's state row is `site:<key>`. */
  key: string
  feed: NewsFeed
  url: string
  desk: FeedDesk
  /** Every story of this feed is filed under these too (a single-subject publisher). */
  always?: string[]
}

export const SITE_FEEDS: readonly SiteFeed[] = [
  { key: 'cointelegraph', feed: 'cointelegraph', url: 'https://cointelegraph.com/rss', desk: 'crypto' },
  { key: 'coindesk', feed: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', desk: 'crypto' },
  { key: 'decrypt', feed: 'decrypt', url: 'https://decrypt.co/feed', desk: 'crypto' },
  { key: 'theblock', feed: 'theblock', url: 'https://www.theblock.co/rss.xml', desk: 'crypto' },
  { key: 'dlnews', feed: 'dlnews', url: 'https://www.dlnews.com/arc/outboundfeeds/rss/', desk: 'crypto' },
  { key: 'defiant', feed: 'defiant', url: 'https://thedefiant.io/api/feed', desk: 'crypto' },
  { key: 'cryptoslate', feed: 'cryptoslate', url: 'https://cryptoslate.com/feed/', desk: 'crypto' },
  { key: 'bitcoin-magazine', feed: 'bitcoin-magazine', url: 'https://bitcoinmagazine.com/feed', desk: 'crypto', always: ['BTC'] },
  { key: 'cnbc-crypto', feed: 'cnbc', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', desk: 'crypto' },
  { key: 'cnbc-markets', feed: 'cnbc', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', desk: 'markets' },
  { key: 'marketwatch', feed: 'marketwatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', desk: 'markets' },
  { key: 'benzinga', feed: 'benzinga', url: 'https://www.benzinga.com/feed', desk: 'markets' },
  { key: 'forbes', feed: 'forbes', url: 'https://www.forbes.com/business/feed/', desk: 'markets' },
]

/** The publishers the "majors" search asks Google News for by site (Forbes'
 *  own section feeds 404, Reuters and Bloomberg publish none). */
export const MAJOR_SITES = ['forbes.com', 'reuters.com', 'bloomberg.com', 'cnbc.com', 'wsj.com', 'ft.com', 'fortune.com', 'barrons.com'] as const

// ── one story, once ─────────────────────────────────────────────────────────

/** Feeds that carry other publishers' stories: the publisher's own row wins over theirs. */
const AGGREGATORS: ReadonlySet<NewsFeed> = new Set<NewsFeed>(['google-news', 'google-majors', 'yahoo', 'nasdaq'])

/** A headline reduced to what survives a re-print: lower case, letters and digits, single spaces. */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

/** A key this short ("Markets wrap") is a column name, not a story: it never merges two rows. */
export const TITLE_KEY_MIN = 16

function rowRank(it: NewsItem): number {
  return (it.feed && AGGREGATORS.has(it.feed) ? 0 : 2) + (it.imageUrl ? 1 : 0)
}

/** Many feeds' rows → one page: a story two feeds both carry is kept ONCE
 *  (the publisher's own row over an aggregator's, a pictured row over a bare
 *  one, then the earlier print), newest first. Nothing is ranked by anything
 *  but its time. Pure. */
export function mergeNews(items: readonly NewsItem[]): NewsItem[] {
  const byKey = new Map<string, NewsItem>()
  for (const it of items) {
    const tk = titleKey(it.title)
    const key = tk.length >= TITLE_KEY_MIN ? `t:${tk}` : `i:${it.id}`
    const had = byKey.get(key) ?? byKey.get(`i:${it.id}`)
    if (!had) {
      byKey.set(key, it)
      continue
    }
    const better = rowRank(it) > rowRank(had) || (rowRank(it) === rowRank(had) && it.publishedAt < had.publishedAt)
    if (better) byKey.set(key, it)
  }
  // The same URL can sit under a title key and an id key: one row per id.
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const it of byKey.values()) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt || (a.id < b.id ? -1 : 1))
  return out
}

/** The feeds behind a page, most stories first. */
export function feedCounts(items: readonly NewsItem[]): NewsFeed[] {
  const by = new Map<NewsFeed, number>()
  for (const it of items) if (it.feed) by.set(it.feed, (by.get(it.feed) ?? 0) + 1)
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f)
}
