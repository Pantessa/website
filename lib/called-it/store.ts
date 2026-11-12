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
import { stripNul } from './clean'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { LIST_MIN_FOLLOWERS, fakeModeOn, isFakeXUserId, type Requester, type ScanRow, type StoredLabel, type XPost, type XProfile } from './spec'

export interface StoredHandle extends XProfile {
  isProtected: boolean
  /** Set when the account itself signed in with X (lane AUTH writes it through claimHandle). */
  claimedXUserId: string | null
  claimedAt: number | null
  readAt: number | null
  /** Taken down (review R12): its records are refused everywhere and it never lists. */
  hiddenAt: number | null
  /** X said there is no such account at this time (review R4): not asked again for a day. */
  missingAt: number | null
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

type PostDb = { postId: string; handle: string; xUserId: string | null; text: string; postedAt: Date; likes: number | null; replies: number | null; reposts: number | null; isReply: boolean; source: string }

/** A post as the store keeps it: X's fields plus the author's user id when a read named it (review R9). */
export type StoredPost = XPost & { xUserId: string | null }

function postOf(r: PostDb): StoredPost {
  const source = r.source === 'x-api' || r.source === 'fixture' ? r.source : 'syndication'
  return { id: r.postId, handle: r.handle, text: r.text, postedAt: r.postedAt.getTime(), likes: r.likes, replies: r.replies, reposts: r.reposts, isReply: r.isReply, source, xUserId: r.xUserId }
}

// ── The one "verified" rule (review R9) ─────────────────────────────────────

/**
 * A handle is Verified only while: the account itself claimed it, the claim's
 * user id is still the handle's user id (a handle that changed hands loses
 * it), and the claim is not a fake sign-in's outside fake mode (review R6).
 * The record (lib/called-it/record verifiedOf) and the public list
 * (listPlotted) both call this; nothing else decides it.
 */
export function claimVerified(row: { claimedXUserId: string | null; claimedAt: number | null; xUserId: string | null } | null, fake: boolean = fakeModeOn()): { at: number } | null {
  if (!row?.claimedXUserId || !row.claimedAt) return null
  if (isFakeXUserId(row.claimedXUserId) && !fake) return null
  if (row.xUserId && row.xUserId !== row.claimedXUserId) return null
  return { at: row.claimedAt }
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
    hiddenAt: ms(r.hiddenAt),
    missingAt: ms(r.missingAt),
  }
}

/** Take a handle down (review R12), or put it back. `by` is who: `admin` (the owner self-hide is parked). */
export async function setHidden(handle: string, hidden: boolean, by: 'admin'): Promise<void> {
  const name = h(handle)
  const data = hidden ? { hiddenAt: new Date(), hiddenBy: by } : { hiddenAt: null, hiddenBy: null }
  await prisma.xHandle.upsert({ where: { handle: name }, create: { handle: name, ...data }, update: data })
}

/** The account withdraws its own verification (review R12): every handle this user id claimed loses the claim. Returns how many. */
export async function unclaimAll(xUserId: string): Promise<number> {
  const r = await prisma.xHandle.updateMany({ where: { claimedXUserId: xUserId }, data: { claimedXUserId: null, claimedAt: null } })
  return r.count
}

/** X answered "no such account" (review R4b): remembered for a day, so the same miss is never billed twice. Touches nothing else on the row. */
export async function markMissing(handle: string): Promise<void> {
  const name = h(handle)
  const now = new Date()
  await prisma.xHandle.upsert({ where: { handle: name }, create: { handle: name, missingAt: now, readAt: now }, update: { missingAt: now, readAt: now } })
}

/** X answered that the account is protected (review R4b): remembered with the read time; nothing else on the row is touched. */
export async function markProtected(handle: string): Promise<void> {
  const name = h(handle)
  const now = new Date()
  await prisma.xHandle.upsert({ where: { handle: name }, create: { handle: name, isProtected: true, readAt: now }, update: { isProtected: true, readAt: now } })
}

/** Insert or refresh what X says about an account. Never touches the claim. */
export async function saveProfile(profile: XProfile & { isProtected?: boolean }): Promise<void> {
  const handle = h(profile.handle)
  // A null from X (oEmbed knows no id, no avatar, no followers) never replaces what we already know (review R9);
  // a DIFFERENT non-null user id does: the handle has changed hands, and every check keyed on it follows.
  const known = <T,>(v: T | null | undefined) => (v === null || v === undefined ? {} : null)
  const fields = {
    ...(known(profile.xUserId) ?? { xUserId: profile.xUserId }),
    name: stripNul(profile.name),
    ...(known(profile.avatarUrl) ?? { avatarUrl: profile.avatarUrl }),
    ...(known(profile.followers) ?? { followers: profile.followers }),
    isBlue: profile.blue,
    readAt: new Date(),
    // X answered for the account: it exists.
    missingAt: null,
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
    ...(profile?.name !== undefined ? { name: stripNul(profile.name) } : {}),
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
export async function savePosts(posts: readonly (XPost & { xUserId?: string | null })[]): Promise<void> {
  const rows = new Map<string, XPost & { xUserId?: string | null }>()
  for (const p of posts) rows.set(p.id, p)
  const list = [...rows.values()]
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    await prisma.$executeRaw`
      INSERT INTO x_posts (post_id, handle, x_user_id, text, posted_at, likes, replies, reposts, is_reply, source, read_at)
      SELECT t.post_id, t.handle, NULLIF(t.x_user_id, ''), t.text, t.posted_at, t.likes, t.replies, t.reposts, t.is_reply, t.source, now()
      FROM unnest(
        ${chunk.map((p) => p.id)}::text[],
        ${chunk.map((p) => h(p.handle))}::text[],
        ${chunk.map((p) => (typeof p.xUserId === 'string' && /^\d{1,25}$|^fake-/.test(p.xUserId) ? p.xUserId : ''))}::text[],
        ${chunk.map((p) => stripNul(p.text))}::text[],
        ${chunk.map((p) => new Date(p.postedAt).toISOString())}::timestamptz[],
        ${chunk.map((p) => p.likes)}::int[],
        ${chunk.map((p) => p.replies)}::int[],
        ${chunk.map((p) => p.reposts)}::int[],
        ${chunk.map((p) => p.isReply)}::boolean[],
        ${chunk.map((p) => p.source)}::text[]
      ) AS t(post_id, handle, x_user_id, text, posted_at, likes, replies, reposts, is_reply, source)
      ON CONFLICT (post_id) DO UPDATE SET
        -- the author's id is X's and never changes for a post: written when a read names it, never erased
        x_user_id = COALESCE(NULLIF(EXCLUDED.x_user_id, ''), x_posts.x_user_id),
        -- oEmbed's words are a rebuild from X's HTML: never over a scanned post's own text
        text = CASE WHEN EXCLUDED.source = 'syndication' AND x_posts.source <> 'syndication' THEN x_posts.text ELSE EXCLUDED.text END,
        likes = COALESCE(EXCLUDED.likes, x_posts.likes),
        replies = COALESCE(EXCLUDED.replies, x_posts.replies),
        reposts = COALESCE(EXCLUDED.reposts, x_posts.reposts),
        read_at = now()`
  }
}

/** A handle's cached posts from `fromMs` on, date ascending. Gone posts are never returned. */
export async function postsFor(handle: string, fromMs: number): Promise<StoredPost[]> {
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

/** A label to save; `addedBy` is who pasted it (review R2b), null for a scan's label. */
export type SaveLabel = StoredLabel & { addedBy?: string | null }

export async function saveLabels(labels: readonly SaveLabel[]): Promise<void> {
  const rows = new Map<string, SaveLabel>()
  for (const l of labels) rows.set(`${l.postId}|${sym(l.symbol)}`, l)
  const list = [...rows.values()]
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    await prisma.$executeRaw`
      INSERT INTO x_calls (post_id, symbol, stance, conviction, quote, model, origin, added_by, labeled_at)
      SELECT t.post_id, t.symbol, t.stance, t.conviction, NULLIF(t.quote, ''), NULLIF(t.model, ''), t.origin, NULLIF(t.added_by, ''), now()
      FROM unnest(
        ${chunk.map((l) => l.postId)}::text[],
        ${chunk.map((l) => sym(l.symbol))}::text[],
        ${chunk.map((l) => l.stance)}::text[],
        ${chunk.map((l) => (l.stance === 'none' ? 0 : l.conviction))}::int[],
        -- Prisma types a parameter array by its FIRST element: a text array that starts with null is sent as
        -- integers and Postgres refuses the whole chunk (measured 2026-11-11). Nulls ride as '' and come back by NULLIF.
        ${chunk.map((l) => (l.stance === 'none' ? '' : (l.quote ?? '')))}::text[],
        ${chunk.map((l) => l.model ?? '')}::text[],
        ${chunk.map((l) => l.origin)}::text[],
        ${chunk.map((l) => l.addedBy ?? '')}::text[]
      ) AS t(post_id, symbol, stance, conviction, quote, model, origin, added_by)
      ON CONFLICT (post_id, symbol) DO UPDATE SET
        stance = EXCLUDED.stance, conviction = EXCLUDED.conviction, quote = EXCLUDED.quote,
        model = EXCLUDED.model, origin = EXCLUDED.origin, labeled_at = now(),
        -- who pasted it stays on the row (the daily count reads it), whatever labels it later
        added_by = COALESCE(EXCLUDED.added_by, x_calls.added_by)`
  }
}

// ── Pasted posts: the meter (review R2b) ─────────────────────────────────

/** Rows this requester pasted since 00:00 UTC, and in the last minute (`none` labels included: each was a model call). */
export async function addsCount(requester: Requester, nowMs: number = Date.now()): Promise<{ today: number; lastMinute: number }> {
  const rows = await prisma.$queryRaw<{ today: number; minute: number }[]>`
    SELECT count(*)::int AS today, count(*) FILTER (WHERE labeled_at >= ${new Date(nowMs - 60_000)})::int AS minute
    FROM x_calls WHERE added_by = ${requester} AND labeled_at >= ${utcDayStart(nowMs)}`
  return { today: rows[0]?.today ?? 0, lastMinute: rows[0]?.minute ?? 0 }
}

/** The placeholder a paste holds while its one model call runs. Never a call: stance none. */
export const ADD_PENDING_MODEL = 'pending'

/**
 * Count and reserve in one step, under this requester's advisory lock, so N
 * pastes at once cannot all read "under the limit" (the check-then-spend race,
 * review R3, on the paste path). `decide` gets the counts and says yes or no;
 * yes inserts a `none` row (model `pending`, added_by = requester) that the
 * label then replaces. A row already there for the post and symbol is answered
 * as `exists` and nothing is reserved (somebody else is labeling it, or did).
 */
export async function reserveAdd<T extends { ok: boolean }>(r: { postId: string; symbol: string; requester: Requester; nowMs?: number; decide: (c: { today: number; lastMinute: number }) => T }): Promise<{ kind: 'reserved' } | { kind: 'over'; allowance: T } | { kind: 'exists'; label: StoredLabel }> {
  const nowMs = r.nowMs ?? Date.now()
  const symbol = sym(r.symbol)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`x_add:${r.requester}`}))) l`
    const have = await tx.xCall.findUnique({ where: { postId_symbol: { postId: r.postId, symbol } } })
    if (have) {
      const stance = have.stance === 'bull' || have.stance === 'bear' ? have.stance : 'none'
      const conviction = stance === 'none' ? 0 : have.conviction === 1 || have.conviction === 2 || have.conviction === 3 ? have.conviction : 0
      return { kind: 'exists' as const, label: { postId: have.postId, symbol: have.symbol, stance, conviction, quote: have.quote, model: have.model, origin: have.origin === 'added' ? 'added' : 'scan' } }
    }
    const c = await tx.$queryRaw<{ today: number; minute: number }[]>`
      SELECT count(*)::int AS today, count(*) FILTER (WHERE labeled_at >= ${new Date(nowMs - 60_000)})::int AS minute
      FROM x_calls WHERE added_by = ${r.requester} AND labeled_at >= ${utcDayStart(nowMs)}`
    const allowance = r.decide({ today: c[0]?.today ?? 0, lastMinute: c[0]?.minute ?? 0 })
    if (!allowance.ok) return { kind: 'over' as const, allowance }
    await tx.xCall.create({ data: { postId: r.postId, symbol, stance: 'none', conviction: 0, quote: null, model: ADD_PENDING_MODEL, origin: 'added', addedBy: r.requester, labeledAt: new Date(nowMs) } })
    return { kind: 'reserved' as const }
  })
}

// ── Scans ─────────────────────────────────────────────────────────────────

export async function latestScan(handle: string, symbol: string): Promise<ScanRow | null> {
  // A free finish's row is a lease, not a scan (review R11): never the latest scan.
  const r = await prisma.xScan.findFirst({ where: { handle: h(handle), symbol: sym(symbol), ...NOT_FINISH }, orderBy: { startedAt: 'desc' } })
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

/** What a running row is assumed to have spent once its request died (review R3): its whole reservation. Never less than what it wrote. */
const RETIRE_DEAD = Prisma.sql`status = 'failed', note = 'The scan stopped before it finished.', finished_at = now(), cost_usd = GREATEST(cost_usd, reserved_usd), reserved_usd = 0`

/**
 * Opens a `running` row, or returns the one already running for this handle
 * and symbol (two people asking share one scan). A `running` row older than
 * SCAN_JOIN_MS is a scan whose request died: it is finished as `failed` here
 * so it never blocks or misleads a later one. (No reservation: the money path
 * is openScan; this stays for callers that only want the join rule.)
 */
export async function startScan(row: { handle: string; symbol: string; provider: string; requestedBy: Requester; isInternal: boolean; windowFrom: number; windowTo: number }): Promise<{ scan: ScanRow; joined: boolean }> {
  const handle = h(row.handle)
  const symbol = sym(row.symbol)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`x_scan:${handle}:${symbol}`}))) l`
    const now = new Date()
    const cutoff = new Date(now.getTime() - SCAN_JOIN_MS)
    await tx.$executeRaw`UPDATE x_scans SET ${RETIRE_DEAD} WHERE handle = ${handle} AND symbol = ${symbol} AND status = 'running' AND started_at < ${cutoff}`
    const running = await tx.xScan.findFirst({ where: { handle, symbol, status: 'running', startedAt: { gte: cutoff } }, orderBy: { startedAt: 'desc' } })
    if (running) return { scan: scanRow(running), joined: true }
    const created = await tx.xScan.create({
      data: { id: scanId(), handle, symbol, status: 'running', provider: row.provider, requestedBy: row.requestedBy, isInternal: row.isInternal, windowFrom: new Date(row.windowFrom), windowTo: new Date(row.windowTo), note: 'Starting', startedAt: now },
    })
    return { scan: scanRow(created), joined: false }
  })
}

/** What one finished scan of a handle on a symbol read (reviews R7, R8). */
export interface FinishedScan {
  id: string
  windowFrom: number
  windowTo: number
  finishedAt: number
  postsRead: number
  truncated: boolean
  oldestPostAt: number | null
}

/** Every finished scan of this handle on this symbol (free finishes excluded), oldest first. */
export async function finishedScans(handle: string, symbol: string): Promise<FinishedScan[]> {
  const rows = await prisma.xScan.findMany({ where: { handle: h(handle), symbol: sym(symbol), status: 'done', ...NOT_FINISH }, orderBy: { startedAt: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    windowFrom: (r.windowFrom ?? r.startedAt).getTime(),
    windowTo: (r.windowTo ?? r.startedAt).getTime(),
    finishedAt: (r.finishedAt ?? r.startedAt).getTime(),
    postsRead: r.postsRead,
    truncated: r.truncated,
    oldestPostAt: ms(r.oldestPostAt),
  }))
}

/** The day's counts a scan's allowance is decided on, read inside the budget lock. */
export interface ScanCounts {
  /** Finished rows at their cost, running rows at the larger of their reservation and their cost (review R3). */
  spentTodayUsd: number
  /** This requester's scans today (the scansToday rules). */
  scansToday: number
  /** This requester's rows today, any status: each one cost a profile read (review R4c). */
  lookupsToday: number
}

/** The one advisory lock every scan's money passes through (review R3). */
export const SCAN_BUDGET_LOCK = 'x_scan_budget'

/**
 * RESERVE BEFORE SPENDING (review R3). Under ONE global advisory lock, in one
 * transaction: retire dead running rows (charged their whole reservation),
 * join a running scan of this handle and symbol, read today's spend (running
 * rows at their reservation) and this requester's counts, ask `decide`, and
 * only then open the row holding `reserveUsd` (this scan's worst case: its cap
 * of posts plus the profile read). K requests at once are decided one after
 * another, each seeing the others' reservations, so the day's cap is never
 * crossed by a race. Finishing the row (updateScan finished) releases it.
 */
export async function openScan<A extends { ok: boolean }>(row: { handle: string; symbol: string; provider: string; requestedBy: Requester; isInternal: boolean; windowFrom: number; windowTo: number; reserveUsd: number; nowMs?: number; decide: (c: ScanCounts) => A }): Promise<{ kind: 'opened'; scan: ScanRow } | { kind: 'joined'; scan: ScanRow } | { kind: 'refused'; allowance: A }> {
  const handle = h(row.handle)
  const symbol = sym(row.symbol)
  const nowMs = row.nowMs ?? Date.now()
  const fake = fakeModeOn()
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${SCAN_BUDGET_LOCK}))) l`
    const now = new Date(nowMs)
    const cutoff = new Date(nowMs - SCAN_JOIN_MS)
    await tx.$executeRaw`UPDATE x_scans SET ${RETIRE_DEAD} WHERE status = 'running' AND started_at < ${cutoff}`
    const running = await tx.xScan.findFirst({ where: { handle, symbol, status: 'running', startedAt: { gte: cutoff } }, orderBy: { startedAt: 'desc' } })
    if (running) return { kind: 'joined' as const, scan: scanRow(running) }
    const day = utcDayStart(nowMs)
    const c = await tx.$queryRaw<{ spent: number | null; scans: number; lookups: number }[]>`
      SELECT
        (SELECT sum(CASE WHEN status = 'running' THEN GREATEST(reserved_usd, cost_usd) ELSE cost_usd END) FROM x_scans WHERE started_at >= ${day})::float8 AS spent,
        (SELECT count(*) FROM x_scans WHERE requested_by = ${row.requestedBy} AND started_at >= ${day} AND coalesce(provider, '') <> ${FINISH_PROVIDER}
           AND (status IN ('running', 'done') OR (status = 'failed' AND posts_read > 0)) AND (${fake} = false OR is_internal = false))::int AS scans,
        (SELECT count(*) FROM x_scans WHERE requested_by = ${row.requestedBy} AND started_at >= ${day} AND coalesce(provider, '') <> ${FINISH_PROVIDER}
           AND (${fake} = false OR is_internal = false))::int AS lookups`
    const allowance = row.decide({ spentTodayUsd: c[0]?.spent ?? 0, scansToday: c[0]?.scans ?? 0, lookupsToday: c[0]?.lookups ?? 0 })
    if (!allowance.ok) return { kind: 'refused' as const, allowance }
    const created = await tx.xScan.create({
      data: { id: scanId(), handle, symbol, status: 'running', provider: row.provider, requestedBy: row.requestedBy, isInternal: row.isInternal, windowFrom: new Date(row.windowFrom), windowTo: new Date(row.windowTo), note: 'Starting', startedAt: now, reservedUsd: Math.max(0, row.reserveUsd) },
    })
    return { kind: 'opened' as const, scan: scanRow(created) }
    // Requests queue on the lock: give them room to wait (Prisma's defaults are 2 s to get a connection, 5 s to finish).
  }, { maxWait: 15_000, timeout: 20_000 })
}

/**
 * THE FREE FINISH TAKES THE SAME LOCK AS A SCAN (review R11): it opens a
 * `running` row (provider `finish`, nothing reserved) for this handle and
 * symbol under the budget lock, or answers the running scan or finish it
 * would collide with, so a second request JOINS instead of labeling the same
 * posts again. The row is a lease: closeFinish deletes it; a dead one is
 * retired like any running row. It is never a scan, a lookup or coverage.
 */
export async function openFinish(r: { handle: string; symbol: string; requestedBy: Requester; isInternal: boolean; nowMs?: number }): Promise<{ kind: 'opened'; id: string } | { kind: 'joined'; scan: ScanRow }> {
  const handle = h(r.handle)
  const symbol = sym(r.symbol)
  const nowMs = r.nowMs ?? Date.now()
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${SCAN_BUDGET_LOCK}))) l`
    const cutoff = new Date(nowMs - SCAN_JOIN_MS)
    await tx.$executeRaw`UPDATE x_scans SET ${RETIRE_DEAD} WHERE status = 'running' AND started_at < ${cutoff}`
    const running = await tx.xScan.findFirst({ where: { handle, symbol, status: 'running', startedAt: { gte: cutoff } }, orderBy: { startedAt: 'desc' } })
    if (running) return { kind: 'joined' as const, scan: scanRow(running) }
    const created = await tx.xScan.create({ data: { id: scanId(), handle, symbol, status: 'running', provider: FINISH_PROVIDER, requestedBy: r.requestedBy, isInternal: r.isInternal, note: 'Labeling the posts still to label', startedAt: new Date(nowMs), reservedUsd: 0 } })
    return { kind: 'opened' as const, id: created.id }
  }, { maxWait: 15_000, timeout: 20_000 })
}

/** Release a finish's lease. */
export async function closeFinish(id: string): Promise<void> {
  await prisma.xScan.deleteMany({ where: { id, provider: FINISH_PROVIDER } })
}

/** Rows a free "finish" opens (review R11): never a scan, never a lookup, never coverage. */
export const FINISH_PROVIDER = 'finish'
/** `provider <> 'finish'` that keeps rows with no provider (SQL's NOT on a null drops them). */
const NOT_FINISH = { OR: [{ provider: null }, { provider: { not: FINISH_PROVIDER } }] }

export interface ScanPatch extends Partial<Pick<ScanRow, 'status' | 'postsRead' | 'callsFound' | 'costUsd' | 'note'>> {
  finished?: boolean
  /** The read stopped before the window's start (review R8). */
  truncated?: boolean
  /** The oldest post the read reached (ms). */
  oldestPostAt?: number | null
  /** The search's real start (an incremental re-scan starts after the last one, review R7). */
  windowFrom?: number
}

export async function updateScan(id: string, patch: ScanPatch): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.status !== undefined) data.status = patch.status
  if (patch.postsRead !== undefined) data.postsRead = Math.max(0, Math.floor(patch.postsRead))
  if (patch.callsFound !== undefined) data.callsFound = Math.max(0, Math.floor(patch.callsFound))
  if (patch.costUsd !== undefined) data.costUsd = Math.max(0, patch.costUsd)
  if (patch.note !== undefined) data.note = patch.note === null ? null : String(patch.note).slice(0, 300)
  if (patch.truncated !== undefined) data.truncated = patch.truncated
  if (patch.oldestPostAt !== undefined) data.oldestPostAt = patch.oldestPostAt === null ? null : new Date(patch.oldestPostAt)
  if (patch.windowFrom !== undefined) data.windowFrom = new Date(patch.windowFrom)
  // A finished row holds nothing against the day's cap: its cost is what it spent (review R3).
  if (patch.finished) {
    data.finishedAt = new Date()
    data.reservedUsd = 0
  }
  if (!Object.keys(data).length) return
  await prisma.xScan.update({ where: { id }, data })
}

/** Dollars spent on X reads since 00:00 UTC, every requester together (internal runs included: the house paid for them too). A running scan counts at its reservation (review R3). */
export async function spentTodayUsd(nowMs: number = Date.now()): Promise<number> {
  const r = await prisma.$queryRaw<{ spent: number | null }[]>`
    SELECT sum(CASE WHEN status = 'running' THEN GREATEST(reserved_usd, cost_usd) ELSE cost_usd END)::float8 AS spent FROM x_scans WHERE started_at >= ${utcDayStart(nowMs)}`
  return r[0]?.spent ?? 0
}

/**
 * Scans this requester started since 00:00 UTC (joined scans do not count:
 * they open no row; refused rows do not count either, and neither does a
 * scan that failed before it read a post, nor a free finish). In fake mode
 * (spec fakeModeOn: never on Vercel) internal scans do not count, so the
 * harness can scan the fixture run after run.
 */
export async function scansToday(requester: Requester, nowMs: number = Date.now()): Promise<number> {
  const fake = fakeModeOn()
  // A scan that failed before it read a single post was the house's failure (X down, credits spent): it is not the visitor's scan.
  return prisma.xScan.count({ where: { requestedBy: requester, startedAt: { gte: utcDayStart(nowMs) }, AND: [NOT_FINISH, { OR: [{ status: { in: ['running', 'done'] } }, { status: 'failed', postsRead: { gt: 0 } }] }], ...(fake ? { isInternal: false } : {}) } })
}

/** This requester's rows today, any status (each was a billed profile read; review R4c). */
export async function lookupsToday(requester: Requester, nowMs: number = Date.now()): Promise<number> {
  const fake = fakeModeOn()
  return prisma.xScan.count({ where: { requestedBy: requester, startedAt: { gte: utcDayStart(nowMs) }, ...NOT_FINISH, ...(fake ? { isInternal: false } : {}) } })
}

/**
 * The public list: one row per handle and symbol with a finished,
 * non-internal scan that found at least one SCAN-origin bull or bear call on
 * a post X still serves and the handle's current author wrote (a handle with
 * only pasted posts never lists; lane RECORD's note, review R1). A handle
 * lists only above LIST_MIN_FOLLOWERS or when its owner verified (review
 * R19; an unknown count does not list), never when hidden or protected
 * (review R12). `verified` is claimVerified, the record's own rule (R9).
 * Bounded: the candidate groups are limited BEFORE calls are counted.
 */
export async function listPlotted(opts: { limit: number; handle?: string; symbol?: string }): Promise<PlottedRow[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit || 0) || 1))
  const only = opts.handle ? h(opts.handle) : null
  const onlySym = opts.symbol ? sym(opts.symbol) : null
  const fake = fakeModeOn()
  const candidates = limit * 4
  const rows = await prisma.$queryRaw<{ handle: string; symbol: string; name: string | null; avatar_url: string | null; followers: number | null; x_user_id: string | null; claimed_x_user_id: string | null; claimed_at: Date | null; calls: number; scanned_at: Date }[]>`
    WITH g AS (
      SELECT handle, symbol, max(coalesce(finished_at, started_at)) AS scanned_at
      FROM x_scans
      WHERE status = 'done' AND is_internal = false AND coalesce(provider, '') <> ${FINISH_PROVIDER}
        AND (${only}::text IS NULL OR handle = ${only}::text) AND (${onlySym}::text IS NULL OR symbol = ${onlySym}::text)
      GROUP BY handle, symbol
    ), c AS (
      SELECT g.handle, g.symbol, g.scanned_at, xh.name, xh.avatar_url, xh.followers, xh.x_user_id, xh.claimed_x_user_id, xh.claimed_at
      FROM g JOIN x_handles xh ON xh.handle = g.handle
      WHERE xh.hidden_at IS NULL AND xh.is_protected = false AND (xh.followers >= ${LIST_MIN_FOLLOWERS} OR xh.claimed_x_user_id IS NOT NULL)
      ORDER BY g.scanned_at DESC, g.handle, g.symbol
      LIMIT ${candidates}
    )
    SELECT c.*,
      (SELECT count(*)::int FROM x_calls k JOIN x_posts p ON p.post_id = k.post_id
        WHERE p.handle = c.handle AND k.symbol = c.symbol AND k.stance IN ('bull', 'bear') AND k.origin = 'scan' AND p.gone_at IS NULL
          AND (p.x_user_id IS NULL OR c.x_user_id IS NULL OR p.x_user_id = c.x_user_id)
          AND (${fake} OR coalesce(k.model, '') NOT IN ('keywords', 'fixture', 'injected'))) AS calls
    FROM c
    ORDER BY c.scanned_at DESC, c.handle, c.symbol`
  const out: PlottedRow[] = []
  for (const r of rows) {
    const verified = claimVerified({ claimedXUserId: r.claimed_x_user_id, claimedAt: ms(r.claimed_at), xUserId: r.x_user_id }, fake) !== null
    if (r.calls <= 0) continue
    if (!verified && !((r.followers ?? -1) >= LIST_MIN_FOLLOWERS)) continue
    out.push({ handle: r.handle, symbol: r.symbol, name: r.name, avatarUrl: r.avatar_url, verified, calls: r.calls, scannedAt: r.scanned_at.getTime() })
    if (out.length >= limit) break
  }
  return out
}
