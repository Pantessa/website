// News for a charted symbol — keyless public feeds, server-fetched, parsed
// by hand (no RSS dependency), normalized to ONE item shape, cached per
// symbol. This is what /api/news serves and what CHART pins to bars.
//
// THE LADDER (every hop probed live 2026-09-11 — squad-markets COMM.md §FEEDS;
// Robinhood's midlands news answers 200 with an EMPTY list to anyone without
// a logged-in session, Yahoo's RSS 404s/429s at the edge before the first
// request, so neither is here):
//   robinhood (tokenized stock) → Nasdaq per-symbol RSS, kept only when the
//                                 item's own <nasdaq:tickers> names the symbol
//                                 (the feed pads unknown symbols with generic
//                                 items) → Google News RSS search
//   coinbase / hyperliquid     → Cointelegraph tag RSS when the coin has a
//                                 tag (404 otherwise) → Google News RSS search
// A hop that errors or yields nothing falls through; `feed` on the response
// names the hop that actually served, never one it fell past (the same
// honesty as the candles proxy's `feed` eyebrow).
//
// Outbound URLs: every item link passes the brand-scan SSRF fence
// (validateBrandUrl — https, default port, public host) or the item is
// dropped; a reader clicks through to a public https page or nothing.
// Text: titles/summaries are entity-decoded and HTML-STRIPPED here — the
// tab renders them as text nodes, never as markup.

import { createHash } from 'node:crypto'
import { validateBrandUrl } from '@/lib/brand-scan'
import { chartPairFor, type ChartPair } from '@/lib/charts'
import { ROBINHOOD_TICKER_NAMES } from '@/lib/robinhood-tickers'

import { type NewsFeed } from '@/lib/news-shared'
export { NEWS_FEED_LABELS, ageLabel, type NewsFeed } from '@/lib/news-shared'

export type { NewsItem, NewsResponse } from '@/lib/news-shared'
import type { NewsItem, NewsResponse } from '@/lib/news-shared'

export const NEWS_LIMIT_DEFAULT = 20
export const NEWS_LIMIT_MAX = 50
export const NEWS_TTL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 6_000
const FEED_MAX_BYTES = 1_500_000
const UA = 'Mozilla/5.0 (compatible; Pantessa/1.0; +https://www.pantessa.com)'
/** Nasdaq's edge closes the socket (HTTP 000) for any UA that isn't a
 *  browser's — probed 2026-09-11 with our honest UA and the compatible form
 *  above. Robinhood's historicals in the candles proxy needed the same
 *  treatment. One hop, one constant; every other feed gets the honest UA. */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// ── text helpers (pure, exported for the harness) ───────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
}

/** Decode the entities RSS actually carries (named + numeric); unknown names stay literal. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
}

/** Markup → text. Tags gone, entities decoded (twice: feeds double-escape
 *  HTML inside description), whitespace collapsed. */
export function stripHtml(s: string): string {
  const once = decodeEntities(s)
  return decodeEntities(once.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Unwrap CDATA and surrounding whitespace from an element's raw inner text. */
function inner(raw: string | undefined): string {
  if (!raw) return ''
  const m = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return (m ? m[1] : raw).trim()
}

function tag(block: string, name: string): string | undefined {
  // Non-greedy element body; the name may carry a namespace prefix as given.
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')
  return block.match(re)?.[1]
}

function attr(block: string, name: string, attrName: string): string | undefined {
  const re = new RegExp(`<${name}\\s[^>]*?${attrName}="([^"]*)"`, 'i')
  return block.match(re)?.[1]
}

export interface RssItem {
  title: string
  link: string
  publishedAt: number | null
  description: string
  /** `<source>` text (Google News) or `dc:creator` — the publisher label. */
  source: string
  /** `<source url>` when present. */
  sourceUrl?: string
  /** Comma-joined `<nasdaq:tickers>`, uppercased, or ''. */
  tickers: string
  imageUrl?: string
}

/** The whole RSS parser: split on <item>, pull the handful of elements we
 *  render. Tolerant by construction — a malformed item yields fewer fields,
 *  never a throw. */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = []
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const b = m[1]
    const title = stripHtml(inner(tag(b, 'title')))
    const link = inner(tag(b, 'link')) || (attr(b, 'guid', 'isPermaLink') === 'true' ? inner(tag(b, 'guid')) : '')
    const pub = inner(tag(b, 'pubDate')) || inner(tag(b, 'dc:date')) || inner(tag(b, 'atom:updated'))
    const t = pub ? Date.parse(pub) : NaN
    const source = stripHtml(inner(tag(b, 'source'))) || stripHtml(inner(tag(b, 'dc:creator')))
    const sourceUrl = attr(b, 'source', 'url')
    const tickers = stripHtml(inner(tag(b, 'nasdaq:tickers'))).toUpperCase()
    const media = attr(b, 'media:content', 'url') ?? attr(b, 'enclosure', 'url')
    items.push({
      title,
      link: decodeEntities(link).trim(),
      publishedAt: Number.isFinite(t) ? Math.floor(t / 1000) : null,
      description: stripHtml(inner(tag(b, 'description'))),
      source,
      sourceUrl: sourceUrl ? decodeEntities(sourceUrl) : undefined,
      tickers,
      imageUrl: media ? decodeEntities(media) : undefined,
    })
  }
  return items
}

/** Google News titles read "Headline - Publisher"; the publisher rides in
 *  <source> too, so the suffix is redundant on the card. */
export function trimPublisherSuffix(title: string, source: string): string {
  if (!source) return title
  const suffix = ` - ${source}`
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

export function newsItemId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12)
}

/** RssItem → NewsItem, or null when it can't be rendered honestly (no title,
 *  no https public link, no date). */
export function normalizeItem(r: RssItem): NewsItem | null {
  if (!r.title || !r.link || r.publishedAt === null) return null
  const gate = validateBrandUrl(r.link)
  if (!gate.ok) return null
  const url = gate.url.toString()
  const source = r.source || safeHost(r.sourceUrl) || gate.url.hostname.replace(/^www\./, '')
  const title = trimPublisherSuffix(r.title, r.source).slice(0, 240)
  // Google News descriptions are the headline again wrapped in an anchor —
  // a summary that repeats the title is noise, drop it.
  const desc = r.description && r.description !== r.title && !r.description.startsWith(title) ? r.description.slice(0, 300) : undefined
  const image = r.imageUrl && validateBrandUrl(r.imageUrl).ok ? r.imageUrl : undefined
  return {
    id: newsItemId(url),
    title,
    url,
    source: source.slice(0, 80),
    publishedAt: r.publishedAt,
    ...(desc ? { summary: desc } : {}),
    ...(image ? { imageUrl: image } : {}),
  }
}

function safeHost(u: string | undefined): string {
  if (!u) return ''
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ── the ladder ──────────────────────────────────────────────────────────────

/** Coins with a Cointelegraph tag feed (probed: ethereum/bitcoin/solana 200,
 *  hyperliquid 404 — an unmapped or wrong tag 404s and falls through, so a
 *  bad guess here costs one hop, never a lie). */
const COINTELEGRAPH_TAGS: Record<string, string> = {
  ETH: 'ethereum', BTC: 'bitcoin', SOL: 'solana', DOGE: 'dogecoin', XRP: 'xrp', ADA: 'cardano',
  AVAX: 'avalanche', DOT: 'polkadot', ATOM: 'cosmos', NEAR: 'near-protocol', LINK: 'chainlink',
  UNI: 'uniswap', AAVE: 'aave', LDO: 'lido', ARB: 'arbitrum', OP: 'optimism', POL: 'polygon',
  SUI: 'sui', APT: 'aptos', TIA: 'celestia', FIL: 'filecoin', WLD: 'worldcoin', PEPE: 'pepe',
  SHIB: 'shiba-inu', ONDO: 'ondo', ENA: 'ethena', HYPE: 'hyperliquid',
}

/** Plain names for the Google News query — a bare ticker like "OP" or "SUI"
 *  matches the English word, the name keeps the search on the coin. */
const COIN_NAMES: Record<string, string> = {
  ETH: 'Ethereum', BTC: 'Bitcoin', SOL: 'Solana', DOGE: 'Dogecoin', XRP: 'XRP', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR Protocol', LINK: 'Chainlink',
  UNI: 'Uniswap', AAVE: 'Aave', LDO: 'Lido', CRV: 'Curve', COMP: 'Compound', MKR: 'Maker',
  SNX: 'Synthetix', MORPHO: 'Morpho', ARB: 'Arbitrum', OP: 'Optimism', POL: 'Polygon', SUI: 'Sui',
  APT: 'Aptos', INJ: 'Injective', TIA: 'Celestia', FIL: 'Filecoin', ONDO: 'Ondo', ENA: 'Ethena',
  PEPE: 'Pepe', SHIB: 'Shiba Inu', WLD: 'Worldcoin', JTO: 'Jito', JUP: 'Jupiter', AERO: 'Aerodrome',
  EIGEN: 'EigenLayer', HYPE: 'Hyperliquid', SYRUP: 'Maple Finance SYRUP', FARTCOIN: 'Fartcoin',
}

export interface NewsHop {
  feed: NewsFeed
  url: string
  /** Post-parse relevance filter (Nasdaq pads unknown symbols with generic items). */
  keep?: (r: RssItem) => boolean
  /** Override the per-item publisher label (Cointelegraph's dc:creator reads
   *  "Cointelegraph by <author>" — the card wants the publisher). */
  sourceLabel?: string
  /** Feeds whose edge only answers a browser UA. */
  browserUa?: boolean
}

/** Company name for a tokenized stock, trimmed of the corporate tail that
 *  only hurts a news query ("Apple Inc." → "Apple"). */
export function stockNewsName(symbol: string): string | null {
  const raw = ROBINHOOD_TICKER_NAMES[symbol]
  if (!raw) return null
  return raw.replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Ltd\.?|PLC|Holdings|Group|Company|Class [A-C])(\s|$)/gi, ' ').replace(/\s+/g, ' ').trim() || null
}

function googleNewsUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
}

/** The ordered hops for a charted symbol. Pure — the harness pins it. */
export function newsLadderFor(pair: ChartPair): NewsHop[] {
  const sym = pair.symbol
  if (pair.source === 'robinhood') {
    // Google first: its targeted query is ABOUT the company; Nasdaq's
    // per-symbol feed tags a ticker onto anything that mentions it (a
    // Motley Fool estate-planning podcast led the AAPL feed 2026-09-11), so
    // it is the fallback, filtered by its own tickers tag.
    const name = stockNewsName(sym)
    return [
      { feed: 'google-news', url: googleNewsUrl(name ? `"${sym}" OR "${name}" stock when:14d` : `"${sym}" stock when:14d`) },
      {
        feed: 'nasdaq',
        url: `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(sym)}`,
        keep: (r) => r.tickers.split(',').map((t) => t.trim()).includes(sym),
        browserUa: true,
      },
    ]
  }
  const hops: NewsHop[] = []
  const tagSlug = COINTELEGRAPH_TAGS[sym]
  if (tagSlug) hops.push({ feed: 'cointelegraph', url: `https://cointelegraph.com/rss/tag/${tagSlug}`, sourceLabel: 'Cointelegraph' })
  const name = COIN_NAMES[sym] ?? sym
  hops.push({ feed: 'google-news', url: googleNewsUrl(`"${name}" ${sym !== name ? sym : ''} crypto when:14d`.replace(/\s+/g, ' ')) })
  return hops
}

// ── fetch + cache ───────────────────────────────────────────────────────────

async function fetchFeed(url: string, browserUa = false): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'User-Agent': browserUa ? BROWSER_UA : UA, Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    })
    if (!res.ok) return null
    // Where it LANDED must still be a public https host (the brand-scan rule).
    if (res.url && !validateBrandUrl(res.url).ok) return null
    const text = await res.text()
    return text.length > FEED_MAX_BYTES ? text.slice(0, FEED_MAX_BYTES) : text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Run one hop: fetch, parse, filter, normalize, dedupe by url, newest first. */
export async function runHop(hop: NewsHop): Promise<NewsItem[]> {
  const xml = await fetchFeed(hop.url, hop.browserUa)
  if (!xml) return []
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const r of parseRss(xml)) {
    if (hop.keep && !hop.keep(r)) continue
    const n = normalizeItem(hop.sourceLabel ? { ...r, source: hop.sourceLabel } : r)
    if (!n || seen.has(n.url)) continue
    seen.add(n.url)
    out.push(n)
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt)
  return out
}

interface CacheEntry {
  at: number
  value: { items: NewsItem[]; feed: NewsFeed | 'none' }
}
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry['value']>>()

async function loadNews(pair: ChartPair): Promise<CacheEntry['value']> {
  for (const hop of newsLadderFor(pair)) {
    const items = await runHop(hop)
    if (items.length > 0) return { items: items.slice(0, NEWS_LIMIT_MAX), feed: hop.feed }
  }
  return { items: [], feed: 'none' }
}

/** Cached news for a charted symbol; null for a chartless one (fail-closed —
 *  the same gate the candles proxy uses, so a symbol with no chart can't
 *  turn this into an open feed proxy). */
export async function getNews(symbolRaw: string, limit = NEWS_LIMIT_DEFAULT): Promise<NewsResponse | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  const key = pair.symbol
  const now = Date.now()
  const hit = cache.get(key)
  let value: CacheEntry['value']
  let at = now
  if (hit && now - hit.at < NEWS_TTL_MS) {
    value = hit.value
    at = hit.at
  } else {
    let p = inflight.get(key)
    if (!p) {
      p = loadNews(pair).finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    value = await p
    // An empty answer is cached too (a dead feed shouldn't be re-hit per
    // click), but for a shorter beat so a transient outage clears itself.
    cache.set(key, { at: value.items.length ? now : now - NEWS_TTL_MS + 60_000, value })
  }
  const n = Math.max(1, Math.min(NEWS_LIMIT_MAX, Math.floor(limit) || NEWS_LIMIT_DEFAULT))
  return { symbol: key, items: value.items.slice(0, n), feed: value.feed, asOf: Math.floor(at / 1000) }
}

/** Test seam: drop the cache (the harness never needs it; local drills do). */
export function clearNewsCache(): void {
  cache.clear()
}
