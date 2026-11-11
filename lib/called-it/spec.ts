// CALLED IT: an X handle's market calls, pinned on a chart (squad called-it,
// 2026-11-11). This file is the squad's CONTRACT: the shapes every lane
// passes around and the pure rules that decide what a call is worth. It
// imports nothing but a type, so the browser, the server, the share image
// and the harness all read the same rules.
//
// THE HONESTY RULES (every lane holds these; the pins hold them too):
//   1. A post is X's own words. Its text, author and time are read from X by
//      the post's id. No model writes, shortens or rewords a post.
//   2. Bull or bear is a LABEL on the post. A label must quote a span that is
//      in the post, or it is dropped (lib/called-it/classify).
//   3. The result is ARITHMETIC on the chart's own daily candles: the close
//      of the day it was posted against the close JUDGE_DAYS later.
//   4. The tally is never curated. A viewer chooses which calls are pinned;
//      nobody chooses which calls are counted: the tally counts what the
//      SCAN found. A post a viewer pasted is shown and marked, never counted
//      (review R1: eight hand-picked posts must not read as a record).
//   5. A plot of somebody else's handle says "not verified". Only the
//      account itself, signed in with X, makes a plot "verified".
//   6. A post X no longer serves is never shown again.
import type { Candle } from '@/lib/charts'

// ── Shapes ──────────────────────────────────────────────────────────────

export type CallStance = 'bull' | 'bear'
/** The toggle. `all` is the default and is left out of every URL. */
export type CalledSide = 'all' | CallStance
export type CallVerdict = 'right' | 'wrong' | 'flat' | 'open'
export type Conviction = 1 | 2 | 3
export type XPostSource = 'x-api' | 'syndication' | 'fixture'

export interface XProfile {
  /** Lowercase, no @. */
  handle: string
  name: string
  avatarUrl: string | null
  followers: number | null
  /** X's own paid check. NOT our "verified" (see CalledRecord.verified). */
  blue: boolean
  xUserId: string | null
}

export interface XPost {
  id: string
  handle: string
  /** X's text, as X returned it. Rendered as text, never as HTML. */
  text: string
  /** Milliseconds. From X; for a snowflake id it must agree with snowflakeMs(id). */
  postedAt: number
  likes: number | null
  replies: number | null
  reposts: number | null
  isReply: boolean
  source: XPostSource
}

/** What the labeler says about one post, for one symbol. */
export interface CallLabel {
  stance: CallStance | 'none'
  /** 0 with `none`. 1 a lean, 2 a clear directional claim, 3 a stated prediction, target or position. */
  conviction: 0 | Conviction
  /** A span of the post's own text that carries the stance. Null with `none`. */
  quote: string | null
}

export interface CallMoves {
  /** The daily close of the day it was posted. */
  priceAt: number
  /** Unix seconds: the open time of that daily bar (where the pin stands). */
  barTime: number
  /** Fractions (0.12 = +12%). Null while that horizon has not elapsed. */
  d7: number | null
  d30: number | null
  d90: number | null
  /** Since the post, to the last close on the chart. */
  now: number
}

export interface CalledCall extends CallMoves {
  postId: string
  /** The post on X. Null for the fixture (its ids are not real posts). */
  url: string | null
  text: string
  postedAt: number
  likes: number | null
  replies: number | null
  stance: CallStance
  conviction: Conviction
  quote: string
  verdict: CallVerdict
  /** The move the verdict was read from: d30 once it exists, the move so far while open. */
  judgedPct: number
  impact: number
  /** Found by the scan, or pasted by a viewer. */
  origin: 'scan' | 'added'
  /** On the plot. The rule's choice unless the URL carried its own pins. */
  picked: boolean
}

export interface CalledTally {
  total: number
  right: number
  wrong: number
  flat: number
  open: number
}

/** What the scans of this handle on this symbol actually read (review R8). The chart's window is not coverage. */
export interface Coverage {
  /** The oldest moment the scans reached (ms): the window's start, or the oldest post read when the cap ended a scan early. */
  from: number
  to: number
  /** Posts read for THIS symbol's searches. */
  postsRead: number
  /** A scan stopped at its cap: posts older than `from` were not read. */
  truncated: boolean
}

export interface CalledRecord {
  handle: string
  /** Uppercase, the symbol page's spelling (/t/<symbol>). */
  symbol: string
  side: CalledSide
  profile: XProfile
  /** Set only when the account itself signed in with X. */
  verified: { at: number } | null
  /** Date ascending, already filtered to `side`. */
  calls: CalledCall[]
  /** For `side`. Counts every call the SCAN found, picked or not. A pasted post (origin `added`) is never counted. */
  tally: CalledTally
  bySide: Record<CallStance, CalledTally>
  /** A scan of this handle on this symbol has finished. False = the only calls here were pasted by viewers, and there is no tally. */
  scanned: boolean
  /** Calls in `calls` that a viewer pasted. Shown, marked, not counted. */
  added: number
  /** Null until a scan has finished. */
  coverage: Coverage | null
  window: { from: number; to: number }
  scannedAt: number | null
  postsRead: number
  priceNow: number
  /** `coverage` is null until scanned; `added` is null when nothing was pasted. */
  words: { headline: string; standing: string; method: string; coverage: string | null; added: string | null }
}

export type RecordResponse =
  /** `unlabeled` (lane JUDGE, round 2): cached posts in the window still waiting for a label; present only when > 0. Another scan request finishes them for free. */
  | { status: 'ready'; record: CalledRecord; unlabeled?: number }
  /** Nobody has scanned this handle on this symbol. `canScan` false carries the reason. */
  | { status: 'unscanned'; handle: string; symbol: string; canScan: boolean; reason?: string }
  | { status: 'scanning'; handle: string; symbol: string; scanId: string; progress: string }
  /** A named refusal. Never a bare one: `next` always offers somewhere to go. */
  | { status: 'refused'; reason: string; next: { label: string; href: string }[] }

// ── The source and the store (lane SOURCE implements, lane JUDGE consumes) ──

export interface XSearchQuery {
  handle: string
  /** OR-ed inside one parenthesis. Built by lib/called-it/terms. */
  terms: string[]
  fromMs: number
  toMs: number
  /** Hard ceiling on posts read (each one is billed). */
  cap: number
  /** Only posts newer than this id (an incremental re-scan). */
  sinceId?: string
}

export interface XSearchResult {
  posts: XPost[]
  readCount: number
  costUsd: number
  /** The cap ended the read before the window did. */
  truncated: boolean
}

export interface XSource {
  readonly name: 'x-api' | 'fixture'
  /** Null when there is no such public account. A miss is never a throw. */
  profile(handle: string): Promise<XProfile | null>
  /** Newest first. Retweets never; replies only when the query's terms ask. */
  search(q: XSearchQuery): Promise<XSearchResult>
}

/** One post by id over X's keyless embed endpoint (lane SOURCE: source/by-id). */
export type PostRead = { ok: true; post: XPost; profile: XProfile } | { ok: false; reason: 'gone' | 'unavailable' }

export interface StoredLabel extends CallLabel {
  postId: string
  symbol: string
  origin: 'scan' | 'added'
  model: string | null
}

export interface ScanRow {
  id: string
  handle: string
  symbol: string
  status: 'running' | 'done' | 'failed' | 'refused'
  postsRead: number
  callsFound: number
  costUsd: number
  note: string | null
  startedAt: number
  finishedAt: number | null
}

/** Who asked: `x:<user id>`, `w:<wallet>` or `ip:<hash>`. Only the first two are proven. */
export type Requester = string

// ── Limits and money ────────────────────────────────────────────────────

/** X's pay-per-use rates, measured from docs.x.com on 2026-11-11. */
export const X_POST_COST_USD = 0.005
export const X_USER_COST_USD = 0.01
/** A scan reads back as far as the daily chart holds. */
export const SCAN_WINDOW_DAYS = 365
/** Posts one scan may read (env XCALLS_SCAN_POST_CAP). 400 posts = $2. */
export const SCAN_POST_CAP = 400
/** What the house spends on X reads in one UTC day before scans rest (env XCALLS_DAILY_USD_CAP). */
export const DAILY_USD_CAP = 10
export const GUEST_SCANS_PER_DAY = 2
export const PROVEN_SCANS_PER_DAY = 10
/** Pasted posts one requester may add in a UTC day, and in one minute (review R2: each one is a model call). */
export const GUEST_ADDS_PER_DAY = 10
export const PROVEN_ADDS_PER_DAY = 40
export const ADDS_PER_MINUTE = 4
/** Handle lookups on X one requester may cause in a UTC day, misses included (review R4: each is a billed profile read). */
export const GUEST_LOOKUPS_PER_DAY = 12
export const PROVEN_LOOKUPS_PER_DAY = 40
/** An account is LISTED on /x only above this many followers, or when its owner verified (review R19). Anyone can still be plotted by name. */
export const LIST_MIN_FOLLOWERS = 5000
/** Characters of one post that go to the labeler (X allows 25,000). The quote is still checked against the whole post. */
export const PROMPT_POST_MAX = 1200
/** A finished scan is fresh this long; after it a re-scan reads only newer posts. */
export const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000

export const ENV = {
  /** App-only bearer for X API reads. Unset = no scans (cached records and pasted posts still work). */
  bearer: 'X_BEARER_TOKEN',
  oauthClientId: 'X_OAUTH_CLIENT_ID',
  /** Optional: set when the X app is a confidential client. */
  oauthClientSecret: 'X_OAUTH_CLIENT_SECRET',
  dailyUsdCap: 'XCALLS_DAILY_USD_CAP',
  scanPostCap: 'XCALLS_SCAN_POST_CAP',
  /** `1` = the harness: the fixture source, the keyword labeler, the fake X sign-in. Never on prod. */
  fake: 'XCALLS_FAKE',
  /** The labeler's own model id (review: it must not follow the markets AI's model when that changes). */
  model: 'XCALLS_MODEL',
} as const

/**
 * THE one fence for fake mode (review R6). Off on every Vercel deployment,
 * production and preview alike (Vercel sets VERCEL=1), whatever XCALLS_FAKE
 * says: a preview can share production's database and session secret.
 */
export function fakeModeOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.XCALLS_FAKE === '1' && !env.VERCEL && env.VERCEL_ENV !== 'production'
}

/** A user id the fake sign-in wrote. A claim by one never reads "Verified" outside fake mode, whatever database it is in. */
export function isFakeXUserId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('fake-')
}

// ── Handles and post links ──────────────────────────────────────────────

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
/** x.com paths that are not accounts. */
const RESERVED_HANDLES = new Set(['i', 'home', 'explore', 'search', 'settings', 'intent', 'share', 'hashtag', 'notifications', 'messages', 'compose', 'login', 'signup', 'tos', 'privacy'])
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'mobile.x.com'])

/** `@CZ_Binance`, `cz_binance` or a pasted profile link → `cz_binance`. Null for anything else. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (s.length > 200) return null
  if (/[/.]/.test(s)) {
    let u: URL
    try {
      u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    } catch {
      return null
    }
    if (!X_HOSTS.has(u.hostname.toLowerCase())) return null
    const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname)
    if (!m) return null
    s = m[1]
  }
  s = s.replace(/^@/, '')
  if (!HANDLE_RE.test(s)) return null
  const h = s.toLowerCase()
  return RESERVED_HANDLES.has(h) ? null : h
}

export const POST_ID_RE = /^\d{5,20}$/

/** A post link (x.com / twitter.com, any of their spellings) or a bare id → its id and, when the link names one, its handle. */
export function postRefFromUrl(raw: unknown): { handle: string | null; id: string } | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length > 400) return null
  if (POST_ID_RE.test(s)) return { handle: null, id: s }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!X_HOSTS.has(u.hostname.toLowerCase())) return null
  const m = /^\/(?:([A-Za-z0-9_]{1,15})|i\/web)\/status(?:es)?\/(\d{5,20})(?:\/.*)?$/.exec(u.pathname)
  if (!m) return null
  const h = m[1]?.toLowerCase() ?? null
  return { handle: h && !RESERVED_HANDLES.has(h) ? h : null, id: m[2] }
}

export function postUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`
}

export const TWITTER_EPOCH_MS = 1288834974657
/** The time X stamped INTO a post's id. Null for ids from before November 2010 (they carry none). */
export function snowflakeMs(id: string): number | null {
  if (!POST_ID_RE.test(id)) return null
  const n = BigInt(id)
  if (n < BigInt(2 ** 35)) return null
  return Number((n >> BigInt(22)) + BigInt(TWITTER_EPOCH_MS))
}

/** X's `created_at` and the id's own clock agree (ids without a clock pass). */
export function postTimeAgrees(id: string, postedAt: number, toleranceMs = 2000): boolean {
  const ms = snowflakeMs(id)
  return ms === null || Math.abs(ms - postedAt) <= toleranceMs
}

/** Order two post ids as the numbers they are. */
export function cmpPostId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

export function normalizeSide(raw: unknown): CalledSide {
  return raw === 'bull' || raw === 'bear' ? raw : 'all'
}

/** The share landing. */
export function recordHref(handle: string, symbol: string, side: CalledSide = 'all'): string {
  return `/x/${handle}/${encodeURIComponent(symbol.toUpperCase())}${side === 'all' ? '' : `?side=${side}`}`
}

/** The same plot on the live chart. */
export function chartHref(handle: string, symbol: string, side: CalledSide = 'all'): string {
  return `/t/${encodeURIComponent(symbol.toUpperCase())}?x=${handle}${side === 'all' ? '' : `&side=${side}`}`
}

// ── What a call is worth (the arithmetic) ───────────────────────────────

const DAY_MS = 86_400_000
/** A call is judged on the close this many days after it. */
export const JUDGE_DAYS = 30
/** A move smaller than this either way is "no real move". */
export const DEAD_BAND = 0.03
export const HORIZON_DAYS = [7, 30, 90] as const

/** The last bar that had opened by `ms`. -1 before the first bar. Candles are date ascending. */
export function barIndexAt(candles: readonly Candle[], ms: number): number {
  let lo = 0
  let hi = candles.length - 1
  let at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].t * 1000 <= ms) {
      at = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return at
}

/** Null when the post is older than the chart's first bar, or the chart is empty. */
export function movesFor(candles: readonly Candle[], postedAt: number, nowMs: number): CallMoves | null {
  const i = barIndexAt(candles, postedAt)
  if (i < 0) return null
  const priceAt = candles[i].c
  if (!(priceAt > 0)) return null
  const after = (days: number): number | null => {
    const target = postedAt + days * DAY_MS
    if (target > nowMs) return null
    const j = barIndexAt(candles, target)
    return j < 0 ? null : candles[j].c / priceAt - 1
  }
  return { priceAt, barTime: candles[i].t, d7: after(7), d30: after(30), d90: after(90), now: candles[candles.length - 1].c / priceAt - 1 }
}

export function verdictFor(stance: CallStance, moves: Pick<CallMoves, 'd30' | 'now'>): { verdict: CallVerdict; judgedPct: number } {
  if (moves.d30 === null) return { verdict: 'open', judgedPct: moves.now }
  const signed = stance === 'bull' ? moves.d30 : -moves.d30
  return { verdict: signed >= DEAD_BAND ? 'right' : signed <= -DEAD_BAND ? 'wrong' : 'flat', judgedPct: moves.d30 }
}

const CONVICTION_WEIGHT: Record<Conviction, number> = { 1: 0.6, 2: 1, 3: 1.5 }
const VERDICT_WEIGHT: Record<CallVerdict, number> = { right: 1, wrong: 1, open: 0.6, flat: 0.25 }

/** How much a call matters: how sure it sounded, how many people saw it, how far the price went. Right and wrong weigh the same. */
export function impactOf(c: { conviction: Conviction; likes: number | null; judgedPct: number; verdict: CallVerdict }): number {
  const reach = Math.log10(10 + Math.max(0, c.likes ?? 0))
  const size = Math.min(1, Math.abs(c.judgedPct))
  return Math.round(CONVICTION_WEIGHT[c.conviction] * reach * size * VERDICT_WEIGHT[c.verdict] * 10_000) / 10_000
}

export function tallyOf(calls: readonly Pick<CalledCall, 'verdict'>[]): CalledTally {
  const t: CalledTally = { total: calls.length, right: 0, wrong: 0, flat: 0, open: 0 }
  for (const c of calls) t[c.verdict]++
  return t
}

/** Pins on one plot. Six cards is what a chart holds before it reads as noise. */
export const PICK_MAX = 6
/** A URL may carry its own pins, up to this many. */
export const PIN_URL_MAX = 8

/**
 * Which calls are pinned: the highest impact first, never two closer than
 * `minGapSec` on the time axis, and the best hit and the worst miss both on
 * the plot whenever both exist (a plot is never all wins by the rule's hand).
 * Returns ids, date ascending.
 */
export function pickCalls(calls: readonly Pick<CalledCall, 'postId' | 'barTime' | 'impact' | 'verdict'>[], opts: { max?: number; minGapSec?: number } = {}): string[] {
  const max = opts.max ?? PICK_MAX
  const gap = opts.minGapSec ?? 0
  const ranked = [...calls].sort((a, b) => b.impact - a.impact || cmpPostId(a.postId, b.postId))
  const taken: typeof ranked = []
  const clear = (c: (typeof ranked)[number]) => taken.every((t) => Math.abs(t.barTime - c.barTime) >= gap)
  for (const kind of ['right', 'wrong'] as const) {
    if (taken.length >= max) break
    const top = ranked.find((c) => c.verdict === kind && !taken.includes(c) && clear(c)) ?? ranked.find((c) => c.verdict === kind && !taken.includes(c))
    if (top) taken.push(top)
  }
  for (const c of ranked) {
    if (taken.length >= max) break
    if (!taken.includes(c) && clear(c)) taken.push(c)
  }
  return taken.sort((a, b) => a.barTime - b.barTime || cmpPostId(a.postId, b.postId)).map((c) => c.postId)
}

// ── The words (rule-composed, ASCII) ────────────────────────────────────

export const VERDICT_WORDS: Record<CallVerdict, string> = { right: 'called it', wrong: 'missed', flat: 'no real move', open: 'too early to say' }
export const STANDING_NOT_VERIFIED = 'Not verified. Plotted by a viewer from public posts.'
export function standingVerified(handle: string): string {
  return `Verified. @${handle} signed in with X.`
}
export const METHOD_LINE = `Posts come from X: its search for a scan, its public post page for a pasted link. A model labels each post bull or bear and must quote the post's own words. The result is this chart's daily close ${JUDGE_DAYS} days after the post.`
/** Said wherever labels are shown. */
export const LABEL_CAVEAT = 'A model wrote each label, and a label can be wrong.'
export const DELETED_NOTE = 'A post deleted on X leaves this record.'
export const ADDED_MARK = 'added by a viewer'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `3 Aug 2026`, UTC. */
export function fmtDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** `+23.4%` / `-29.1%`, ASCII. */
export function fmtMove(p: number): string {
  const v = Math.round(p * 1000) / 10
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)}%`
}

/** `-29.1% in 30 days` once judged, `+4.0% so far` while open. */
export function moveLine(c: Pick<CalledCall, 'verdict' | 'judgedPct'>): string {
  return c.verdict === 'open' ? `${fmtMove(c.judgedPct)} so far` : `${fmtMove(c.judgedPct)} in ${JUDGE_DAYS} days`
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the scans read, in words. The cap ending a scan early is said, never hidden. */
export function coverageLine(c: Coverage): string {
  if (c.truncated) return `Read the newest ${count(c.postsRead, 'matching post')}, back to ${fmtDay(c.from)}. Older posts were not read.`
  return `Read ${count(c.postsRead, 'matching post')} from ${fmtDay(c.from)} to ${fmtDay(c.to)}.`
}

/** Beside a scanned record's tally when viewers pasted posts too. */
export function addedLine(added: number): string {
  return `${count(added, 'more post')} ${added === 1 ? 'was' : 'were'} added by viewers. ${added === 1 ? 'It is' : 'They are'} shown and not counted.`
}

/**
 * The record in one sentence. `state` matters only for a record with no
 * finished scan: its pasted posts are counted as posts, never as a tally.
 */
export function recordHeadline(handle: string, symbol: string, side: CalledSide, tally: CalledTally, state: { scanned: boolean; added: number } = { scanned: true, added: 0 }): string {
  const who = side === 'all' ? `@${handle} on ${symbol}` : `@${handle}, ${side === 'bull' ? 'bullish' : 'bearish'} on ${symbol}`
  if (!state.scanned) return state.added > 0 ? `${who}: ${count(state.added, 'post')} added by a viewer. No scan yet, so no tally.` : `${who}: not scanned yet.`
  if (tally.total === 0) return `${who}: no calls found in this window.`
  const parts = [count(tally.total, 'call')]
  if (tally.right) parts.push(`${tally.right} called it`)
  if (tally.wrong) parts.push(`${tally.wrong} missed`)
  if (tally.flat) parts.push(`${tally.flat} no real move`)
  if (tally.open) parts.push(`${tally.open} too early to say`)
  return `${who}: ${parts.join(', ')}.`
}

// ── One record from its parts (pure) ────────────────────────────────────

export interface LabeledPost extends XPost {
  label: CallLabel
  origin: 'scan' | 'added'
}

export interface BuildRecordInput {
  handle: string
  symbol: string
  side: CalledSide
  profile: XProfile
  verified: { at: number } | null
  posts: readonly LabeledPost[]
  /** Daily candles, date ascending. */
  candles: readonly Candle[]
  nowMs: number
  scannedAt: number | null
  postsRead: number
  /** The viewer's own pins (post ids). Unknown ids are ignored; none valid = the rule picks. */
  pins?: readonly string[]
  /** A scan of this handle on this symbol has finished. Defaults to `scannedAt !== null`. */
  scanned?: boolean
  /** What those scans read. Left out: derived from the candles' window and `postsRead`, not truncated. */
  coverage?: Coverage | null
}

/** The quote is the post's own words (whitespace aside). The one check between a label and a pin. */
export function quoteIsFromPost(quote: string | null, text: string): quote is string {
  if (!quote) return false
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
  const q = flat(quote)
  return q.length >= 3 && flat(text).includes(q)
}

export function buildRecord(input: BuildRecordInput): CalledRecord {
  const { handle, side, profile, candles, nowMs } = input
  const symbol = input.symbol.toUpperCase()
  const seen = new Set<string>()
  const every: CalledCall[] = []
  for (const p of input.posts) {
    const { label } = p
    if (label.stance === 'none' || label.conviction === 0 || seen.has(p.id)) continue
    if (p.handle !== handle || !quoteIsFromPost(label.quote, p.text) || !postTimeAgrees(p.id, p.postedAt)) continue
    const moves = movesFor(candles, p.postedAt, nowMs)
    if (!moves) continue
    seen.add(p.id)
    const { verdict, judgedPct } = verdictFor(label.stance, moves)
    const conviction = label.conviction
    every.push({
      ...moves,
      postId: p.id,
      url: p.source === 'fixture' ? null : postUrl(handle, p.id),
      text: p.text,
      postedAt: p.postedAt,
      likes: p.likes,
      replies: p.replies,
      stance: label.stance,
      conviction,
      quote: label.quote,
      verdict,
      judgedPct,
      impact: impactOf({ conviction, likes: p.likes, judgedPct, verdict }),
      origin: p.origin,
      picked: false,
    })
  }
  every.sort((a, b) => a.postedAt - b.postedAt || cmpPostId(a.postId, b.postId))
  // The tally is what the SCAN found. A pasted post is shown and marked, never counted (rule 4, review R1).
  const found = every.filter((c) => c.origin === 'scan')
  const bySide: Record<CallStance, CalledTally> = { bull: tallyOf(found.filter((c) => c.stance === 'bull')), bear: tallyOf(found.filter((c) => c.stance === 'bear')) }
  const calls = side === 'all' ? every : every.filter((c) => c.stance === side)
  const counted = calls.filter((c) => c.origin === 'scan')
  const added = calls.length - counted.length
  const scanned = input.scanned ?? input.scannedAt !== null
  // The record's window is the scan's reach (a year), widened to hold an older pasted post, never past the chart's first bar.
  // (A stock's daily series holds five years: spacing pins by THAT span left three pins on a year of calls.)
  const firstBarMs = candles.length ? candles[0].t * 1000 : nowMs
  const reachMs = nowMs - SCAN_WINDOW_DAYS * DAY_MS
  const windowFrom = Math.max(firstBarMs, Math.min(reachMs, every.length ? every[0].postedAt - 7 * DAY_MS : reachMs))
  const span = Math.max(0, Math.round((nowMs - windowFrom) / 1000))
  const own = (input.pins ?? []).filter((id, i, a) => a.indexOf(id) === i && calls.some((c) => c.postId === id)).slice(0, PIN_URL_MAX)
  // The rule pins from what the scan found. With no scan there is nothing to rank against, so the pasted posts are the plot.
  const picked = new Set(own.length ? own : pickCalls(counted.length ? counted : calls, { minGapSec: Math.round(span / 14) }))
  for (const c of calls) c.picked = picked.has(c.postId)
  const tally = tallyOf(counted)
  const coverage: Coverage | null = !scanned ? null : (input.coverage ?? { from: Math.max(firstBarMs, reachMs), to: input.scannedAt ?? nowMs, postsRead: input.postsRead, truncated: false })
  return {
    handle,
    symbol,
    side,
    profile,
    verified: input.verified,
    calls,
    tally,
    bySide,
    window: { from: windowFrom, to: nowMs },
    scanned,
    added,
    coverage,
    scannedAt: input.scannedAt,
    postsRead: input.postsRead,
    priceNow: candles.length ? candles[candles.length - 1].c : 0,
    words: {
      headline: recordHeadline(handle, symbol, side, tally, { scanned, added }),
      standing: input.verified ? standingVerified(handle) : STANDING_NOT_VERIFIED,
      method: METHOD_LINE,
      coverage: coverage ? coverageLine(coverage) : null,
      added: scanned && added > 0 ? addedLine(added) : null,
    },
  }
}
