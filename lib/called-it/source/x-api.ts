// X's own API (pay-per-use, api.x.com/2) as a scan source (squad called-it,
// lane SOURCE).
//
// NOT RUN AGAINST X: there was no X_BEARER_TOKEN on any machine when this was
// written (2026-11-11). It is built to the documented shapes of
// GET /2/users/by/username/:username and GET /2/tweets/search/all, and the
// query builder and the mappers are pinned on hand-written bodies in
// scripts/called-source-pins.ts. Run `npm run probe:x -- --spend` once a
// bearer exists before trusting it.
//
// Money: X bills every post a read returns ($0.005) and every user read
// ($0.010). `cap` is a hard ceiling: a page is never asked for more posts
// than the cap has left, and a page smaller than X's minimum (10) is never
// asked for, so a scan never reads past its cap.
//
// The bearer never leaves this file: it is not in an error, a log line or a
// return value. Errors carry X's HTTP status and our own words only.
import { X_POST_COST_USD, X_USER_COST_USD, postTimeAgrees, type XPost, type XProfile, type XSearchQuery, type XSearchResult, type XSource } from '../spec'
import { safeAvatarUrl } from './by-id'

export const X_API_BASE = 'https://api.x.com/2'
/** X refuses a full-archive query longer than this. */
export const X_QUERY_MAX = 1024
export const X_PAGE_MIN = 10
export const X_PAGE_MAX = 500
export const X_TIMEOUT_MS = 10_000
/** Full-archive search allows one request a second per app. */
export const X_PAGE_GAP_MS = 1100
export const X_TWEET_FIELDS = 'created_at,public_metrics,referenced_tweets,in_reply_to_user_id,lang,author_id,note_tweet'
export const X_USER_FIELDS = 'profile_image_url,public_metrics,protected,verified'

export type XApiErrorKind = 'rate-limited' | 'unauthorized' | 'no-credits' | 'bad-request' | 'unavailable'

/** What went wrong talking to X, in our words. Never carries the bearer or X's body. */
export class XApiError extends Error {
  readonly kind: XApiErrorKind
  readonly status: number | null
  /** For `rate-limited`: when X says the window resets (ms), when it said. */
  readonly resetAt: number | null
  constructor(kind: XApiErrorKind, message: string, status: number | null = null, resetAt: number | null = null) {
    super(message)
    this.name = 'XApiError'
    this.kind = kind
    this.status = status
    this.resetAt = resetAt
  }
}

// ── The query ─────────────────────────────────────────────────────────────

/** One search term as X's query grammar reads it: a multi-word term is quoted; quotes and parentheses inside a term are dropped. */
export function quoteTerm(raw: string): string | null {
  const t = raw.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return /\s/.test(t) ? `"${t}"` : t
}

/**
 * `from:<h> -is:retweet (<a> OR <b> OR "c d")`, split into as many queries as
 * it takes to keep each one under X_QUERY_MAX. Terms are de-duplicated
 * (case aside). A term too long to fit any query alone is dropped. No terms =
 * one query for every original post.
 */
export function buildSearchQueries(handle: string, terms: readonly string[], max = X_QUERY_MAX): string[] {
  const head = `from:${handle} -is:retweet`
  const seen = new Set<string>()
  const quoted: string[] = []
  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const q = quoteTerm(raw)
    if (!q || seen.has(q.toLowerCase())) continue
    seen.add(q.toLowerCase())
    quoted.push(q)
  }
  if (!quoted.length) return [head]
  const out: string[] = []
  let cur: string[] = []
  const render = (list: string[]) => `${head} (${list.join(' OR ')})`
  for (const q of quoted) {
    if (render([q]).length > max) continue
    if (cur.length && render([...cur, q]).length > max) {
      out.push(render(cur))
      cur = []
    }
    cur.push(q)
  }
  if (cur.length) out.push(render(cur))
  return out
}

/** X wants `YYYY-MM-DDTHH:mm:ssZ`. */
export function xTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The search URL for one page. `sinceId` replaces `start_time` (X reads one or the other). `end_time` stays at least 15 s in the past, as X asks. */
export function searchUrl(p: { query: string; fromMs: number; toMs: number; maxResults: number; sinceId?: string; nextToken?: string; nowMs: number }): string {
  const u = new URL(`${X_API_BASE}/tweets/search/all`)
  u.searchParams.set('query', p.query)
  if (p.sinceId) u.searchParams.set('since_id', p.sinceId)
  else u.searchParams.set('start_time', xTime(Math.max(p.fromMs, Date.UTC(2006, 2, 21))))
  u.searchParams.set('end_time', xTime(Math.min(p.toMs, p.nowMs - 15_000)))
  u.searchParams.set('max_results', String(Math.max(X_PAGE_MIN, Math.min(X_PAGE_MAX, Math.floor(p.maxResults)))))
  u.searchParams.set('tweet.fields', X_TWEET_FIELDS)
  if (p.nextToken) u.searchParams.set('next_token', p.nextToken)
  return u.toString()
}

export function profileUrl(handle: string): string {
  return `${X_API_BASE}/users/by/username/${encodeURIComponent(handle)}?user.fields=${X_USER_FIELDS}`
}

// ── The mappers ───────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** A users/by/username body → a profile. Null for no such account, a protected account, or a body that is not one. */
export function mapXUser(handle: string, body: unknown): XProfile | null {
  const d = obj(obj(body)?.data)
  if (!d) return null
  const username = str(d.username)
  if (!username || username.toLowerCase() !== handle.toLowerCase()) return null
  if (d.protected === true) return null
  const id = str(d.id)
  return {
    handle: username.toLowerCase(),
    name: str(d.name) ?? username.toLowerCase(),
    avatarUrl: safeAvatarUrl(d.profile_image_url),
    followers: num(obj(d.public_metrics)?.followers_count),
    blue: d.verified === true,
    xUserId: id && /^\d{1,20}$/.test(id) ? id : null,
  }
}

/** True when the users body says the account is protected (so a refusal can say so). */
export function xUserIsProtected(body: unknown): boolean {
  return obj(obj(body)?.data)?.protected === true
}

/**
 * One post from a search page. Null for a retweet, a post with no id or
 * time, or a post whose time disagrees with its id. A reply to the account
 * itself (a thread) is not a reply.
 */
export function mapXPost(handle: string, raw: unknown, authorId: string | null): XPost | null {
  const t = obj(raw)
  if (!t) return null
  const id = str(t.id)
  const created = Date.parse(str(t.created_at) ?? '')
  const text = str(obj(t.note_tweet)?.text) ?? str(t.text)
  if (!id || !/^\d{5,20}$/.test(id) || text === null || !Number.isFinite(created) || !postTimeAgrees(id, created)) return null
  const refs = Array.isArray(t.referenced_tweets) ? t.referenced_tweets.map(obj).filter((r): r is Obj => !!r) : []
  if (refs.some((r) => r.type === 'retweeted')) return null
  const replyTo = str(t.in_reply_to_user_id)
  const ownId = authorId ?? str(t.author_id)
  const isReply = refs.some((r) => r.type === 'replied_to') && !(replyTo && ownId && replyTo === ownId)
  const m = obj(t.public_metrics)
  return { id, handle: handle.toLowerCase(), text, postedAt: created, likes: num(m?.like_count), replies: num(m?.reply_count), reposts: num(m?.retweet_count), isReply, source: 'x-api' }
}

/** A search with a deadline (review R4e): XSource's query plus the absolute ms after which no page is asked for. */
export type XSearchQueryTimed = XSearchQuery & { deadlineMs?: number }

/** Why the last search stopped early: the cap, a deadline, or X failing after at least one page (review R4d). Null = it read the whole window. */
export type XSearchStop = 'cap' | 'deadline' | 'rate-limited' | 'error' | null

// ── The source ────────────────────────────────────────────────────────────

type Fetch = typeof fetch

export interface XApiOptions {
  bearer: string
  fetch?: Fetch
  now?: () => number
  /** Wait between page requests (ms). Pins pass 0. */
  pageGapMs?: number
  timeoutMs?: number
}

function resetAtOf(res: Response, nowMs: number): number {
  const s = Number(res.headers.get('x-rate-limit-reset'))
  return Number.isFinite(s) && s > 0 ? s * 1000 : nowMs + 15 * 60_000
}

export class XApiSource implements XSource {
  readonly name = 'x-api' as const
  readonly #bearer: string
  readonly #fetch: Fetch
  readonly #now: () => number
  readonly #gap: number
  readonly #timeout: number
  /** User reads not yet billed to a search: folded into the next search's costUsd. */
  #unbilledUsd = 0
  /** Every dollar this instance has spent on X (profile reads + post reads). */
  spentUsd = 0
  /** Why the last profile() answered null: `unknown` (no such account) or `protected`. */
  lastProfileMiss: 'unknown' | 'protected' | null = null
  /** Why the last search() stopped before the window did (review R4d). */
  lastStop: XSearchStop = null

  constructor(opts: XApiOptions) {
    this.#bearer = opts.bearer
    this.#fetch = opts.fetch ?? fetch
    this.#now = opts.now ?? Date.now
    this.#gap = opts.pageGapMs ?? X_PAGE_GAP_MS
    this.#timeout = opts.timeoutMs ?? X_TIMEOUT_MS
  }

  async #get(url: string, timeoutMs = this.#timeout): Promise<{ res: Response; body: unknown }> {
    let res: Response
    try {
      res = await this.#fetch(url, { headers: { authorization: `Bearer ${this.#bearer}`, accept: 'application/json' }, signal: AbortSignal.timeout(Math.max(1, timeoutMs)), cache: 'no-store' })
    } catch {
      throw new XApiError('unavailable', 'X did not answer in time.')
    }
    const body = await res.json().catch(() => null)
    return { res, body }
  }

  #fail(res: Response): never {
    const s = res.status
    if (s === 429) throw new XApiError('rate-limited', 'X says to slow down. Scans resume when its window resets.', s, resetAtOf(res, this.#now()))
    if (s === 401 || s === 403) throw new XApiError('unauthorized', `X refused this server's key (HTTP ${s}).`, s)
    // 402 "credits depleted" (measured 2026-11-11): the key is good, the pay-per-use account has no credits left.
    if (s === 402) throw new XApiError('no-credits', "X's reading credits for this server are spent (HTTP 402).", s)
    if (s === 400) throw new XApiError('bad-request', 'X refused the search as written (HTTP 400).', s)
    throw new XApiError('unavailable', `X did not answer (HTTP ${s}).`, s)
  }

  async profile(handle: string): Promise<XProfile | null> {
    this.lastProfileMiss = null
    const { res, body } = await this.#get(profileUrl(handle))
    if (res.status === 404) {
      this.lastProfileMiss = 'unknown'
      return null
    }
    if (res.status !== 200) this.#fail(res)
    // X bills a user read whether or not it is the account we wanted.
    this.#unbilledUsd += X_USER_COST_USD
    this.spentUsd += X_USER_COST_USD
    const p = mapXUser(handle, body)
    if (!p) this.lastProfileMiss = xUserIsProtected(body) ? 'protected' : 'unknown'
    return p
  }

  async search(q: XSearchQueryTimed): Promise<XSearchResult> {
    this.lastStop = null
    const deadline = typeof q.deadlineMs === 'number' && Number.isFinite(q.deadlineMs) ? q.deadlineMs : Infinity
    const cap = Math.max(0, Math.floor(q.cap))
    const queries = buildSearchQueries(q.handle, q.terms)
    const byId = new Map<string, XPost>()
    let readCount = 0
    let truncated = false
    let first = true
    let authorId: string | null = null
    const settle = (): XSearchResult => {
      const costUsd = Math.round((readCount * X_POST_COST_USD + this.#unbilledUsd) * 1e6) / 1e6
      this.spentUsd += readCount * X_POST_COST_USD
      this.#unbilledUsd = 0
      const posts = [...byId.values()].sort((a, b) => b.postedAt - a.postedAt || (a.id < b.id ? 1 : -1))
      return { posts, readCount, costUsd, truncated }
    }
    outer: for (let qi = 0; qi < queries.length; qi++) {
      let next: string | undefined
      do {
        const left = cap - readCount
        if (left < X_PAGE_MIN) {
          truncated = true
          this.lastStop = 'cap'
          break outer
        }
        if (!first && this.#gap > 0) await new Promise((r) => setTimeout(r, this.#gap))
        // The scan's time budget (review R4e): no page is asked for once it has passed, and none outlives it.
        const timeLeft = deadline - this.#now()
        if (timeLeft <= 0) {
          truncated = true
          this.lastStop = 'deadline'
          break outer
        }
        first = false
        const url = searchUrl({ query: queries[qi], fromMs: q.fromMs, toMs: q.toMs, maxResults: left, sinceId: q.sinceId, nextToken: next, nowMs: this.#now() })
        let page: { res: Response; body: unknown }
        try {
          page = await this.#get(url, Math.min(this.#timeout, timeLeft))
          if (page.res.status !== 200) this.#fail(page.res)
        } catch (e) {
          // X stops the scan where it is (never a retry loop). What was
          // already read is kept, billed and returned as `truncated` (review
          // R4d: a 5xx or a timeout on page 2 used to lose page 1 and its
          // cost); nothing read yet = the error.
          if (e instanceof XApiError && readCount > 0) {
            truncated = true
            this.lastStop = e.kind === 'rate-limited' ? 'rate-limited' : 'error'
            break outer
          }
          throw e
        }
        const b = obj(page.body)
        const data = Array.isArray(b?.data) ? b.data : []
        readCount += data.length
        for (const raw of data) {
          authorId ??= str(obj(raw)?.author_id)
          const p = mapXPost(q.handle, raw, authorId)
          if (p && (!q.sinceId || BigInt(p.id) > BigInt(q.sinceId)) && p.postedAt <= q.toMs && (q.sinceId || p.postedAt >= q.fromMs)) byId.set(p.id, p)
        }
        next = str(obj(b?.meta)?.next_token) ?? undefined
      } while (next)
    }
    return settle()
  }
}
