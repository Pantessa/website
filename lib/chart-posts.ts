// Chart posts — the symbol page's forum (squad-markets 2026-09-11, COMM).
//
// A post is an ANNOTATED CHART (a lib/chart-state ChartState, ≤32KB, strict-
// parsed at write) or a PINNED LINK (https, public host — the brand-scan
// SSRF fence). Every post can be executed: when its chart state carries
// actions, the author mints the primary action as an intent link through the
// existing /api/intent-links door, the post carries `linkSlug`, readers press
// "Execute this idea" → the /i runtime, and the creator kickback follows the
// author. "Executed by N wallets" is the link's receipt-counted signed events
// (intent_link_events, COUNTED_EVENT_WHERE, internal rows excluded).
//
// UGC posture (QA re-checks):
//   - text only: title/body/comment are plain strings, control chars
//     stripped, length-capped; the tab renders them as text nodes — no
//     markdown, no HTML, ever
//   - no display names: an author is a lowercased wallet or the @handle the
//     wallet CLAIMED (creator_handles) — nothing self-reported
//   - links: https only, default port, public host (validateBrandUrl), the
//     LANDED page re-fenced when we scrape a title
//   - spam: per-wallet + per-IP hourly windows on the unsigned_turn_windows
//     bucket idiom (lib/turn-limits), loopback exempt, fail-open
//   - public reads fence is_internal:false (the #699 class) — by-id lookups
//     are the one unfenced read, exactly like /i/<slug>
//   - a chart state larger than 32KB, or that fails parseChartState, or that
//     names a different symbol than the post, is refused by name

import prisma from '@/lib/db'
import { chartPairFor } from '@/lib/charts'
import { mintSlug } from '@/lib/intent-links'
import { validateBrandUrl } from '@/lib/brand-scan'
import { COUNTED_EVENT_WHERE } from '@/lib/link-receipt-verify'
import { hashIp, hourStartUTC } from '@/lib/turn-limits'
import { chartStateToAsks, parseChartState, type ChartState } from '@/lib/chart-state'
import { COMMUNITY_SLUG_RE, parseVideoUrl, type TradeProof } from '@/lib/community/spec'

export type PostKind = 'idea' | 'link'
/** What a write may be (squad community 2026-11-09): the forum's two kinds
 *  plus a VIDEO (an allowlisted watch URL, rebuilt from its id) and a TRADE
 *  (the author's own receipt-verified fill, re-derived on the server). The
 *  symbol tab (listPosts / getPost) reads only the forum's two; the feed
 *  (lib/community/store listFeed) reads all four. */
export type DraftKind = PostKind | 'video' | 'trade'
export const DRAFT_KINDS: DraftKind[] = ['idea', 'link', 'video', 'trade']
export type PostSort = 'new' | 'executed'

export const POST_TITLE_MAX = 120
export const POST_BODY_MAX = 2_000
export const COMMENT_BODY_MAX = 1_000
export const CHART_STATE_MAX_BYTES = 32 * 1024
export const POST_LIST_MAX = 100

/** A person posting ideas on a symbol page is nowhere near these; a script is. */
export const POST_WALLET_HOURLY_CAP = 20
export const POST_IP_HOURLY_CAP = 60
export const COMMENT_WALLET_HOURLY_CAP = 60
export const COMMENT_IP_HOURLY_CAP = 200

const POST_ID_RE = /^[a-z0-9]{6,16}$/
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

// ── pure helpers (harness-pinned) ────────────────────────────────────────────

/** Plain text in, plain text out: control characters dropped (tab/newline
 *  kept), CRLF → LF, runs of blank lines collapsed, trimmed, capped. What
 *  comes back is what gets STORED and what gets rendered as a text node. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

export interface PostDraft {
  /** A charted ticker, or '' for a link / video post inside a room. */
  symbol: string
  kind: DraftKind
  title: string
  body: string
  chartState: ChartState | null
  linkUrl: string | null
  forkOf: string | null
  /** The room the post lives in (/g/<slug>), or null for the symbol forum. */
  community: string | null
  /** kind 'video': the REBUILT canonical watch URL (parseVideoUrl). */
  mediaUrl: string | null
  /** kind 'trade': the embed_turns id the proof is re-derived from. */
  proofTurnId: string | null
  /** kind 'trade': show the fill's dollar size (default true). */
  showSize: boolean
}

export type DraftVerdict = { ok: true; draft: PostDraft } | { ok: false; reason: string }

/** Validate a POST /api/posts body. Fail-closed on every field; every
 *  refusal names the field. `title` may be empty for a link post (the route
 *  scrapes one) — everything else is decided here. */
export function validatePostDraft(body: unknown): DraftVerdict {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'Invalid JSON body.' }
  const b = body as Record<string, unknown>

  const kind: DraftKind | null = b.kind === undefined ? 'idea' : DRAFT_KINDS.includes(b.kind as DraftKind) ? (b.kind as DraftKind) : null
  if (!kind) return { ok: false, reason: "kind must be 'idea', 'link', 'video' or 'trade'." }

  let community: string | null = null
  if (b.community !== undefined && b.community !== null && b.community !== '') {
    const c = typeof b.community === 'string' ? b.community.trim().toLowerCase() : ''
    if (!COMMUNITY_SLUG_RE.test(c)) return { ok: false, reason: 'community must be a room slug.' }
    community = c
  }

  // A symbol is required for an idea and a trade (fail closed through
  // chartPairFor). A link / video inside a room may be about no one market:
  // an empty symbol is '' there, a typed one must still chart. A trade's
  // symbol may also come from its proof (the route fills it in).
  const symbolTyped = typeof b.symbol === 'string' && b.symbol.trim() !== ''
  const pair = symbolTyped ? chartPairFor(b.symbol as string) : null
  const symbolOptional = (community !== null && (kind === 'link' || kind === 'video')) || kind === 'trade'
  if (!pair && (symbolTyped || !symbolOptional)) return { ok: false, reason: 'symbol must be a charted ticker (AAPL, ETH, HYPE…).' }

  const title = cleanText(b.title, POST_TITLE_MAX).replace(/\n+/g, ' ')
  if (kind === 'idea' && title.length < 3) return { ok: false, reason: `title is required (3–${POST_TITLE_MAX} characters).` }
  if (kind === 'video' && title.length < 3) return { ok: false, reason: `title is required (3–${POST_TITLE_MAX} characters).` }
  if (typeof b.title === 'string' && b.title.length > POST_TITLE_MAX) return { ok: false, reason: `title is over ${POST_TITLE_MAX} characters.` }

  if (b.body !== undefined && typeof b.body !== 'string') return { ok: false, reason: 'body must be plain text.' }
  if (typeof b.body === 'string' && b.body.length > POST_BODY_MAX) return { ok: false, reason: `body is over ${POST_BODY_MAX} characters.` }
  const text = cleanText(b.body, POST_BODY_MAX)

  let chartState: ChartState | null = null
  if (b.chartState !== undefined && b.chartState !== null) {
    let bytes = 0
    try {
      bytes = Buffer.byteLength(JSON.stringify(b.chartState), 'utf8')
    } catch {
      return { ok: false, reason: 'chartState must be JSON.' }
    }
    if (bytes > CHART_STATE_MAX_BYTES) return { ok: false, reason: `chartState is ${bytes} bytes; the cap is ${CHART_STATE_MAX_BYTES}.` }
    chartState = parseChartState(b.chartState)
    if (!chartState) return { ok: false, reason: 'chartState does not match the chart annotation schema (v1: symbol, tf, lines).' }
    if (!pair) return { ok: false, reason: 'A chart needs a symbol.' }
    if (chartState.symbol !== pair.symbol) return { ok: false, reason: `chartState is for ${chartState.symbol}, not ${pair.symbol}.` }
  }

  let linkUrl: string | null = null
  if (kind === 'link') {
    if (typeof b.linkUrl !== 'string' || !b.linkUrl.trim()) return { ok: false, reason: 'linkUrl is required for a link post.' }
    const gate = validateBrandUrl(b.linkUrl)
    if (!gate.ok) return { ok: false, reason: `linkUrl: ${gate.reason}` }
    linkUrl = gate.url.toString()
  } else if (b.linkUrl !== undefined && b.linkUrl !== null) {
    return { ok: false, reason: "linkUrl only belongs on a 'link' post." }
  }

  let mediaUrl: string | null = null
  if (kind === 'video') {
    const v = parseVideoUrl(b.mediaUrl)
    if (!v) return { ok: false, reason: 'mediaUrl must be a YouTube, Vimeo, Loom or X video link (https).' }
    mediaUrl = v.url
  } else if (b.mediaUrl !== undefined && b.mediaUrl !== null) {
    return { ok: false, reason: "mediaUrl only belongs on a 'video' post." }
  }

  let proofTurnId: string | null = null
  if (kind === 'trade') {
    if (typeof b.proofTurnId !== 'string' || !/^[a-z0-9]{8,40}$/i.test(b.proofTurnId)) return { ok: false, reason: 'proofTurnId is required for a trade post (one of your verified fills).' }
    proofTurnId = b.proofTurnId
  } else if (b.proofTurnId !== undefined && b.proofTurnId !== null) {
    return { ok: false, reason: "proofTurnId only belongs on a 'trade' post." }
  }
  if (b.showSize !== undefined && typeof b.showSize !== 'boolean') return { ok: false, reason: 'showSize must be true or false.' }
  const showSize = b.showSize !== false

  let forkOf: string | null = null
  if (b.forkOf !== undefined && b.forkOf !== null) {
    if (typeof b.forkOf !== 'string' || !POST_ID_RE.test(b.forkOf)) return { ok: false, reason: 'forkOf must be a post id.' }
    forkOf = b.forkOf
  }

  return { ok: true, draft: { symbol: pair?.symbol ?? '', kind, title, body: text, chartState, linkUrl, forkOf, community, mediaUrl, proofTurnId, showSize } }
}

/** The post's PRIMARY action — the first action in line order — or null. */
export function primaryAsk(state: ChartState | null): string | null {
  if (!state) return null
  return chartStateToAsks(state)[0] ?? null
}

/** Short 0x, or the @handle the wallet claimed. Never a free-text name. */
export function authorLabel(address: string, handle?: string | null): string {
  if (handle) return `@${handle}`
  const a = address.toLowerCase()
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Pure decision over post-increment counts (the turn-limits shape). */
export function decideWriteLimit(counts: { key: string; count: number }[], caps: { ip: number; wallet: number }): 'ip' | 'wallet' | null {
  let tripped: 'ip' | 'wallet' | null = null
  for (const { key, count } of counts) {
    if (key.includes(':i:') && count > caps.ip) return 'ip'
    if (key.includes(':w:') && count > caps.wallet) tripped = 'wallet'
  }
  return tripped
}

export function writeLimitReply(scope: 'ip' | 'wallet', what: 'post' | 'comment'): string {
  return scope === 'wallet'
    ? `That's a lot of ${what}s from one wallet in an hour — the lane reopens within the hour.`
    : `This connection has hit the hourly ${what} cap — it reopens within the hour.`
}

// ── fences (DB, fail-open) ───────────────────────────────────────────────────

/** Bump this write's windows (`cp:i:<hash>` / `cp:w:<wallet>` for posts,
 *  `cc:…` for comments) and decide. Loopback (no platform IP) skips the
 *  fence entirely — the module contract in lib/turn-limits. */
export async function bumpAndCheckPostWrite(ip: string | null, wallet: string, what: 'post' | 'comment'): Promise<'ip' | 'wallet' | null> {
  if (!ip) return null
  const prefix = what === 'post' ? 'cp' : 'cc'
  const caps = what === 'post' ? { ip: POST_IP_HOURLY_CAP, wallet: POST_WALLET_HOURLY_CAP } : { ip: COMMENT_IP_HOURLY_CAP, wallet: COMMENT_WALLET_HOURLY_CAP }
  const keys = [`${prefix}:i:${hashIp(ip)}`, `${prefix}:w:${wallet.toLowerCase()}`]
  try {
    const windowStart = hourStartUTC()
    const counts = await prisma.$queryRaw<{ key: string; count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      SELECT unnest(${keys}::text[]), ${windowStart}, 1
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING key, count
    `
    return decideWriteLimit(counts.map((c) => ({ key: c.key, count: Number(c.count) })), caps)
  } catch {
    return null
  }
}

// ── link meta (pinned links) ─────────────────────────────────────────────────

const HTML_MAX_BYTES = 512_000

/** Title for a pinned link, the /api/fetch-meta discipline: fenced URL, 8s,
 *  the LANDED page re-fenced, html only, bounded read, og:title → <title>.
 *  Null on anything else — the poster then has to type a title. */
export async function scrapeLinkTitle(url: string): Promise<string | null> {
  const gate = validateBrandUrl(url)
  if (!gate.ok) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(gate.url, { signal: controller.signal, redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'Pantessa-MetaFetcher/1.0' } })
    if (!validateBrandUrl(res.url || gate.url.toString()).ok) return null
    if (!res.ok) return null
    const ctype = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(ctype)) return null
    const html = (await res.text()).slice(0, HTML_MAX_BYTES)
    const m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const t = m?.[1] ? cleanText(decodeBasicEntities(m[1]), POST_TITLE_MAX).replace(/\n+/g, ' ') : ''
    return t.length >= 3 ? t : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()] ?? '')
}

// ── reads ────────────────────────────────────────────────────────────────────

export interface PublicComment {
  id: string
  author: string
  authorLabel: string
  body: string
  createdAt: number
}

export interface PublicPost {
  id: string
  symbol: string
  kind: PostKind
  title: string
  body: string
  chartState: ChartState | null
  /** Every action ask the chart carries, in line order; [0] is primary. */
  asks: string[]
  linkSlug: string | null
  linkUrl: string | null
  forkOf: string | null
  author: string
  authorLabel: string
  createdAt: number
  comments: number
  /** Distinct wallets with a receipt-counted signed event on the post's link. */
  executedBy: number
  isInternal: boolean
}

export type PostRow = {
  id: string
  symbol: string
  kind: string
  title: string
  body: string
  chartState: unknown
  linkSlug: string | null
  linkUrl: string | null
  forkOf: string | null
  author: string
  isInternal: boolean
  createdAt: Date
  // squad community (2026-11-09) — optional so a narrow select still decorates.
  communitySlug?: string | null
  mediaUrl?: string | null
  proofTurnId?: string | null
  proof?: unknown
  score?: number
}
type Row = PostRow
/** The kinds the symbol forum lists (a video / trade post lives in the feed). */
export const FORUM_KINDS: PostKind[] = ['idea', 'link']

export async function handlesFor(addresses: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (uniq.length === 0) return new Map()
  const rows = await prisma.creatorHandle.findMany({ where: { creator: { in: uniq } }, select: { creator: true, handle: true } }).catch(() => [])
  return new Map(rows.map((r) => [r.creator, r.handle]))
}

/** Distinct signing wallets per link slug — receipt-counted, never internal. */
export async function executedBySlug(slugs: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(slugs)]
  if (uniq.length === 0) return new Map()
  const rows = await prisma.intentLinkEvent
    .findMany({
      where: { slug: { in: uniq }, kind: 'signed', wallet: { not: null }, isInternal: false, ...COUNTED_EVENT_WHERE },
      select: { slug: true, wallet: true },
      distinct: ['slug', 'wallet'],
    })
    .catch(() => [])
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.slug, (m.get(r.slug) ?? 0) + 1)
  return m
}

/** Row → PublicPost (handles, executed-by, comment counts) in three batched
 *  reads. Exported for lib/community/store's feed, which adds its fields. */
export async function decoratePosts(rows: Row[]): Promise<PublicPost[]> {
  return decorate(rows)
}

async function decorate(rows: Row[]): Promise<PublicPost[]> {
  const [handles, executed, commentCounts] = await Promise.all([
    handlesFor(rows.map((r) => r.author)),
    executedBySlug(rows.map((r) => r.linkSlug).filter((s): s is string => !!s)),
    rows.length
      ? prisma.chartPostComment.groupBy({ by: ['postId'], where: { postId: { in: rows.map((r) => r.id) }, isInternal: false }, _count: { _all: true } }).catch(() => [])
      : Promise.resolve([] as { postId: string; _count: { _all: number } }[]),
  ])
  const comments = new Map(commentCounts.map((c) => [c.postId, c._count._all]))
  return rows.map((r) => {
    const state = parseChartState(r.chartState)
    return {
      id: r.id,
      symbol: r.symbol,
      kind: r.kind === 'link' ? 'link' : 'idea',
      title: r.title,
      body: r.body,
      chartState: state,
      asks: state ? chartStateToAsks(state) : [],
      linkSlug: r.linkSlug,
      linkUrl: r.linkUrl,
      forkOf: r.forkOf,
      author: r.author,
      authorLabel: authorLabel(r.author, handles.get(r.author)),
      createdAt: Math.floor(r.createdAt.getTime() / 1000),
      comments: comments.get(r.id) ?? 0,
      executedBy: r.linkSlug ? executed.get(r.linkSlug) ?? 0 : 0,
      isInternal: r.isInternal,
    }
  })
}

/** The symbol's public feed. `includeInternal` is ONLY for an internal-run
 *  caller reading its own harness rows back — never a public default. */
export async function listPosts(
  symbolRaw: string,
  opts: { sort?: PostSort; limit?: number; kind?: PostKind; includeInternal?: boolean } = {},
): Promise<PublicPost[] | null> {
  const pair = chartPairFor(symbolRaw)
  if (!pair) return null
  const limit = Math.max(1, Math.min(POST_LIST_MAX, Math.floor(opts.limit ?? 30) || 30))
  const rows = await prisma.chartPost.findMany({
    where: {
      symbol: pair.symbol,
      kind: opts.kind ? opts.kind : { in: FORUM_KINDS },
      // #699 class: the public listing fences internal rows OUT.
      ...(opts.includeInternal ? {} : { isInternal: false }),
    },
    orderBy: { createdAt: 'desc' },
    // Executed-first ranks in memory over a bounded newest window.
    take: opts.sort === 'executed' ? Math.max(limit, 200) : limit,
  })
  const posts = await decorate(rows)
  if (opts.sort === 'executed') {
    posts.sort((a, b) => b.executedBy - a.executedBy || (b.linkSlug ? 1 : 0) - (a.linkSlug ? 1 : 0) || b.createdAt - a.createdAt)
    return posts.slice(0, limit)
  }
  return posts
}

export async function getPost(id: string): Promise<(PublicPost & { commentList: PublicComment[] }) | null> {
  if (!POST_ID_RE.test(id)) return null
  const row = await prisma.chartPost.findUnique({ where: { id } })
  // The forum's reader (the symbol tab, /c/<id>): a video / trade post is the
  // feed's (lib/community/store getFeedPost) and reads as no forum post here.
  if (!row || !(FORUM_KINDS as string[]).includes(row.kind)) return null
  const [post] = await decorate([row])
  return { ...post, commentList: await readComments(id, row.isInternal) }
}

/** A post's comments, oldest first (internal comments only on an internal post). */
export async function readComments(postId: string, postIsInternal: boolean): Promise<PublicComment[]> {
  const comments = await prisma.chartPostComment.findMany({
    where: { postId, ...(postIsInternal ? {} : { isInternal: false }) },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })
  const handles = await handlesFor(comments.map((c) => c.author))
  return comments.map((c) => ({
    id: c.id,
    author: c.author,
    authorLabel: authorLabel(c.author, handles.get(c.author)),
    body: c.body,
    createdAt: Math.floor(c.createdAt.getTime() / 1000),
  }))
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function createPost(author: string, draft: PostDraft, isInternal: boolean, extra: { proof?: TradeProof | null } = {}): Promise<PublicPost> {
  const row = await prisma.chartPost.create({
    data: {
      id: mintSlug(10),
      symbol: draft.symbol,
      author: author.toLowerCase(),
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      chartState: draft.chartState ? (draft.chartState as object) : undefined,
      linkUrl: draft.linkUrl,
      forkOf: draft.forkOf,
      communitySlug: draft.community,
      mediaUrl: draft.mediaUrl,
      proofTurnId: draft.kind === 'trade' ? draft.proofTurnId : null,
      proof: extra.proof ? (extra.proof as object) : undefined,
      isInternal,
    },
  })
  const [post] = await decorate([row])
  return post
}

export async function addComment(postId: string, author: string, bodyRaw: unknown, isInternal: boolean): Promise<{ ok: true; comment: PublicComment } | { ok: false; reason: string; status: number }> {
  if (typeof bodyRaw !== 'string') return { ok: false, reason: 'body must be plain text.', status: 400 }
  if (bodyRaw.length > COMMENT_BODY_MAX) return { ok: false, reason: `Comments are capped at ${COMMENT_BODY_MAX} characters.`, status: 400 }
  const body = cleanText(bodyRaw, COMMENT_BODY_MAX)
  if (body.length < 1) return { ok: false, reason: 'Say something.', status: 400 }
  const post = await prisma.chartPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return { ok: false, reason: 'No such post.', status: 404 }
  const row = await prisma.chartPostComment.create({ data: { id: mintSlug(10), postId, author: author.toLowerCase(), body, isInternal } })
  const handles = await handlesFor([row.author])
  return {
    ok: true,
    comment: { id: row.id, author: row.author, authorLabel: authorLabel(row.author, handles.get(row.author)), body: row.body, createdAt: Math.floor(row.createdAt.getTime() / 1000) },
  }
}

/** Bind a minted intent link to its post. The route mints through the
 *  existing /api/intent-links door first; this only records the slug. */
export async function attachLink(postId: string, slug: string): Promise<void> {
  await prisma.chartPost.update({ where: { id: postId }, data: { linkSlug: slug } })
}
