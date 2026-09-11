// Client-safe half of lib/news.ts — types, labels, the age formatter. The
// server module imports node:crypto, so the tab imports THIS.

export type NewsFeed = 'nasdaq' | 'cointelegraph' | 'google-news'

export const NEWS_FEED_LABELS: Record<NewsFeed, string> = {
  nasdaq: 'Nasdaq',
  cointelegraph: 'Cointelegraph',
  'google-news': 'Google News',
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
}

export interface NewsResponse {
  symbol: string
  items: NewsItem[]
  /** The hop that served — or 'none' when every hop came back empty. */
  feed: NewsFeed | 'none'
  /** Unix seconds the cache entry was filled. */
  asOf: number
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
