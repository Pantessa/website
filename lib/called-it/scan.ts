// One scan: read a handle's posts about one symbol, keep them, label them
// (squad called-it, lane JUDGE).
//
//   allowance → profile → start (or join a running scan) → search the window
//   → save the posts → label the ones with no label for this symbol → save
//   the labels → finish the row with its counts, cost and a note.
//
// The row is never left `running`: any throw after it opens finishes it as
// `failed` with a plain reason. Every dependency can be handed in (the pins
// run the whole scan over an in-memory store and the fixture source).
import * as Store from './store'
import { readPostById, scansAvailable, sourceFor } from './source'
import { labelPosts, type LabelDeps, type LabelResult } from './classify'
import { termsFor } from './terms'
import {
  DAILY_USD_CAP,
  ENV,
  GUEST_SCANS_PER_DAY,
  PROVEN_SCANS_PER_DAY,
  RESCAN_AFTER_MS,
  SCAN_POST_CAP,
  SCAN_WINDOW_DAYS,
  X_POST_COST_USD,
  X_USER_COST_USD,
  postRefFromUrl,
  postTimeAgrees,
  type CallLabel,
  type PostRead,
  type RecordResponse,
  type Requester,
  type ScanRow,
  type StoredLabel,
  type XPost,
  type XSource,
} from './spec'

const DAY_MS = 86_400_000
/** A `running` row older than this is a dead scan (its process ended); a new one may start. */
export const RUNNING_STALE_MS = 2 * 60 * 1000

export type StoreApi = Pick<
  typeof Store,
  'getHandle' | 'saveProfile' | 'savePosts' | 'postsFor' | 'newestPostId' | 'labelsFor' | 'saveLabels' | 'latestScan' | 'startScan' | 'updateScan' | 'spentTodayUsd' | 'scansToday'
>

export type Allowance = { ok: true } | { ok: false; reason: string; next: { label: string; href: string }[] }

export interface ScanDeps {
  store: StoreApi
  source: XSource | null
  label: (posts: readonly XPost[], symbol: string, deps?: LabelDeps) => Promise<LabelResult>
  allowance: (requester: Requester, nowMs: number) => Promise<Allowance>
  now: () => number
}

export interface ScanInput {
  handle: string
  symbol: string
  requester: Requester
  internal: boolean
}

export type ScanOutcome =
  /** The scan ran (or a fresh one already existed): read the record. */
  | { kind: 'done'; scanId: string | null }
  /** Somebody else's scan for this handle and symbol is running. */
  | { kind: 'joined'; scan: ScanRow }
  | { kind: 'refused'; http: number; body: Extract<RecordResponse, { status: 'refused' }> }

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
export const dailyUsdCap = () => num(process.env[ENV.dailyUsdCap], DAILY_USD_CAP)
export const scanPostCap = () => Math.floor(num(process.env[ENV.scanPostCap], SCAN_POST_CAP))

/** Somewhere to go when a scan cannot run. */
export function scanNext(handle: string, symbol: string): { label: string; href: string }[] {
  return [
    { label: 'See handles already plotted', href: '/x' },
    { label: `Paste one of @${handle}'s posts on the ${symbol} chart`, href: `/t/${encodeURIComponent(symbol)}?x=${handle}` },
  ]
}

const refused = (http: number, reason: string, next: { label: string; href: string }[]): ScanOutcome => ({ kind: 'refused', http, body: { status: 'refused', reason, next } })

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

/**
 * The allowance, from the store's own counts. Proven requesters (`x:` a
 * signed-in X account, `w:` a signed-in wallet) get PROVEN_SCANS_PER_DAY,
 * anyone else GUEST_SCANS_PER_DAY, and nobody scans once the house's X spend
 * for the UTC day reaches its cap. (Lane SOURCE's lib/called-it/budget
 * `scanAllowance` replaces this at integration; the arithmetic is the same.)
 */
export function storeAllowance(store: Pick<StoreApi, 'spentTodayUsd' | 'scansToday'>) {
  return async (requester: Requester, nowMs: number): Promise<Allowance> => {
    const next = [{ label: 'See handles already plotted', href: '/x' }]
    const spent = await store.spentTodayUsd(nowMs)
    if (spent >= dailyUsdCap()) return { ok: false, reason: 'Scans are resting until 00:00 UTC: today\'s reads from X are spent. Records already plotted still open, and a pasted post still works.', next }
    const proven = requester.startsWith('x:') || requester.startsWith('w:')
    const max = proven ? PROVEN_SCANS_PER_DAY : GUEST_SCANS_PER_DAY
    const used = await store.scansToday(requester, nowMs)
    if (used >= max) {
      return {
        ok: false,
        reason: proven
          ? `You have run ${used} scans today, the most one account runs in a day. More open at 00:00 UTC.`
          : `You have run ${used} scans today. Verify with X or sign in to run up to ${PROVEN_SCANS_PER_DAY} a day.`,
        next: proven ? next : [...next, { label: 'Verify with X', href: '/api/x/auth/start?next=%2Fx' }],
      }
    }
    return { ok: true }
  }
}

export function defaultScanDeps(): ScanDeps {
  return { store: Store, source: sourceFor(), label: labelPosts, allowance: storeAllowance(Store), now: Date.now }
}

/** A short, plain reason for a failed row (never a stack, never a header). */
export function failNote(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/rate|429/i.test(m)) return 'Stopped: X asked us to slow down. Try again later.'
  if (/timeout|timed out|abort/i.test(m)) return 'Stopped: X did not answer in time.'
  return 'Stopped: the scan hit an error before it finished.'
}

export async function runScan(input: ScanInput, deps: ScanDeps = defaultScanDeps()): Promise<ScanOutcome> {
  const { handle, requester, internal } = input
  const symbol = input.symbol.toUpperCase()
  const { store, source } = deps
  const nowMs = deps.now()
  const next = scanNext(handle, symbol)

  if (!source) return refused(503, 'Scans are not switched on on this server, so no new posts can be read. Records already plotted still open, and one pasted post still works.', next)

  // A fresh finished scan, or one already running, costs nothing to answer.
  const last = await store.latestScan(handle, symbol)
  if (last?.status === 'running' && nowMs - last.startedAt < RUNNING_STALE_MS) return { kind: 'joined', scan: last }
  if (last?.status === 'done' && last.finishedAt && nowMs - last.finishedAt < RESCAN_AFTER_MS) return { kind: 'done', scanId: last.id }

  const allowed = await deps.allowance(requester, nowMs)
  if (!allowed.ok) return refused(429, allowed.reason, allowed.next)

  const spent = await store.spentTodayUsd(nowMs)
  const budgetPosts = Math.floor((dailyUsdCap() - spent - X_USER_COST_USD) / X_POST_COST_USD)
  const cap = Math.min(scanPostCap(), budgetPosts)
  if (cap < 10) return refused(429, 'Scans are resting until 00:00 UTC: today\'s reads from X are spent.', next)

  const profile = await source.profile(handle)
  if (!profile) return refused(404, `@${handle} is not a public X account (it may not exist, or its posts are protected). Nothing to scan.`, [{ label: 'Plot another handle', href: '/x' }])
  if (profile.handle !== handle) return refused(404, `X answered for a different account than @${handle}.`, [{ label: 'Plot another handle', href: '/x' }])
  await store.saveProfile({ ...profile, isProtected: false })

  const windowTo = nowMs
  const windowFrom = utcDayStart(nowMs) - SCAN_WINDOW_DAYS * DAY_MS
  const { scan, joined } = await store.startScan({ handle, symbol, provider: source.name, requestedBy: requester, isInternal: internal, windowFrom, windowTo })
  if (joined) return { kind: 'joined', scan }

  const profileCost = source.name === 'x-api' ? X_USER_COST_USD : 0
  let costUsd = profileCost
  let postsRead = 0
  try {
    await store.updateScan(scan.id, { note: `Reading @${handle}'s posts about ${symbol}`, costUsd })
    const sinceId = last?.status === 'done' ? ((await store.newestPostId(handle)) ?? undefined) : undefined
    const found = await source.search({ handle, terms: termsFor(symbol), fromMs: windowFrom, toMs: windowTo, cap, sinceId })
    costUsd += found.costUsd
    postsRead = found.readCount
    const own = found.posts.filter((p) => p.handle === handle && postTimeAgrees(p.id, p.postedAt))
    await store.savePosts(own)
    await store.updateScan(scan.id, { postsRead, costUsd, note: `Read ${postsRead} post${postsRead === 1 ? '' : 's'}` })

    const have = await store.labelsFor(handle, symbol)
    const labeled = new Set(have.map((l) => l.postId))
    const todo = (await store.postsFor(handle, windowFrom)).filter((p) => !labeled.has(p.id))
    if (todo.length) await store.updateScan(scan.id, { note: `Labeling ${todo.length} post${todo.length === 1 ? '' : 's'}` })
    const res = todo.length ? await deps.label(todo, symbol) : { labels: [], unlabeled: [], model: 'none' }
    const rows: StoredLabel[] = res.labels.map((l) => ({ ...l.label, postId: l.postId, symbol, origin: 'scan', model: res.model }))
    if (rows.length) await store.saveLabels(rows)

    const calls = [...have, ...rows].filter((l) => l.stance !== 'none').length
    const tail = res.unlabeled.length ? ` ${res.unlabeled.length} could not be labeled yet; the next scan tries them again.` : ''
    await store.updateScan(scan.id, { status: 'done', finished: true, postsRead, costUsd, callsFound: calls, note: `Found ${calls} call${calls === 1 ? '' : 's'} in ${postsRead} post${postsRead === 1 ? '' : 's'}.${tail}` })
    return { kind: 'done', scanId: scan.id }
  } catch (err) {
    try {
      await store.updateScan(scan.id, { status: 'failed', finished: true, postsRead, costUsd, note: failNote(err) })
    } catch {
      /* the row stays as the store left it; RUNNING_STALE_MS retires it */
    }
    return refused(502, `${failNote(err)} Nothing was lost; posts already read are kept.`, next)
  }
}

/** For words in a refusal before a scan is asked for (the record route). */
export { scansAvailable }

// ── Who is asking (server only) ──────────────────────────────────────────

/**
 * `x:<id>` when this browser proved an X account, else `w:<wallet>` from the
 * SIWE session, else `ip:<salted hash>`. (Lane SOURCE's budget
 * `requesterOf` replaces this at integration.)
 */
export async function requesterOf(req: Request): Promise<Requester> {
  try {
    const { getXIdentity } = await import('./x-auth')
    const id = await getXIdentity()
    if (id) return `x:${id.xUserId}`
  } catch {
    /* no identity */
  }
  try {
    const { getSessionAddress } = await import('@/lib/auth')
    const w = await getSessionAddress()
    if (w) return `w:${w}`
  } catch {
    /* no session */
  }
  const { clientIpFrom, hashIp } = await import('@/lib/turn-limits')
  const ip = clientIpFrom(req.headers)
  return `ip:${ip ? hashIp(ip) : 'local'}`
}

export function isInternalRun(req: Request): boolean {
  return req.headers.get('x-yf-internal-run') === '1'
}

// ── The mutation routes' door (app/api/x/scan, app/api/x/add) ────────────

export const CROSS_SITE: Extract<RecordResponse, { status: 'refused' }> = {
  status: 'refused',
  reason: 'This request did not come from Pantessa.',
  next: [{ label: 'Plot a handle', href: '/x' }],
}

/** Same-origin JSON only (lib/community/origin), then the body as an object of at most 4 KB. Null = refuse. */
export async function readWriteBody(req: Request): Promise<Record<string, unknown> | null | 'cross-site'> {
  const { sameOriginJson } = await import('@/lib/community/origin')
  if (!sameOriginJson(req.headers)) return 'cross-site'
  let text: string
  try {
    text = await req.text()
  } catch {
    return null
  }
  if (text.length > 4096) return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ── One post pasted by hand ──────────────────────────────────────────────

export interface AddDeps {
  store: Pick<StoreApi, 'saveProfile' | 'savePosts' | 'labelsFor' | 'saveLabels' | 'spentTodayUsd' | 'scansToday'>
  read: (id: string) => Promise<PostRead>
  label: ScanDeps['label']
  allowance: ScanDeps['allowance']
  now: () => number
}

export function defaultAddDeps(): AddDeps {
  return { store: Store, read: readPostById, label: labelPosts, allowance: storeAllowance(Store), now: Date.now }
}

export type AddOutcome = { kind: 'added'; postId: string; label: CallLabel } | { kind: 'refused'; http: number; body: Extract<RecordResponse, { status: 'refused' }> }

/**
 * A viewer pastes a post link: read it from X by id (keyless), refuse it
 * unless it is by this handle, label that one post for this symbol, keep it
 * as `added`. A post already labeled for the symbol is never sent to the
 * model again.
 */
export async function addPost(input: { handle: string; symbol: string; url: unknown; requester: Requester }, deps: AddDeps = defaultAddDeps()): Promise<AddOutcome> {
  const { handle, requester } = input
  const symbol = input.symbol.toUpperCase()
  const back = [{ label: `Back to @${handle} on ${symbol}`, href: `/t/${encodeURIComponent(symbol)}?x=${handle}` }]
  const no = (http: number, reason: string, next = back): AddOutcome => ({ kind: 'refused', http, body: { status: 'refused', reason, next } })
  const ref = postRefFromUrl(input.url)
  if (!ref) return no(400, 'That is not a link to a post on X. Copy the post\'s link (x.com/<handle>/status/<number>) and paste it here.')
  if (ref.handle && ref.handle !== handle) return no(400, `That link is a post by @${ref.handle}, not @${handle}.`)

  const have = await deps.store.labelsFor(handle, symbol)
  const already = have.find((l) => l.postId === ref.id)
  if (already) return { kind: 'added', postId: ref.id, label: { stance: already.stance, conviction: already.conviction, quote: already.quote } }

  const allowed = await deps.allowance(requester, deps.now())
  if (!allowed.ok) return no(429, allowed.reason, [...back, ...allowed.next])

  const got = await deps.read(ref.id)
  if (!got.ok) return got.reason === 'gone' ? no(404, 'X no longer serves that post, so it cannot be added.') : no(503, 'X did not answer for that post. Try again in a moment.')
  const { post, profile } = got
  if (post.handle !== handle || profile.handle !== handle) return no(400, `That post is by @${post.handle}, not @${handle}.`)
  if (!postTimeAgrees(post.id, post.postedAt)) return no(400, 'X answered with a time that does not match the post, so it was not added.')

  await deps.store.saveProfile(profile)
  await deps.store.savePosts([post])
  const res = await deps.label([post], symbol)
  const one = res.labels.find((l) => l.postId === post.id)
  if (!one) return no(503, 'The post was read but could not be labeled yet. Try again in a moment.')
  await deps.store.saveLabels([{ ...one.label, postId: post.id, symbol, origin: 'added', model: res.model }])
  if (one.label.stance === 'none') return no(200, `Read it. That post does not take a side on ${symbol} in words we can quote, so it is not a call.`)
  return { kind: 'added', postId: post.id, label: one.label }
}
