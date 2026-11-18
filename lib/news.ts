// News for a charted symbol — keyless public feeds, server-fetched, parsed
// by hand (no RSS dependency), normalized to ONE item shape. This is what
// /api/news serves and what CHART pins to bars.
//
// MANY FEEDS, ONE PAGE (2026-11-18). Until then this was a ladder: the first
// feed with a story served alone, so a coin's page was Cointelegraph and
// nothing else. Now every feed is read and merged:
//   · SITE feeds (lib/news-sources SITE_FEEDS: CoinDesk, Decrypt, The Block,
//     DL News, The Defiant, CryptoSlate, Bitcoin Magazine, Cointelegraph,
//     CNBC, MarketWatch, Benzinga, Forbes) are read once for every symbol and
//     each story is filed under the symbols its headline names;
//   · SYMBOL feeds (newsFeedsFor) are asked about the one symbol: a coin gets
//     Cointelegraph's tag feed, Google News, the Google News "majors" search
//     (Forbes, Reuters, Bloomberg, CNBC, WSJ, FT, Fortune, Barron's) and
//     Yahoo; a stock gets Google News, the majors, Yahoo and Nasdaq.
//
// INDEXED, NOT FETCHED PER CLICK. Stories live in Postgres (lib/news-index).
// A cron re-reads the site feeds every 10 minutes whether or not anyone is
// looking; a symbol's own feeds are re-read when a reader finds them older
// than 10 minutes. A click is one indexed read. With no database (or before
// the tables exist) the same feeds are read directly and merged in memory.
//
// Outbound URLs: every item link passes the brand-scan SSRF fence
// (validateBrandUrl — https, default port, public host) or the item is
// dropped; a reader clicks through to a public https page or nothing.
// Text: titles/summaries are entity-decoded and HTML-STRIPPED here — the
// tab renders them as text nodes, never as markup.

import { createHash } from 'node:crypto'
import { validateBrandUrl } from '@/lib/brand-scan'
import { chartPairFor, type ChartPair } from '@/lib/charts'
import { claimFeed, feedStates, newsIndexOn, readSymbol, settleFeed, storeItems, type FiledItem } from '@/lib/news-index'
import { COINTELEGRAPH_TAGS, COIN_NAMES, MAJOR_SITES, SITE_FEEDS, feedCounts, mergeNews, headlineTestFor, stockNewsName, symbolsInText, type SiteFeed } from '@/lib/news-sources'
import { NEWS_FEED_LABELS, sourceCounts, type NewsFeed } from '@/lib/news-shared'

export { NEWS_FEED_LABELS, ageLabel, type NewsFeed } from '@/lib/news-shared'
export { stockNewsName } from '@/lib/news-sources'

export type { NewsItem, NewsResponse } from '@/lib/news-shared'
import type { NewsItem, NewsResponse } from '@/lib/news-shared'

export const NEWS_LIMIT_DEFAULT = 20
export const NEWS_LIMIT_MAX = 100
const FETCH_TIMEOUT_MS = 6_000
const FEED_MAX_BYTES = 1_500_000
/** Rows read from one feed, and the bytes of one row (review F9, F11): a publisher's feed is 10 to 100 rows of a few KB. */
export const FEED_MAX_ITEMS = 200
const ITEM_MAX_BYTES = 40_000
/** A link or picture URL longer than this is not one we store. */
const URL_MAX = 2_000
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
    .replace(/&([a-z]+);/gi, (m, name: string) => (Object.hasOwn(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : m))
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
  // Walk by position (review F9): a lazy `<item>…</item>` regex is quadratic
  // on a body of unclosed openers, and a feed is 1.5 MB of someone else's text.
  let at = 0
  while (items.length < FEED_MAX_ITEMS) {
    const open = xml.indexOf('<item', at)
    if (open < 0) break
    // `<itemref` and friends are not an item.
    if (!/[\s>]/.test(xml[open + 5] ?? '')) {
      at = open + 5
      continue
    }
    const bodyStart = xml.indexOf('>', open)
    const close = bodyStart < 0 ? -1 : xml.indexOf('</item>', bodyStart)
    if (close < 0) break
    at = close + 7
    const b = xml.slice(bodyStart + 1, Math.min(close, bodyStart + 1 + ITEM_MAX_BYTES))
    const title = stripHtml(inner(tag(b, 'title')))
    const link = inner(tag(b, 'link')) || (attr(b, 'guid', 'isPermaLink') === 'true' ? inner(tag(b, 'guid')) : '')
    const pub = inner(tag(b, 'pubDate')) || inner(tag(b, 'dc:date')) || inner(tag(b, 'atom:updated'))
    const t = pub ? Date.parse(pub) : NaN
    const source = stripHtml(inner(tag(b, 'source'))) || stripHtml(inner(tag(b, 'dc:creator')))
    const sourceUrl = attr(b, 'source', 'url')
    const tickers = stripHtml(inner(tag(b, 'nasdaq:tickers'))).toUpperCase()
    const media = attr(b, 'media:content', 'url') ?? attr(b, 'media:thumbnail', 'url') ?? attr(b, 'enclosure', 'url')
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

/** Text as Postgres and JSON both take it (review F4): no NUL, and a cut that
 *  split a surrogate pair is repaired, so one odd headline can never refuse a
 *  whole feed's batch. */
export function storable(s: string, max: number): string {
  return s.replace(/\u0000/g, '').slice(0, max).toWellFormed().trim()
}

/** A story dated further ahead than this is a feed's mistake (review F2): it
 *  would sort first and never age out. */
export const FUTURE_SLACK_SEC = 600

/** RssItem → NewsItem, or null when it can't be rendered honestly (no title,
 *  no https public link, no date, a date in the future). */
export function normalizeItem(r: RssItem, nowSec = Math.floor(Date.now() / 1000)): NewsItem | null {
  if (!r.title || !r.link || r.publishedAt === null || r.link.length > URL_MAX) return null
  if (r.publishedAt > nowSec + FUTURE_SLACK_SEC) return null
  const gate = validateBrandUrl(r.link)
  if (!gate.ok) return null
  const url = gate.url.toString()
  const source = storable(r.source || safeHost(r.sourceUrl) || gate.url.hostname.replace(/^www\./, ''), 80)
  const title = storable(trimPublisherSuffix(r.title, r.source), 240)
  if (!title || !source) return null
  // Google News descriptions are the headline again wrapped in an anchor —
  // a summary that repeats the title is noise, drop it.
  const desc = r.description && r.description !== r.title && !r.description.startsWith(title) ? storable(r.description, 300) : undefined
  // The picture is stored as the fence normalised it, never as the feed wrote it.
  const img = r.imageUrl && r.imageUrl.length <= URL_MAX ? validateBrandUrl(r.imageUrl) : null
  const image = img?.ok ? img.url.toString() : undefined
  return {
    id: newsItemId(url),
    title,
    url,
    source,
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

// ── the feeds asked about ONE symbol ────────────────────────────────────────

export interface NewsHop {
  /** The index's state row for this read: `<feed>:<SYMBOL>`. */
  key: string
  feed: NewsFeed
  url: string
  /** Post-parse relevance filter (Nasdaq pads unknown symbols with generic
   *  items, Yahoo pads a coin's feed with miners and funds). */
  keep?: (r: RssItem) => boolean
  /** Override the per-item publisher label (Cointelegraph's dc:creator reads
   *  "Cointelegraph by <author>" — the card wants the publisher). */
  sourceLabel?: string
  /** Feeds whose edge only answers a browser UA. */
  browserUa?: boolean
}

/** Google News indexes a quote page like a story: Yahoo's "AAPL Nov 2026
 *  510.000 call (AAPL261118C00510000) Stock Price, News, Quote & History"
 *  filled half the AAPL feed on 2026-11-17. A quote page is not a headline.
 *  Nor is a fund's daily holdings line ("What ProShares Ultra QQQ 2x Shares
 *  (QLD) Bought: Apple Leads on Nov. 16", "Invesco QQQ (QQQ) Buys $23.2
 *  Million More Apple on Nov. 16": they led Yahoo's AAPL feed on 2026-11-18,
 *  one per fund). */
export function isQuotePage(title: string): boolean {
  return (
    /\bStock Price, News, Quote (&|and) History\b/i.test(title) ||
    /\b(call|put) \([A-Z]{1,6}\d{6}[CP]\d{8}\)/.test(title) ||
    /^What .{3,80} \([A-Z]{2,5}\) (Bought|Sold):/.test(title) ||
    /\([A-Z]{2,5}\) (Buys|Adds|Sells|Trims|Cuts)\b.{3,80} on [A-Z][a-z]{2}\.? \d{1,2}$/.test(title) ||
    // An exchange's price page ("Maple Finance Price, SYRUP Price, Live Charts, and Marketcap").
    /\bPrice, Live Charts?,? and Market ?cap\b/i.test(title)
  )
}

function googleNewsUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
}

/** `(site:forbes.com OR site:reuters.com …)` — the majors, asked for by name. */
const MAJORS_CLAUSE = `(${MAJOR_SITES.map((s) => `site:${s}`).join(' OR ')})`

function yahooUrl(ticker: string): string {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`
}

/** What the news search asks for each look-only index (lib/charts
 *  CHART_INDEXES): the phrase a markets desk uses, quoted, so the headlines
 *  are about the index and not a ticker that shares three letters with it. */
const INDEX_NEWS_QUERY: Readonly<Record<string, string>> = {
  US10Y: '"10-year Treasury yield" OR "Treasury yields"',
  VIX: '"VIX" volatility index',
  DXY: '"dollar index" OR "DXY"',
  NDX: '"Nasdaq 100"',
  DJI: '"Dow Jones Industrial Average" OR "the Dow"',
  RUT: '"Russell 2000"',
}

/** Every feed asked about a charted symbol. ALL of them are read and merged
 *  (until 2026-11-18 this was a ladder and the first feed with a story served
 *  alone, which is why a coin's page read "via Cointelegraph" and nothing
 *  else). Pure — the harness pins it. */
export function newsFeedsFor(pair: ChartPair): NewsHop[] {
  const sym = pair.symbol
  const key = (feed: NewsFeed) => `${feed}:${sym}`
  if (pair.source === 'robinhood') {
    const name = stockNewsName(sym)
    const who = name ? `"${sym}" OR "${name}"` : `"${sym}"`
    const named = headlineTestFor(sym, 'stock')
    const about = (r: RssItem) => !isQuotePage(r.title) && (!named || named(r.title))
    return [
      // Google's targeted query is ABOUT the company; it is kept whole (bar quote pages).
      { key: key('google-news'), feed: 'google-news', url: googleNewsUrl(`${who} stock when:14d`), keep: (r) => !isQuotePage(r.title) },
      // The majors search and Yahoo answer with anything that mentions the company: the headline must name it.
      { key: key('google-majors'), feed: 'google-majors', url: googleNewsUrl(`${who} ${MAJORS_CLAUSE} when:14d`), keep: about },
      { key: key('yahoo'), feed: 'yahoo', url: yahooUrl(sym), sourceLabel: 'Yahoo Finance', keep: about },
      {
        // Nasdaq's per-symbol feed tags a ticker onto anything that mentions
        // it (a Motley Fool estate-planning podcast led the AAPL feed
        // 2026-09-11), so it is kept only where its own tickers tag names us.
        key: key('nasdaq'),
        feed: 'nasdaq',
        url: `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(sym)}`,
        keep: (r) => r.tickers.split(',').map((t) => t.trim()).includes(sym),
        browserUa: true,
      },
    ]
  }
  if (pair.source === 'index') {
    // A look-only index: the markets desk's own words for it, never "crypto".
    return [{ key: key('google-news'), feed: 'google-news', url: googleNewsUrl(`${INDEX_NEWS_QUERY[sym] ?? `"${pair.label}"`} when:7d`) }]
  }
  const hops: NewsHop[] = []
  const tagSlug = COINTELEGRAPH_TAGS[sym]
  if (tagSlug) hops.push({ key: key('cointelegraph'), feed: 'cointelegraph', url: `https://cointelegraph.com/rss/tag/${tagSlug}`, sourceLabel: 'Cointelegraph' })
  const name = COIN_NAMES[sym] ?? sym
  // A coin we hold a name for: every search feed's headline must name it. One we do not: the search is kept whole.
  const named = headlineTestFor(sym, 'coin')
  const about = named ? (r: RssItem) => named(r.title) : undefined
  hops.push({ key: key('google-news'), feed: 'google-news', url: googleNewsUrl(`"${name}" ${sym !== name ? sym : ''} crypto when:14d`.replace(/\s+/g, ' ')), keep: about })
  // The majors search carries no "crypto" in its query, so it is asked only where a headline test can hold it to the
  // coin (review F3: for WELL, AI, ME or MOVE it would file every Forbes story that uses the word).
  if (about) hops.push({ key: key('google-majors'), feed: 'google-majors', url: googleNewsUrl(`"${name}" ${MAJORS_CLAUSE} when:14d`), keep: about })
  // Yahoo files a coin as <SYM>-USD and pads the feed with miners and funds.
  // Tagged coins only (an unknown ticker there is some other company's).
  if (tagSlug) hops.push({ key: key('yahoo'), feed: 'yahoo', url: yahooUrl(`${sym}-USD`), sourceLabel: 'Yahoo Finance', keep: about })
  return hops
}

// ── fetch ───────────────────────────────────────────────────────────────────

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

/** Parsed rows → stories: filter, normalize, dedupe by url, newest first. Pure. */
export function hopItems(hop: Pick<NewsHop, 'feed' | 'keep' | 'sourceLabel'>, rows: RssItem[]): NewsItem[] {
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const r of rows) {
    if (hop.keep && !hop.keep(r)) continue
    const n = normalizeItem(hop.sourceLabel ? { ...r, source: hop.sourceLabel } : r)
    if (!n || seen.has(n.url)) continue
    seen.add(n.url)
    out.push({ ...n, feed: hop.feed })
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt)
  return out
}

/** Read one symbol feed. Null = the feed did not answer (an empty list = it answered with nothing). */
export async function runHop(hop: NewsHop): Promise<NewsItem[] | null> {
  const xml = await fetchFeed(hop.url, hop.browserUa)
  return xml === null ? null : hopItems(hop, parseRss(xml))
}

/** A site feed's parsed rows → stories filed under the symbols their HEADLINE
 *  names (the summary is not read for this: a coin named in passing is not
 *  what the story is about). A story that names none is dropped. Pure. */
export function siteItems(site: SiteFeed, rows: RssItem[]): FiledItem[] {
  const out: FiledItem[] = []
  for (const it of hopItems({ feed: site.feed, sourceLabel: NEWS_FEED_LABELS[site.feed], keep: (r) => !isQuotePage(r.title) }, rows)) {
    const symbols = [...new Set([...(site.always ?? []), ...symbolsInText(it.title, site.desk)])]
    if (symbols.length) out.push({ ...it, feed: site.feed, symbols })
  }
  return out
}

export async function runSite(site: SiteFeed): Promise<FiledItem[] | null> {
  const xml = await fetchFeed(site.url)
  return xml === null ? null : siteItems(site, parseRss(xml))
}

// ── the index path ──────────────────────────────────────────────────────────

/** A symbol's own feeds are re-read when a reader finds them this old. */
export const SYMBOL_STALE_SEC = 10 * 60
/** The cron re-reads a site feed this old (it runs every 10 minutes). */
export const SITE_STALE_SEC = 9 * 60
/** A reader does the cron's job only when the cron is this late (local dev, a paused cron). */
export const SITE_STALE_ON_READ_SEC = 25 * 60
/** How long a reader waits on stale feeds before being served what the index already holds. */
export const READ_WAIT_MS = 3_500
/** The first reader of a symbol has nothing to be served meanwhile: they wait for the feeds. */
export const FIRST_READ_WAIT_MS = 7_000

const siteKey = (s: SiteFeed) => `site:${s.key}`

/** Read one symbol feed into the index. Null = somebody else is reading it right now (the page is not complete yet). */
async function refreshHop(pair: ChartPair, hop: NewsHop, staleSec: number): Promise<number | null> {
  if (!(await claimFeed(hop.key, staleSec))) return null
  let items: NewsItem[] | null = null
  let stored = 0
  let ok = false
  try {
    items = await runHop(hop)
    stored = items ? await storeItems(items.map((it) => ({ ...it, feed: hop.feed, symbols: [pair.symbol] }))) : 0
    ok = items !== null
  } finally {
    // Settled whatever happened (review F4): a batch the store refused is a failed read that waits for the
    // next stale window, never a claim that frees in a minute and is re-fetched by every reader.
    await settleFeed(hop.key, ok, items?.length ?? 0).catch(() => undefined)
  }
  return stored
}

async function refreshSite(site: SiteFeed, staleSec: number): Promise<{ key: string; ok: boolean; stored: number } | null> {
  if (!(await claimFeed(siteKey(site), staleSec))) return null
  let items: FiledItem[] | null = null
  let stored = 0
  let ok = false
  try {
    items = await runSite(site)
    stored = items ? await storeItems(items) : 0
    ok = items !== null
  } finally {
    await settleFeed(siteKey(site), ok, items?.length ?? 0).catch(() => undefined)
  }
  return { key: site.key, ok, stored }
}

/** Re-read every site feed that is due. The cron's job (app/api/cron/news);
 *  safe to call from anywhere, a feed somebody else is reading is skipped. */
export async function refreshSiteFeeds(staleSec = SITE_STALE_SEC): Promise<{ read: string[]; failed: string[]; stored: number }> {
  const done = await Promise.allSettled(SITE_FEEDS.map((s) => refreshSite(s, staleSec)))
  const read: string[] = []
  const failed: string[] = []
  let stored = 0
  done.forEach((d, i) => {
    if (d.status === 'rejected') failed.push(SITE_FEEDS[i].key)
    else if (d.value) {
      ;(d.value.ok ? read : failed).push(d.value.key)
      stored += d.value.stored
    }
  })
  return { read, failed, stored }
}

interface Loaded {
  items: NewsItem[]
  /** Unix ms of the newest feed read behind the page. */
  asOf: number
  via: 'index' | 'direct'
  /** Stale feeds were still being read when the page was served: cache it briefly. */
  partial: boolean
}

const sleep = (ms: number) => new Promise<false>((r) => setTimeout(() => r(false), ms))

async function loadIndexed(pair: ChartPair, defer?: (work: Promise<unknown>) => void): Promise<Loaded> {
  const hops = newsFeedsFor(pair)
  const states = await feedStates([...hops.map((h) => h.key), ...SITE_FEEDS.map(siteKey)])
  const now = Date.now()
  const older = (key: string, sec: number) => {
    const at = states.get(key)?.fetchedAt ?? null
    return at === null || now - at > sec * 1000
  }
  const own: Promise<number | null>[] = []
  const sites: Promise<unknown>[] = []
  for (const h of hops) if (older(h.key, SYMBOL_STALE_SEC)) own.push(refreshHop(pair, h, SYMBOL_STALE_SEC))
  for (const s of SITE_FEEDS) if (older(siteKey(s), SITE_STALE_ON_READ_SEC)) sites.push(refreshSite(s, SITE_STALE_ON_READ_SEC))
  const work = [...own, ...sites]
  let partial = false
  if (work.length) {
    const firstRead = hops.every((h) => !states.get(h.key)?.fetchedAt)
    const all = Promise.allSettled(work)
    const finished = await Promise.race([all.then(() => true as const), sleep(firstRead ? FIRST_READ_WAIT_MS : READ_WAIT_MS)])
    if (!finished) {
      partial = true
      defer?.(all)
    } else {
      // A feed another instance is reading right now, or one that threw, is not on the page yet (review F6):
      // the page is served as partial, so it is cached for seconds and never reads as "no headlines".
      const ownDone = await Promise.allSettled(own)
      if (ownDone.some((d) => d.status === 'rejected' || d.value === null)) partial = true
    }
  }
  // The machine-page rule is applied on the way OUT too: a row stored before a rule was written does not outlive it.
  const items = mergeNews((await readSymbol(pair.symbol)).filter((it) => !isQuotePage(it.title)))
  const read = [...states.values()].map((s) => s.fetchedAt ?? 0)
  const asOf = work.length && !partial ? now : Math.max(0, ...read) || now
  return { items, asOf, via: 'index', partial }
}

// ── the direct path (no database: the feeds, read and merged in memory) ─────

const siteMemo = new Map<string, { at: number; items: FiledItem[] }>()

async function siteDirect(site: SiteFeed, now: number): Promise<FiledItem[]> {
  const hit = siteMemo.get(site.key)
  if (hit && now - hit.at < SITE_STALE_SEC * 1000) return hit.items
  const items = (await runSite(site)) ?? hit?.items ?? []
  siteMemo.set(site.key, { at: now, items })
  return items
}

async function loadDirect(pair: ChartPair): Promise<Loaded> {
  const now = Date.now()
  const desk = pair.source === 'robinhood' || pair.source === 'index' ? 'markets' : 'crypto'
  const [own, sites] = await Promise.all([
    Promise.all(newsFeedsFor(pair).map((h) => runHop(h).then((x) => x ?? []))),
    // A coin's page skips the pure markets desks and a stock's the pure crypto ones: they would file nothing there.
    Promise.all(SITE_FEEDS.filter((s) => s.desk === desk || s.desk === 'markets').map((s) => siteDirect(s, now))),
  ])
  const filed = sites.flat().filter((it) => it.symbols.includes(pair.symbol)).map(({ symbols: _symbols, ...it }) => it)
  return { items: mergeNews([...own.flat(), ...filed].filter((it) => !isQuotePage(it.title))), asOf: now, via: 'direct', partial: false }
}

// ── the page ────────────────────────────────────────────────────────────────

/** One instance re-reads the index for a symbol at most this often. */
export const NEWS_TTL_MS = 60_000
const PARTIAL_TTL_MS = 10_000

const cache = new Map<string, { at: number; ttl: number; value: Loaded }>()
const inflight = new Map<string, Promise<Loaded>>()

async function loadNews(pair: ChartPair, defer?: (work: Promise<unknown>) => void): Promise<Loaded> {
  if (newsIndexOn()) {
    try {
      return await loadIndexed(pair, defer)
    } catch (e) {
      // The database is away or the tables are not there yet: the feeds still answer.
      console.warn('[news] index read failed, reading the feeds directly:', (e as Error).message.split('\n')[0])
    }
  }
  return loadDirect(pair)
}

/** Feeds whose rows wear a name the reply fences read as a dead end. The
 *  chat's market read and the model's context are built WITHOUT them: "Yahoo"
 *  in a reply is how app/api/markets/ask and the harness spot a model sending
 *  the reader somewhere else, and a story sourced "Yahoo Finance" would trip
 *  both (it did, 2026-11-18). The News tab keeps every feed. */
export const FEEDS_NOT_FOR_REPLIES: readonly NewsFeed[] = ['yahoo']

/** News for a charted symbol; null for a chartless one (fail-closed — the
 *  same gate the candles proxy uses, so a symbol with no chart can't turn
 *  this into an open feed proxy). `defer` is handed any feed read still
 *  running when the page is served (a route passes next/server `after`). */
export async function getNews(
  symbolRaw: string,
  limit = NEWS_LIMIT_DEFAULT,
  opts: { defer?: (work: Promise<unknown>) => void; skipFeeds?: readonly NewsFeed[] } = {},
): Promise<NewsResponse | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  const key = pair.symbol
  const now = Date.now()
  const hit = cache.get(key)
  let value: Loaded
  if (hit && now - hit.at < hit.ttl) {
    value = hit.value
  } else {
    let p = inflight.get(key)
    if (!p) {
      p = loadNews(pair, opts.defer).finally(() => inflight.delete(key))
      inflight.set(key, p)
    }
    value = await p
    cache.set(key, { at: now, ttl: value.partial ? PARTIAL_TTL_MS : NEWS_TTL_MS, value })
  }
  const n = Math.max(1, Math.min(NEWS_LIMIT_MAX, Math.floor(limit) || NEWS_LIMIT_DEFAULT))
  const skip = opts.skipFeeds
  const items = (skip?.length ? value.items.filter((it) => !it.feed || !skip.includes(it.feed)) : value.items).slice(0, n)
  const feeds = feedCounts(items)
  return { symbol: key, items, feed: feeds[0] ?? 'none', feeds, sources: sourceCounts(items), via: value.via, ...(value.partial ? { partial: true } : {}), asOf: Math.floor(value.asOf / 1000) }
}

/** Test seam: drop the cache (the harness never needs it; local drills do). */
export function clearNewsCache(): void {
  cache.clear()
  siteMemo.clear()
}
