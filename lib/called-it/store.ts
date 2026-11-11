// The post cache and the scan ledger (tables x_handles, x_posts, x_calls,
// x_scans; prisma/ddl/2026-11-11-called-it.sql).
//
// Lane SOURCE (squad called-it, 2026-11-11) wrote the bodies; the signatures
// are the contract's. Functions added after the contract are marked ADDED.
//
// Fences held here (the pins hold them too):
//   - a gone post is never returned and never counted (postsFor, labelsFor,
//     listPlotted);
//   - an internal scan never lists (listPlotted);
//   - two people asking for one handle on one symbol share one running scan
//     (startScan, under a transaction-scoped advisory lock);
//   - handles are lowercase and symbols uppercase in every row.
import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import type { Requester, ScanRow, StoredLabel, XPost, XProfile } from './spec'

export interface StoredHandle extends XProfile {
  isProtected: boolean
  /** Set when the account itself signed in with X (lane AUTH writes it through claimHandle). */
  claimedXUserId: string | null
  claimedAt: number | null
  readAt: number | null
}

export interface PlottedRow {
  handle: string
  symbol: string
  name: string | null
  avatarUrl: string | null
  verified: boolean
  /** Posts labeled bull or bear for this symbol (gone posts excluded). */
  calls: number
  scannedAt: number
}

/** A running scan this young is joined, not repeated. Older is abandoned (a route lives 60 s at most). */
export const SCAN_JOIN_MS = 2 * 60 * 1000

const h = (s: string) => s.trim().toLowerCase()
const sym = (s: string) => s.trim().toUpperCase()
const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null)

export function utcDayStart(nowMs: number): Date {
  return new Date(Math.floor(nowMs / 86_400_000) * 86_400_000)
}

type ScanDb = {
  id: string
  handle: string
  symbol: string
  status: string
  postsRead: number
  callsFound: number
  costUsd: number
  note: string | null
  startedAt: Date
  finishedAt: Date | null
}

function scanRow(r: ScanDb): ScanRow {
  const status = (['running', 'done', 'failed', 'refused'] as const).find((s) => s === r.status) ?? 'failed'
  return { id: r.id, handle: r.handle, symbol: r.symbol, status, postsRead: r.postsRead, callsFound: r.callsFound, costUsd: r.costUsd, note: r.note, startedAt: r.startedAt.getTime(), finishedAt: ms(r.finishedAt) }
}

type PostDb = { postId: string; handle: string; text: string; postedAt: Date; likes: number | null; replies: number | null; reposts: number | null; isReply: boolean; source: string }

function postOf(r: PostDb): XPost {
  const source = r.source === 'x-api' || r.source === 'fixture' ? r.source : 'syndication'
  return { id: r.postId, handle: r.handle, text: r.text, postedAt: r.postedAt.getTime(), likes: r.likes, replies: r.replies, reposts: r.reposts, isReply: r.isReply, source }
}

// ── Handles ───────────────────────────────────────────────────────────────

export async function getHandle(handle: string): Promise<StoredHandle | null> {
  const r = await prisma.xHandle.findUnique({ where: { handle: h(handle) } })
  if (!r) return null
  return {
    handle: r.handle,
    name: r.name ?? r.handle,
    avatarUrl: r.avatarUrl,
    followers: r.followers,
    blue: r.isBlue,
    xUserId: r.xUserId,
    isProtected: r.isProtected,
    claimedXUserId: r.claimedXUserId,
    claimedAt: ms(r.claimedAt),
    readAt: ms(r.readAt),
  }
}

/** Insert or refresh what X says about an account. Never touches the claim. */
export async function saveProfile(profile: XProfile & { isProtected?: boolean }): Promise<void> {
  const handle = h(profile.handle)
  const fields = {
    xUserId: profile.xUserId,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    followers: profile.followers,
    isBlue: profile.blue,
    readAt: new Date(),
    ...(profile.isProtected === undefined ? {} : { isProtected: profile.isProtected }),
  }
  await prisma.xHandle.upsert({ where: { handle }, create: { handle, ...fields }, update: fields })
}

/**
 * The account itself signed in with X. Overwrites an older claim by a
 * different user id (a handle can change hands). The same user claiming again
 * keeps the first claim's time. A handle this user id claimed before under
 * another name loses that claim (the account renamed; the old name may be
 * someone else's now).
 */
export async function claimHandle(handle: string, xUserId: string, profile?: Partial<XProfile>): Promise<void> {
  const name = h(handle)
  const now = new Date()
  const fromProfile = {
    ...(profile?.name !== undefined ? { name: profile.name } : {}),
    ...(profile?.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile?.followers !== undefined ? { followers: profile.followers } : {}),
    ...(profile?.blue !== undefined ? { isBlue: profile.blue } : {}),
  }
  await prisma.$transaction(async (tx) => {
    await tx.xHandle.updateMany({ where: { claimedXUserId: xUserId, NOT: { handle: name } }, data: { claimedXUserId: null, claimedAt: null } })
    const prior = await tx.xHandle.findUnique({ where: { handle: name }, select: { claimedXUserId: true, claimedAt: true } })
    const claimedAt = prior?.claimedXUserId === xUserId && prior.claimedAt ? prior.claimedAt : now
    const data = { xUserId, claimedXUserId: xUserId, claimedAt, readAt: now, ...fromProfile }
    await tx.xHandle.upsert({ where: { handle: name }, create: { handle: name, ...data }, update: data })
  })
}

// ── Posts ─────────────────────────────────────────────────────────────────

/**
 * Upsert by post id. Refreshes the text, the counts and the read time; never
 * clears goneAt, and never changes the handle or the source a post was first
 * stored under (so a keyless refresh never turns a scanned post into a pasted one).
 */
export async function savePosts(posts: readonly XPost[]): Promise<void> {
  const rows = new Map<string, XPost>()
  for (const p of posts) rows.set(p.id, p)
  const list = [...rows.values()]
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    await prisma.$executeRaw`
      INSERT INTO x_posts (post_id, handle, text, posted_at, likes, replies, reposts, is_reply, source, read_at)
      SELECT t.post_id, t.handle, t.text, t.posted_at, t.likes, t.replies, t.reposts, t.is_reply, t.source, now()
      FROM unnest(
        ${chunk.map((p) => p.id)}::text[],
        ${chunk.map((p) => h(p.handle))}::text[],
        ${chunk.map((p) => p.text)}::text[],
        ${chunk.map((p) => new Date(p.postedAt).toISOString())}::timestamptz[],
        ${chunk.map((p) => p.likes)}::int[],
        ${chunk.map((p) => p.replies)}::int[],
        ${chunk.map((p) => p.reposts)}::int[],
        ${chunk.map((p) => p.isReply)}::boolean[],
        ${chunk.map((p) => p.source)}::text[]
      ) AS t(post_id, handle, text, posted_at, likes, replies, reposts, is_reply, source)
      ON CONFLICT (post_id) DO UPDATE SET
        -- oEmbed's words are a rebuild from X's HTML: never over a scanned post's own text
        text = CASE WHEN EXCLUDED.source = 'syndication' AND x_posts.source <> 'syndication' THEN x_posts.text ELSE EXCLUDED.text END,
        likes = COALESCE(EXCLUDED.likes, x_posts.likes),
        replies = COALESCE(EXCLUDED.replies, x_posts.replies),
        reposts = COALESCE(EXCLUDED.reposts, x_posts.reposts),
        read_at = now()`
  }
}

/** A handle's cached posts from `fromMs` on, date ascending. Gone posts are never returned. */
export async function postsFor(handle: string, fromMs: number): Promise<XPost[]> {
  const rows = await prisma.xPost.findMany({ where: { handle: h(handle), goneAt: null, postedAt: { gte: new Date(fromMs) } }, orderBy: [{ postedAt: 'asc' }, { postId: 'asc' }] })
  return rows.map(postOf)
}

/**
 * The newest post a SCAN stored for this handle (an incremental re-scan reads
 * after it). Pasted posts (source `syndication`) never count: a post added
 * today must not make the next scan skip everything before it.
 */
export async function newestPostId(handle: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ post_id: string }[]>`
    SELECT post_id FROM x_posts WHERE handle = ${h(handle)} AND source <> 'syndication'
    ORDER BY length(post_id) DESC, post_id DESC LIMIT 1`
  return rows[0]?.post_id ?? null
}

/** X no longer serves these. They are never shown again. */
export async function markGone(postIds: readonly string[]): Promise<void> {
  if (!postIds.length) return
  await prisma.xPost.updateMany({ where: { postId: { in: [...postIds] }, goneAt: null }, data: { goneAt: new Date() } })
}

/** ADDED (for refreshGone): of these ids, the ones still shown whose last read is older than `beforeMs`, stalest first. */
export async function postsReadBefore(postIds: readonly string[], beforeMs: number, limit: number): Promise<string[]> {
  if (!postIds.length || limit <= 0) return []
  const rows = await prisma.xPost.findMany({ where: { postId: { in: [...postIds] }, goneAt: null, readAt: { lt: new Date(beforeMs) } }, orderBy: { readAt: 'asc' }, take: limit, select: { postId: true } })
  return rows.map((r) => r.postId)
}

// ── Labels ────────────────────────────────────────────────────────────────

/** Every label (`none` included, so a post is never labeled twice) for a handle's posts on one symbol. Gone posts excluded. */
export async function labelsFor(handle: string, symbol: string): Promise<StoredLabel[]> {
  const rows = await prisma.$queryRaw<{ post_id: string; symbol: string; stance: string; conviction: number; quote: string | null; model: string | null; origin: string }[]>`
    SELECT c.post_id, c.symbol, c.stance, c.conviction, c.quote, c.model, c.origin
    FROM x_calls c JOIN x_posts p ON p.post_id = c.post_id
    WHERE p.handle = ${h(handle)} AND c.symbol = ${sym(symbol)} AND p.gone_at IS NULL
    ORDER BY c.post_id`
  return rows.map((r) => {
    const stance = r.stance === 'bull' || r.stance === 'bear' ? r.stance : 'none'
    const conviction = stance === 'none' ? 0 : r.conviction === 1 || r.conviction === 2 || r.conviction === 3 ? r.conviction : 0
    return { postId: r.post_id, symbol: r.symbol, stance, conviction, quote: r.quote, model: r.model, origin: r.origin === 'added' ? 'added' : 'scan' }
  })
}

export async function saveLabels(labels: readonly StoredLabel[]): Promise<void> {
  const rows = new Map<string, StoredLabel>()
  for (const l of labels) rows.set(`${l.postId}|${sym(l.symbol)}`, l)
  const list = [...rows.values()]
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    await prisma.$executeRaw`
      INSERT INTO x_calls (post_id, symbol, stance, conviction, quote, model, origin, labeled_at)
      SELECT t.post_id, t.symbol, t.stance, t.conviction, t.quote, t.model, t.origin, now()
      FROM unnest(
        ${chunk.map((l) => l.postId)}::text[],
        ${chunk.map((l) => sym(l.symbol))}::text[],
        ${chunk.map((l) => l.stance)}::text[],
        ${chunk.map((l) => (l.stance === 'none' ? 0 : l.conviction))}::int[],
        ${chunk.map((l) => (l.stance === 'none' ? null : l.quote))}::text[],
        ${chunk.map((l) => l.model)}::text[],
        ${chunk.map((l) => l.origin)}::text[]
      ) AS t(post_id, symbol, stance, conviction, quote, model, origin)
      ON CONFLICT (post_id, symbol) DO UPDATE SET
        stance = EXCLUDED.stance, conviction = EXCLUDED.conviction, quote = EXCLUDED.quote,
        model = EXCLUDED.model, origin = EXCLUDED.origin, labeled_at = now()`
  }
}

// ── Scans ─────────────────────────────────────────────────────────────────

export async function latestScan(handle: string, symbol: string): Promise<ScanRow | null> {
  const r = await prisma.xScan.findFirst({ where: { handle: h(handle), symbol: sym(symbol) }, orderBy: { startedAt: 'desc' } })
  return r ? scanRow(r) : null
}

export async function getScan(id: string): Promise<ScanRow | null> {
  if (typeof id !== 'string' || !/^xs_[a-z0-9]{1,40}$/.test(id)) return null
  const r = await prisma.xScan.findUnique({ where: { id } })
  return r ? scanRow(r) : null
}

function scanId(): string {
  return `xs_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`
}

/**
 * Opens a `running` row, or returns the one already running for this handle
 * and symbol (two people asking share one scan). A `running` row older than
 * SCAN_JOIN_MS is a scan whose request died: it is finished as `failed` here
 * so it never blocks or misleads a later one.
 */
export async function startScan(row: { handle: string; symbol: string; provider: string; requestedBy: Requester; isInternal: boolean; windowFrom: number; windowTo: number }): Promise<{ scan: ScanRow; joined: boolean }> {
  const handle = h(row.handle)
  const symbol = sym(row.symbol)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`x_scan:${handle}:${symbol}`}))) l`
    const now = new Date()
    const cutoff = new Date(now.getTime() - SCAN_JOIN_MS)
    await tx.xScan.updateMany({ where: { handle, symbol, status: 'running', startedAt: { lt: cutoff } }, data: { status: 'failed', note: 'The scan stopped before it finished.', finishedAt: now } })
    const running = await tx.xScan.findFirst({ where: { handle, symbol, status: 'running', startedAt: { gte: cutoff } }, orderBy: { startedAt: 'desc' } })
    if (running) return { scan: scanRow(running), joined: true }
    const created = await tx.xScan.create({
      data: { id: scanId(), handle, symbol, status: 'running', provider: row.provider, requestedBy: row.requestedBy, isInternal: row.isInternal, windowFrom: new Date(row.windowFrom), windowTo: new Date(row.windowTo), note: 'Starting', startedAt: now },
    })
    return { scan: scanRow(created), joined: false }
  })
}

export async function updateScan(id: string, patch: Partial<Pick<ScanRow, 'status' | 'postsRead' | 'callsFound' | 'costUsd' | 'note'>> & { finished?: boolean }): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.status !== undefined) data.status = patch.status
  if (patch.postsRead !== undefined) data.postsRead = Math.max(0, Math.floor(patch.postsRead))
  if (patch.callsFound !== undefined) data.callsFound = Math.max(0, Math.floor(patch.callsFound))
  if (patch.costUsd !== undefined) data.costUsd = Math.max(0, patch.costUsd)
  if (patch.note !== undefined) data.note = patch.note === null ? null : String(patch.note).slice(0, 300)
  if (patch.finished) data.finishedAt = new Date()
  if (!Object.keys(data).length) return
  await prisma.xScan.update({ where: { id }, data })
}

/** Dollars spent on X reads since 00:00 UTC, every requester together (internal runs included: the house paid for them too). */
export async function spentTodayUsd(nowMs: number = Date.now()): Promise<number> {
  const r = await prisma.xScan.aggregate({ where: { startedAt: { gte: utcDayStart(nowMs) } }, _sum: { costUsd: true } })
  return r._sum.costUsd ?? 0
}

/**
 * Scans this requester started since 00:00 UTC (joined scans do not count:
 * they open no row; refused rows do not count either). Under XCALLS_FAKE=1
 * (never production) internal scans do not count, so the harness can scan
 * the fixture run after run.
 */
export async function scansToday(requester: Requester, nowMs: number = Date.now()): Promise<number> {
  const fake = process.env.XCALLS_FAKE === '1' && process.env.VERCEL_ENV !== 'production'
  return prisma.xScan.count({ where: { requestedBy: requester, startedAt: { gte: utcDayStart(nowMs) }, status: { not: 'refused' }, ...(fake ? { isInternal: false } : {}) } })
}

/**
 * The public list: one row per handle and symbol whose newest finished,
 * non-internal scan exists and which holds at least one bull or bear label on
 * a post X still serves. Newest first. Internal runs never list.
 */
export async function listPlotted(opts: { limit: number; handle?: string }): Promise<PlottedRow[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit || 0) || 1))
  const only = opts.handle ? h(opts.handle) : null
  const rows = await prisma.$queryRaw<{ handle: string; symbol: string; name: string | null; avatar_url: string | null; verified: boolean; calls: number; scanned_at: Date }[]>`
    SELECT * FROM (
      SELECT s.handle, s.symbol, xh.name, xh.avatar_url, (xh.claimed_x_user_id IS NOT NULL) AS verified,
        (SELECT count(*)::int FROM x_calls c JOIN x_posts p ON p.post_id = c.post_id
          WHERE p.handle = s.handle AND c.symbol = s.symbol AND c.stance IN ('bull', 'bear') AND p.gone_at IS NULL) AS calls,
        s.scanned_at
      FROM (
        SELECT handle, symbol, max(coalesce(finished_at, started_at)) AS scanned_at
        FROM x_scans
        WHERE status = 'done' AND is_internal = false AND (${only}::text IS NULL OR handle = ${only}::text)
        GROUP BY handle, symbol
      ) s
      LEFT JOIN x_handles xh ON xh.handle = s.handle
    ) t
    WHERE t.calls > 0
    ORDER BY t.scanned_at DESC, t.handle, t.symbol
    LIMIT ${limit}`
  return rows.map((r) => ({ handle: r.handle, symbol: r.symbol, name: r.name, avatarUrl: r.avatar_url, verified: r.verified, calls: r.calls, scannedAt: r.scanned_at.getTime() }))
}
