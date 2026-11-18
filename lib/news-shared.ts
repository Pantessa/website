// Client-safe half of lib/news.ts — types, labels, the age formatter. The
// server module imports node:crypto, so the tab imports THIS.

/** Every feed the news index reads (lib/news-sources.ts is the registry). */
export type NewsFeed =
  | 'nasdaq'
  | 'cointelegraph'
  | 'google-news'
  | 'google-majors'
  | 'yahoo'
  | 'coindesk'
  | 'decrypt'
  | 'theblock'
  | 'dlnews'
  | 'defiant'
  | 'cryptoslate'
  | 'bitcoin-magazine'
  | 'cnbc'
  | 'marketwatch'
  | 'benzinga'
  | 'forbes'

export const NEWS_FEED_LABELS: Record<NewsFeed, string> = {
  nasdaq: 'Nasdaq',
  cointelegraph: 'Cointelegraph',
  'google-news': 'Google News',
  'google-majors': 'Google News',
  yahoo: 'Yahoo Finance',
  coindesk: 'CoinDesk',
  decrypt: 'Decrypt',
  theblock: 'The Block',
  dlnews: 'DL News',
  defiant: 'The Defiant',
  cryptoslate: 'CryptoSlate',
  'bitcoin-magazine': 'Bitcoin Magazine',
  cnbc: 'CNBC',
  marketwatch: 'MarketWatch',
  benzinga: 'Benzinga',
  forbes: 'Forbes',
}

export interface NewsItem {
  /** Stable per URL — sha1(url)[:12] — so "show on chart" state survives a refetch. */
  id: string
  title: string
  url: string
  /** Publisher name as the feed reports it (never a display name we invent). */
  source: string
  /** Unix seconds. */
  publishedAt: number
  summary?: string
  imageUrl?: string
  /** The feed this row was read from (a Google News row names its publisher in `source`). */
  feed?: NewsFeed
}

/** One publisher on the page and how many of its stories are there. */
export interface NewsSourceCount {
  source: string
  count: number
}

export interface NewsResponse {
  symbol: string
  items: NewsItem[]
  /** The feed with the most stories on the page — or 'none' when every feed came back empty. */
  feed: NewsFeed | 'none'
  /** Every feed with at least one story on the page, most stories first. */
  feeds?: NewsFeed[]
  /** The publishers on the page, most stories first. */
  sources?: NewsSourceCount[]
  /** Where the page was read from: the shared index, or the feeds directly (no database). */
  via?: 'index' | 'direct'
  /** Unix seconds the newest feed read behind this page finished. */
  asOf: number
}

/** The publishers behind a list of stories, most stories first, names A to Z inside a tie. Pure. */
export function sourceCounts(items: readonly Pick<NewsItem, 'source'>[]): NewsSourceCount[] {
  const by = new Map<string, number>()
  for (const it of items) by.set(it.source, (by.get(it.source) ?? 0) + 1)
  return [...by.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
}

/** Coarse "3h ago" for the card — pure. */
export function ageLabel(publishedAt: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const d = Math.max(0, nowSec - publishedAt)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`
  return new Date(publishedAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
