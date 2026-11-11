// One public post by id, with no key (squad called-it, lane SOURCE).
//
// The first read is X's embed endpoint (cdn.syndication.twimg.com
// tweet-result): text, created_at, likes, replies and the author. A 404 there
// means X no longer serves the post (`gone`). When that endpoint does not
// answer, oEmbed (publish.twitter.com) is the second read: text and author
// only, so the time is taken from the id and the counts are null.
//
// Honesty rule 1: the words are X's own. This file maps fields; it never
// shortens or rewrites a post. Rule 8: the post is data. Nothing in it is
// followed (no link is fetched), and an avatar is kept only from X's own
// image hosts.
import { POST_ID_RE, postTimeAgrees, snowflakeMs, type PostRead, type XPost, type XProfile } from '../spec'

export const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result'
export const OEMBED_URL = 'https://publish.twitter.com/oembed'
export const BY_ID_TIMEOUT_MS = 4000
const AVATAR_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com'])

/** The token X's own embed script sends with a tweet-result read. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

export function syndicationUrl(id: string): string {
  return `${SYNDICATION_URL}?id=${id}&token=${syndicationToken(id)}`
}

export function oembedUrl(id: string): string {
  return `${OEMBED_URL}?url=${encodeURIComponent(`https://twitter.com/i/status/${id}`)}&omit_script=1&dnt=1`
}

/** An avatar URL only from X's own image hosts, over https. Anything else is null. */
export function safeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && AVATAR_HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)

/**
 * Map a tweet-result body. `gone` when X answered with no post (a tombstone,
 * an empty body). `unavailable` when the body is not the post asked for, or
 * its time disagrees with its id.
 */
export function mapSyndication(id: string, body: unknown): PostRead {
  const b = obj(body)
  if (!b || Object.keys(b).length === 0) return { ok: false, reason: 'gone' }
  if (b.__typename === 'TweetTombstone' || b.tombstone) return { ok: false, reason: 'gone' }
  if (str(b.id_str) !== id) return { ok: false, reason: 'unavailable' }
  const user = obj(b.user)
  const screen = str(user?.screen_name)
  if (!user || !screen || !/^[A-Za-z0-9_]{1,15}$/.test(screen)) return { ok: false, reason: 'unavailable' }
  const note = str(obj(obj(obj(b.note_tweet)?.note_tweet_results)?.result)?.text)
  const text = note ?? str(b.text)
  const created = Date.parse(str(b.created_at) ?? '')
  if (text === null || !Number.isFinite(created) || !postTimeAgrees(id, created)) return { ok: false, reason: 'unavailable' }
  const handle = screen.toLowerCase()
  const replyTo = str(b.in_reply_to_screen_name)?.toLowerCase() ?? null
  const isReply = !!str(b.in_reply_to_status_id_str) && replyTo !== handle
  const post: XPost & { xUserId: string | null } = {
    id,
    handle,
    // The author's X user id rides with the post (review R9): a record only shows posts its handle's current owner wrote.
    xUserId: str(user.id_str),
    text,
    postedAt: created,
    likes: num(b.favorite_count),
    replies: num(b.conversation_count),
    reposts: num(b.retweet_count),
    isReply,
    source: 'syndication',
  }
  const profile: XProfile = {
    handle,
    name: str(user.name) ?? handle,
    avatarUrl: safeAvatarUrl(user.profile_image_url_https),
    followers: num(user.followers_count),
    blue: user.is_blue_verified === true,
    xUserId: str(user.id_str),
  }
  return { ok: true, post, profile }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Map an oEmbed body. The post's words are the first paragraph of X's own
 * blockquote, tags removed and entities decoded; the author is the account in
 * `author_url`; the time is the id's own (an id with no clock is unavailable).
 */
export function mapOembed(id: string, body: unknown): PostRead {
  const b = obj(body)
  const html = str(b?.html)
  const authorUrl = str(b?.author_url)
  const url = str(b?.url)
  if (!b || !html || !authorUrl) return { ok: false, reason: 'unavailable' }
  if (url && !new RegExp(`/status(?:es)?/${id}(?:[/?#]|$)`).test(url)) return { ok: false, reason: 'unavailable' }
  const m = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(authorUrl)
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  const postedAt = snowflakeMs(id)
  if (!m || !p || postedAt === null) return { ok: false, reason: 'unavailable' }
  const text = decodeEntities(p[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
  const handle = m[1].toLowerCase()
  return {
    ok: true,
    post: { id, handle, text, postedAt, likes: null, replies: null, reposts: null, isReply: false, source: 'syndication' },
    profile: { handle, name: str(b.author_name) ?? handle, avatarUrl: null, followers: null, blue: false, xUserId: null },
  }
}

type Fetch = typeof fetch

async function getJson(url: string, f: Fetch, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const res = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, redirect: 'follow', cache: 'no-store' })
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {})
    return { status: res.status, body: null }
  }
  return { status: 200, body: await res.json().catch(() => undefined) }
}

/** One post by id over X's keyless embed endpoint. Works with no key at all. */
export async function readPostByIdWith(id: string, opts: { fetch?: Fetch; timeoutMs?: number } = {}): Promise<PostRead> {
  if (typeof id !== 'string' || !POST_ID_RE.test(id)) return { ok: false, reason: 'unavailable' }
  const f = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? BY_ID_TIMEOUT_MS
  try {
    const r = await getJson(syndicationUrl(id), f, timeoutMs)
    if (r.status === 404) return { ok: false, reason: 'gone' }
    // A parsed body answers, either way: one that is not the post asked for
    // (or whose time disagrees with its id) is refused, never patched from
    // the second read. Only a body that did not parse falls through.
    if (r.status === 200 && r.body !== undefined) return mapSyndication(id, r.body)
  } catch {
    // timeout or network: fall through to the second read
  }
  try {
    const r = await getJson(oembedUrl(id), f, timeoutMs)
    if (r.status === 200 && r.body) return mapOembed(id, r.body)
  } catch {
    // nothing else to try
  }
  return { ok: false, reason: 'unavailable' }
}
