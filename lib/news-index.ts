// The news INDEX (2026-11-18): every story the feeds hand us, kept in
// Postgres and filed under the symbols it is about, so a symbol's page is one
// indexed read instead of a dozen feed fetches, a story outlives the feed's
// own 25-item window, and every serverless instance shares one copy.
//
//   news_items         one row per story URL
//   news_symbol_items  (symbol, item) — which pages a story is on
//   news_feed_state    when each feed was last read, and who is reading it now
//
// A feed is read by whoever CLAIMS it: one conditional upsert that succeeds
// only when the feed is stale and nobody claimed it in the last minute, so
// the cron and two readers never fetch the same feed at once.
//
// Everything here fails soft to the caller: lib/news.ts catches and reads the
// feeds directly when the database is off or the tables are not there yet.

import prisma from '@/lib/db'
import type { NewsFeed, NewsItem } from '@/lib/news-shared'
import { titleKey } from '@/lib/news-sources'

export function newsIndexOn(): boolean {
  return process.env.USE_DB === 'true' && !!process.env.DATABASE_URL
}

/** How long a story stays on a symbol's page. */
export const INDEX_WINDOW_DAYS = 21
/** How long a story stays in the index at all. */
export const INDEX_KEEP_DAYS = 120
/** Rows read for one page before the merge. */
export const INDEX_READ_MAX = 400
/** A claim nobody finished is free again after this. */
export const CLAIM_TTL_SEC = 60

export interface FeedState {
  key: string
  /** Unix ms of the last finished read, or null. */
  fetchedAt: number | null
  ok: boolean
}

/** The last read of each feed key that has one. */
export async function feedStates(keys: string[]): Promise<Map<string, FeedState>> {
  const out = new Map<string, FeedState>()
  if (!keys.length) return out
  const rows = await prisma.$queryRaw<{ feed_key: string; fetched_at: Date | null; ok: boolean }[]>`
    SELECT feed_key, fetched_at, ok FROM news_feed_state WHERE feed_key = ANY(${keys})`
  for (const r of rows) out.set(r.feed_key, { key: r.feed_key, fetchedAt: r.fetched_at ? r.fetched_at.getTime() : null, ok: r.ok })
  return out
}

/** Take the right to read a feed now. True for exactly one caller while the
 *  feed is older than `staleSec` and unclaimed for CLAIM_TTL_SEC. */
export async function claimFeed(key: string, staleSec: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ feed_key: string }[]>`
    INSERT INTO news_feed_state (feed_key, claimed_at) VALUES (${key}, now())
    ON CONFLICT (feed_key) DO UPDATE SET claimed_at = now()
      WHERE (news_feed_state.fetched_at IS NULL OR news_feed_state.fetched_at < now() - make_interval(secs => ${staleSec}::double precision))
        AND (news_feed_state.claimed_at IS NULL OR news_feed_state.claimed_at < now() - make_interval(secs => ${CLAIM_TTL_SEC}::double precision))
    RETURNING feed_key`
  return rows.length > 0
}

/** Record a finished read (a failed one too: a dead feed is not re-hit until it is stale again). */
export async function settleFeed(key: string, ok: boolean, itemCount: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE news_feed_state SET fetched_at = now(), claimed_at = NULL, ok = ${ok}, item_count = ${itemCount} WHERE feed_key = ${key}`
}

export interface FiledItem extends NewsItem {
  feed: NewsFeed
  /** The pages this story goes on. A story with none is not stored. */
  symbols: string[]
}

/** Store stories and file them under their symbols. A story already stored
 *  keeps its row and gains what it lacked (a picture, a summary, a page). */
export async function storeItems(items: FiledItem[]): Promise<number> {
  const rows = items.filter((it) => it.symbols.length > 0)
  if (!rows.length) return 0
  // Nullable text travels as '' + NULLIF: Prisma types an array by its first
  // element and refuses one that opens with null (CLAUDE.md gotcha, 11-11).
  const ids = rows.map((r) => r.id)
  const urls = rows.map((r) => r.url)
  const titles = rows.map((r) => r.title)
  const keys = rows.map((r) => titleKey(r.title))
  const sources = rows.map((r) => r.source)
  const feeds = rows.map((r) => r.feed as string)
  const summaries = rows.map((r) => r.summary ?? '')
  const images = rows.map((r) => r.imageUrl ?? '')
  const times = rows.map((r) => String(r.publishedAt))
  await prisma.$executeRaw`
    INSERT INTO news_items (id, url, title, title_key, source, feed, summary, image_url, published_at)
    SELECT t.id, t.url, t.title, t.title_key, t.source, t.feed, NULLIF(t.summary, ''), NULLIF(t.image_url, ''), to_timestamp(t.at::double precision)
    FROM unnest(${ids}::text[], ${urls}::text[], ${titles}::text[], ${keys}::text[], ${sources}::text[], ${feeds}::text[], ${summaries}::text[], ${images}::text[], ${times}::text[])
      AS t(id, url, title, title_key, source, feed, summary, image_url, at)
    ON CONFLICT (id) DO UPDATE SET
      image_url = COALESCE(news_items.image_url, EXCLUDED.image_url),
      summary = COALESCE(news_items.summary, EXCLUDED.summary)`
  const linkSymbols: string[] = []
  const linkIds: string[] = []
  const linkTimes: string[] = []
  for (const r of rows) {
    for (const s of new Set(r.symbols)) {
      linkSymbols.push(s)
      linkIds.push(r.id)
      linkTimes.push(String(r.publishedAt))
    }
  }
  await prisma.$executeRaw`
    INSERT INTO news_symbol_items (symbol, item_id, published_at)
    SELECT t.symbol, t.item_id, to_timestamp(t.at::double precision)
    FROM unnest(${linkSymbols}::text[], ${linkIds}::text[], ${linkTimes}::text[]) AS t(symbol, item_id, at)
    ON CONFLICT (symbol, item_id) DO NOTHING`
  return rows.length
}

/** A symbol's stories from the index, newest first, inside the page window. */
export async function readSymbol(symbol: string, max = INDEX_READ_MAX): Promise<NewsItem[]> {
  const rows = await prisma.$queryRaw<
    { id: string; url: string; title: string; source: string; feed: string; summary: string | null; image_url: string | null; published_at: Date }[]
  >`
    SELECT i.id, i.url, i.title, i.source, i.feed, i.summary, i.image_url, i.published_at
    FROM news_symbol_items s JOIN news_items i ON i.id = s.item_id
    WHERE s.symbol = ${symbol} AND s.published_at > now() - make_interval(days => ${INDEX_WINDOW_DAYS}::int)
    ORDER BY s.published_at DESC
    LIMIT ${max}`
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    source: r.source,
    feed: r.feed as NewsFeed,
    publishedAt: Math.floor(r.published_at.getTime() / 1000),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.image_url ? { imageUrl: r.image_url } : {}),
  }))
}

/** Drop what is older than the index keeps. Returns the stories removed. */
export async function pruneIndex(): Promise<number> {
  // The X section's own rows: posts leave the page after 14 days, and a pull's ledger row is kept a quarter.
  await prisma.$executeRaw`DELETE FROM news_x_posts WHERE posted_at < now() - make_interval(days => 30)`
  await prisma.$executeRaw`DELETE FROM news_x_pulls WHERE started_at < now() - make_interval(days => 90)`
  await prisma.$executeRaw`DELETE FROM news_symbol_items WHERE published_at < now() - make_interval(days => ${INDEX_KEEP_DAYS}::int)`
  return prisma.$executeRaw`DELETE FROM news_items WHERE published_at < now() - make_interval(days => ${INDEX_KEEP_DAYS}::int)`
}

/** What the index holds, for the cron's answer and a drill. */
export async function indexStats(): Promise<{ items: number; filed: number; feeds: number }> {
  const [r] = await prisma.$queryRaw<{ items: bigint; filed: bigint; feeds: bigint }[]>`
    SELECT (SELECT count(*) FROM news_items) AS items, (SELECT count(*) FROM news_symbol_items) AS filed, (SELECT count(*) FROM news_feed_state WHERE ok) AS feeds`
  return { items: Number(r?.items ?? 0), filed: Number(r?.filed ?? 0), feeds: Number(r?.feeds ?? 0) }
}
