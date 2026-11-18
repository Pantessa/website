// "On X" for a symbol's news page (2026-11-18): the posts carrying its
// cashtag ($BTC), read from X's paid recent search and KEPT in Postgres, so a
// reader's click never spends a cent.
//
// MONEY. X bills every post a search returns ($0.005, lib/called-it/spec).
// So this never runs from a page view:
//   · only the cron pulls (app/api/cron/news), only for the symbols in
//     NEWS_X_SYMBOLS, each at most once per NEWS_X_PULL_HOURS;
//   · NEWS_X_DAILY_USD is the day's ceiling and it DEFAULTS TO 0 = OFF. A
//     pull is written to news_x_pulls with its worst-case cost BEFORE X is
//     asked, under a lock, and only if the day's total stays under the
//     ceiling; the row is settled to what X actually returned;
//   · a page is never asked for more posts than NEWS_X_POSTS_PER_PULL.
// At the defaults (3 symbols, every 8 hours, 20 posts) a day costs $0.90.
//
// NOT RUN AGAINST X: /2/tweets/search/recent with a cashtag was built to X's
// documented shapes and pinned on hand-written bodies
// (scripts/news-sources-pins.ts). Whether this account's plan serves the
// cashtag operator is unmeasured; a refusal settles the pull at $0 and the
// section stays the two links out to X. The bearer never leaves this file.
//
// The words are X's own, shown as text. A cashtag search is mostly noise, so
// a post is kept only with NEWS_X_MIN_LIKES likes, at most four cashtags, and
// real text. Who wrote it comes from X's keyless embed read (free), never a
// billed user lookup.

import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import type { ChartPair } from '@/lib/charts'
import { X_POST_COST_USD, fakeModeOn, postTimeAgrees } from '@/lib/called-it/spec'
import { readPostByIdWith } from '@/lib/called-it/source/by-id'
import { newsIndexOn } from '@/lib/news-index'

export const X_RECENT_URL = 'https://api.x.com/2/tweets/search/recent'
export const X_NEWS_WINDOW_DAYS = 14
export const X_NEWS_LIST_MAX = 40
/** Symbols one cron pass may pull (a pass has 30 seconds). */
export const X_PULLS_PER_PASS = 2
const X_TIMEOUT_MS = 10_000
const LOCK_KEY = 77_820_118

export interface XNewsConfig {
  /** The day's ceiling in dollars. 0 = the section never spends. */
  dailyUsd: number
  symbols: string[]
  pullHours: number
  postsPerPull: number
  minLikes: number
}

const numEnv = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const v = Number(raw)
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

/** The X section's settings from the environment. Pure. */
export function xNewsConfig(env: Record<string, string | undefined> = process.env): XNewsConfig {
  const symbols = (env.NEWS_X_SYMBOLS ?? 'BTC,ETH,SOL')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{1,6}$/.test(s))
  return {
    dailyUsd: numEnv(env.NEWS_X_DAILY_USD, 0, 0, 50),
    symbols: [...new Set(symbols)].slice(0, 20),
    pullHours: numEnv(env.NEWS_X_PULL_HOURS, 8, 1, 168),
    // X's recent search takes 10 to 100 a page.
    postsPerPull: Math.floor(numEnv(env.NEWS_X_POSTS_PER_PULL, 20, 10, 100)),
    minLikes: Math.floor(numEnv(env.NEWS_X_MIN_LIKES, 5, 0, 100_000)),
  }
}

/** `$BTC` for a symbol X can search by cashtag (letters only, six at most); null for a look-only index or anything else. */
export function cashtagOf(pair: Pick<ChartPair, 'symbol' | 'source'>): string | null {
  if (pair.source === 'index') return null
  return /^[A-Z]{1,6}$/.test(pair.symbol) ? `$${pair.symbol}` : null
}

/** Where a reader can see the cashtag on X itself (free, always offered). */
export function xSearchLinks(cashtag: string): { latest: string; top: string } {
  const q = encodeURIComponent(cashtag)
  return { latest: `https://x.com/search?q=${q}&f=live`, top: `https://x.com/search?q=${q}&f=top` }
}

/** The recent-search URL for one pull: original posts in English carrying the cashtag, X's own relevance order. */
export function recentSearchUrl(cashtag: string, maxResults: number): string {
  const u = new URL(X_RECENT_URL)
  u.searchParams.set('query', `${cashtag} -is:retweet -is:reply lang:en`)
  u.searchParams.set('max_results', String(Math.max(10, Math.min(100, Math.floor(maxResults)))))
  u.searchParams.set('sort_order', 'relevancy')
  u.searchParams.set('tweet.fields', 'created_at,public_metrics,lang,note_tweet')
  return u.toString()
}

export interface XNewsPost {
  id: string
  text: string
  /** Unix seconds. */
  postedAt: number
  likes: number
  reposts: number
  replies: number
  authorHandle: string | null
  authorName: string | null
  authorAvatar: string | null
  url: string
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** A recent-search body → posts, and how many X returned (what it bills). A
 *  row with no id, no text, or a time that disagrees with its id is not a post. Pure. */
export function mapRecentSearch(body: unknown): { posts: XNewsPost[]; returned: number } {
  const data = obj(body)?.data
  const rows = Array.isArray(data) ? data : []
  const posts: XNewsPost[] = []
  for (const raw of rows) {
    const t = obj(raw)
    if (!t) continue
    const id = typeof t.id === 'string' ? t.id : ''
    const text = typeof obj(t.note_tweet)?.text === 'string' ? (obj(t.note_tweet)!.text as string) : typeof t.text === 'string' ? t.text : ''
    const at = Date.parse(typeof t.created_at === 'string' ? t.created_at : '')
    if (!/^\d{5,20}$/.test(id) || !text || !Number.isFinite(at) || !postTimeAgrees(id, at)) continue
    const m = obj(t.public_metrics)
    posts.push({
      id,
      text: text.replace(/\u0000/g, '').slice(0, 4000),
      postedAt: Math.floor(at / 1000),
      likes: count(m?.like_count),
      reposts: count(m?.retweet_count),
      replies: count(m?.reply_count),
      authorHandle: null,
      authorName: null,
      authorAvatar: null,
      url: `https://x.com/i/status/${id}`,
    })
  }
  return { posts, returned: rows.length }
}

/** Is this post worth a seat? Enough likes, not a cashtag pile, and words of its own. Pure. */
export function keepXPost(p: Pick<XNewsPost, 'text' | 'likes'>, minLikes: number): boolean {
  if (p.likes < minLikes) return false
  if ((p.text.match(/\$[A-Za-z]{1,6}\b/g) ?? []).length > 4) return false
  const words = p.text.replace(/https?:\/\/\S+/g, ' ').replace(/[$#@]\w+/g, ' ').replace(/\s+/g, ' ').trim()
  return words.length >= 20
}

/** "Best" = most liked first; "latest" = newest first. Pure. */
export function orderXPosts(posts: readonly XNewsPost[], by: 'best' | 'latest'): XNewsPost[] {
  return [...posts].sort((a, b) => (by === 'best' ? b.likes - a.likes || b.postedAt - a.postedAt : b.postedAt - a.postedAt || b.likes - a.likes))
}

/** The most one pull can cost. */
export function worstPullUsd(postsPerPull: number): number {
  return Math.round(postsPerPull * X_POST_COST_USD * 1e6) / 1e6
}

/** The posts fake mode "reads" (XCALLS_FAKE=1, never on a Vercel deployment): fixed words, ids whose time is their own. */
export function fixtureXPosts(symbol: string, nowMs: number): XNewsPost[] {
  const lines = [
    [`Fixture post one about $${symbol}: the range held again and the bid is still there.`, 412, 2],
    [`Fixture post two about $${symbol}: funding flipped negative overnight, worth a look.`, 96, 9],
    [`Fixture post three about $${symbol}: nothing changed, which is the news.`, 23, 30],
  ] as const
  // Timed off the start of the UTC day, so a day's pulls rewrite the same three rows.
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000
  return lines.map(([text, likes, hoursAgo], i) => {
    const at = dayStart - hoursAgo * 3_600_000
    const id = ((BigInt(at) - BigInt(1288834974657)) << BigInt(22)) + BigInt(i + 1)
    return { id: id.toString(), text, postedAt: Math.floor(at / 1000), likes, reposts: Math.floor(likes / 8), replies: Math.floor(likes / 20), authorHandle: `fixture${i + 1}`, authorName: `Fixture ${i + 1}`, authorAvatar: null, url: `https://x.com/i/status/${id}` }
  })
}

// ── the store ───────────────────────────────────────────────────────────────

/** A symbol's kept posts inside the window, most liked first. Fake mode reads its own rows and nobody else's. */
export async function listXPosts(symbol: string, max = X_NEWS_LIST_MAX): Promise<{ posts: XNewsPost[]; asOf: number | null }> {
  if (!newsIndexOn()) return { posts: [], asOf: null }
  const internal = fakeModeOn()
  const rows = await prisma.$queryRaw<
    { post_id: string; body: string; author_handle: string | null; author_name: string | null; author_avatar: string | null; likes: number; reposts: number; replies: number; posted_at: Date; fetched_at: Date }[]
  >`
    SELECT post_id, body, author_handle, author_name, author_avatar, likes, reposts, replies, posted_at, fetched_at
    FROM news_x_posts
    WHERE symbol = ${symbol} AND is_internal = ${internal} AND posted_at > now() - make_interval(days => ${X_NEWS_WINDOW_DAYS}::int)
    ORDER BY likes DESC, posted_at DESC
    LIMIT ${max}`
  const posts = rows.map((r) => ({
    id: r.post_id,
    text: r.body,
    postedAt: Math.floor(r.posted_at.getTime() / 1000),
    likes: r.likes,
    reposts: r.reposts,
    replies: r.replies,
    authorHandle: r.author_handle,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    url: r.author_handle ? `https://x.com/${r.author_handle}/status/${r.post_id}` : `https://x.com/i/status/${r.post_id}`,
  }))
  const asOf = rows.length ? Math.floor(Math.max(...rows.map((r) => r.fetched_at.getTime())) / 1000) : null
  return { posts, asOf }
}

/** Write the pull's worst case against today's ceiling. Null when the day cannot afford it. One caller at a time. */
async function reservePull(symbol: string, worstUsd: number, capUsd: number, internal: boolean): Promise<string | null> {
  const id = randomUUID()
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY}::bigint)`
    return tx.$queryRaw<{ id: string }[]>`
      INSERT INTO news_x_pulls (id, symbol, reserved_usd, is_internal)
      SELECT ${id}, ${symbol}, ${worstUsd}::double precision, ${internal}
      WHERE ${internal} OR (
        SELECT COALESCE(SUM(COALESCE(cost_usd, reserved_usd)), 0) FROM news_x_pulls
        WHERE NOT is_internal AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      ) + ${worstUsd}::double precision <= ${capUsd}::double precision
      RETURNING id`
  })
  return rows[0]?.id ?? null
}

async function settlePull(id: string, costUsd: number, read: number, kept: number, status: string): Promise<void> {
  await prisma.$executeRaw`UPDATE news_x_pulls SET cost_usd = ${costUsd}::double precision, read_count = ${read}, kept_count = ${kept}, status = ${status} WHERE id = ${id}`
}

async function storeXPosts(symbol: string, posts: XNewsPost[], internal: boolean): Promise<void> {
  for (const p of posts) {
    await prisma.$executeRaw`
      INSERT INTO news_x_posts (symbol, post_id, body, author_handle, author_name, author_avatar, likes, reposts, replies, posted_at, is_internal)
      VALUES (${symbol}, ${p.id}, ${p.text}, ${p.authorHandle}, ${p.authorName}, ${p.authorAvatar}, ${p.likes}, ${p.reposts}, ${p.replies}, to_timestamp(${p.postedAt}::double precision), ${internal})
      ON CONFLICT (symbol, post_id) DO UPDATE SET likes = EXCLUDED.likes, reposts = EXCLUDED.reposts, replies = EXCLUDED.replies, fetched_at = now(),
        author_handle = COALESCE(EXCLUDED.author_handle, news_x_posts.author_handle), author_name = COALESCE(EXCLUDED.author_name, news_x_posts.author_name),
        author_avatar = COALESCE(EXCLUDED.author_avatar, news_x_posts.author_avatar)`
  }
}

export type XPullResult = { symbol: string; status: string; read: number; kept: number; costUsd: number }

/** One paid read for one symbol: reserve, ask X once, keep what is worth a seat, name its authors for free, settle. */
export async function pullXSymbol(symbol: string, cfg: XNewsConfig = xNewsConfig()): Promise<XPullResult> {
  const fake = fakeModeOn()
  const cashtag = `$${symbol}`
  const worst = fake ? 0 : worstPullUsd(cfg.postsPerPull)
  const pullId = await reservePull(symbol, worst, cfg.dailyUsd, fake)
  if (!pullId) return { symbol, status: 'over-budget', read: 0, kept: 0, costUsd: 0 }
  try {
    let found: XNewsPost[]
    let returned: number
    if (fake) {
      found = fixtureXPosts(symbol, Date.now())
      returned = found.length
    } else {
      const bearer = process.env.X_BEARER_TOKEN
      if (!bearer) {
        await settlePull(pullId, 0, 0, 0, 'no-key')
        return { symbol, status: 'no-key', read: 0, kept: 0, costUsd: 0 }
      }
      const res = await fetch(recentSearchUrl(cashtag, cfg.postsPerPull), { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' }, signal: AbortSignal.timeout(X_TIMEOUT_MS), cache: 'no-store' })
      if (res.status !== 200) {
        // X bills nothing for a refusal. The status is X's; no body and no key is kept.
        const status = `x-http-${res.status}`
        await settlePull(pullId, 0, 0, 0, status)
        return { symbol, status, read: 0, kept: 0, costUsd: 0 }
      }
      const mapped = mapRecentSearch(await res.json().catch(() => null))
      found = mapped.posts
      returned = mapped.returned
    }
    const costUsd = fake ? 0 : Math.round(returned * X_POST_COST_USD * 1e6) / 1e6
    const kept = found.filter((p) => keepXPost(p, cfg.minLikes))
    if (!fake) {
      // Who wrote it: X's keyless embed read, in parallel, never a billed lookup. A miss leaves the post unsigned.
      await Promise.all(
        kept.map(async (p) => {
          const r = await readPostByIdWith(p.id).catch(() => null)
          if (r?.ok) {
            p.authorHandle = r.profile.handle
            p.authorName = r.profile.name
            p.authorAvatar = r.profile.avatarUrl
          }
        }),
      )
    }
    await storeXPosts(symbol, kept, fake)
    await settlePull(pullId, costUsd, returned, kept.length, 'done')
    return { symbol, status: 'done', read: returned, kept: kept.length, costUsd }
  } catch (e) {
    // Unknown whether X billed: the reservation stands as the cost (cost_usd stays null).
    await prisma.$executeRaw`UPDATE news_x_pulls SET status = 'error' WHERE id = ${pullId}`.catch(() => undefined)
    return { symbol, status: `error: ${(e as Error).name}`, read: 0, kept: 0, costUsd: worst }
  }
}

/** The cron's X step: pull the configured symbols whose last pull is older than the interval, a few a pass. */
export async function pullDueXSymbols(cfg: XNewsConfig = xNewsConfig()): Promise<{ enabled: boolean; pulls: XPullResult[] }> {
  const fake = fakeModeOn()
  if (!newsIndexOn() || (!fake && cfg.dailyUsd <= 0) || cfg.symbols.length === 0) return { enabled: false, pulls: [] }
  const last = await prisma.$queryRaw<{ symbol: string; at: Date }[]>`
    SELECT symbol, max(started_at) AS at FROM news_x_pulls WHERE symbol = ANY(${cfg.symbols}) AND is_internal = ${fake} GROUP BY symbol`
  const lastAt = new Map(last.map((r) => [r.symbol, r.at.getTime()]))
  const now = Date.now()
  const due = cfg.symbols.filter((s) => now - (lastAt.get(s) ?? 0) >= cfg.pullHours * 3_600_000).slice(0, X_PULLS_PER_PASS)
  const pulls: XPullResult[] = []
  for (const s of due) pulls.push(await pullXSymbol(s, cfg))
  return { enabled: true, pulls }
}
