// One scan: read a handle's posts about one symbol, keep them, label them
// (squad called-it, lane JUDGE).
//
//   fresh / running / finishable? → allowance → profile → start (or join a
//   running scan) → search the window → save the posts → label the ones with
//   no label for this symbol → save the labels → finish the row with its
//   counts, cost and a note.
//
// The row is never left `running`: any throw after it opens finishes it as
// `failed` with a plain reason. A scan has a TIME BUDGET measured from the
// start of the request (SCAN_TIME_BUDGET_MS): once it is spent no new label
// batch starts, the rest stay unlabeled, and the scan finishes as `done`
// with "Labeled 240 of 400 posts. Open it again to finish." The next ask
// FINISHES it for free: it labels only the unlabeled posts, reads nothing
// from X, opens no new row (so it never counts against a daily allowance).
// Every dependency can be handed in (the pins run it over an in-memory store,
// and over the real store on the TEST database).
import * as Store from './store'
import { scanAllowance, type Allowance } from './budget'
import { readPostById, sourceFor } from './source'
import { labelPosts, type LabelDeps, type LabelResult } from './classify'
import { termsFor } from './terms'
import {
  RESCAN_AFTER_MS,
  SCAN_WINDOW_DAYS,
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

export { requesterOf, isInternalRun } from './budget'
export type { Allowance } from './budget'

const DAY_MS = 86_400_000
/** A `running` row older than this is a dead scan (its process ended); a new one may start. Same as the store's SCAN_JOIN_MS. */
export const RUNNING_STALE_MS = 2 * 60 * 1000
/** How long a scan may work inside one request. The route's maxDuration is 60 s; the rest is room to save and answer. */
export const SCAN_TIME_BUDGET_MS = 45_000

export type StoreApi = Pick<
  typeof Store,
  'getHandle' | 'saveProfile' | 'savePosts' | 'postsFor' | 'newestPostId' | 'labelsFor' | 'saveLabels' | 'latestScan' | 'startScan' | 'updateScan'
>

export type AllowanceFn = (requester: Requester, nowMs: number, ctx: { handle?: string; symbol?: string }) => Promise<Allowance>

export interface ScanDeps {
  store: StoreApi
  /** ONE instance per scan: a source bills its profile read into the next search's cost. */
  source: XSource | null
  label: (posts: readonly XPost[], symbol: string, deps?: LabelDeps) => Promise<LabelResult>
  allowance: AllowanceFn
  now: () => number
}

export interface ScanInput {
  handle: string
  symbol: string
  requester: Requester
  internal: boolean
  /** Absolute ms after which no new label batch starts. Default: SCAN_TIME_BUDGET_MS from now. */
  deadlineMs?: number
}

type Refused = Extract<RecordResponse, { status: 'refused' }>

export type ScanOutcome =
  /** The scan ran, finished an earlier one, or a fresh one already existed: read the record. */
  | { kind: 'done'; scanId: string | null; unlabeled: number }
  /** Somebody else's scan for this handle and symbol is running. */
  | { kind: 'joined'; scan: ScanRow }
  | { kind: 'refused'; http: number; body: Refused }

/** Somewhere to go when a scan cannot run. */
export function scanNext(handle: string, symbol: string): { label: string; href: string }[] {
  return [
    { label: 'Open a handle that is already plotted', href: '/x' },
    { label: 'Paste one of their posts instead', href: `/t/${encodeURIComponent(symbol)}?x=${handle}` },
  ]
}

const refused = (http: number, reason: string, next: { label: string; href: string }[]): ScanOutcome => ({ kind: 'refused', http, body: { status: 'refused', reason, next } })

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

export function scanWindowFrom(nowMs: number): number {
  return utcDayStart(nowMs) - SCAN_WINDOW_DAYS * DAY_MS
}

export function defaultScanDeps(): ScanDeps {
  return { store: Store, source: sourceFor(), label: labelPosts, allowance: scanAllowance, now: Date.now }
}

/** A short, plain reason for a failed row (never a stack, never a header, never X's body). */
export function failNote(err: unknown): string {
  const kind = err && typeof err === 'object' && 'kind' in err ? String((err as { kind: unknown }).kind) : ''
  const m = err instanceof Error ? err.message : String(err)
  if (kind === 'rate-limited' || /rate|429/i.test(m)) return 'Stopped: X asked us to slow down. Try again later.'
  if (kind === 'unauthorized') return 'Stopped: X refused this server\'s key.'
  if (/timeout|timed out|abort/i.test(m)) return 'Stopped: X did not answer in time.'
  return 'Stopped: the scan hit an error before it finished.'
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The note a scan finishes with. Pure; pinned. */
export function doneNote(p: { calls: number; postsRead: number; labeled: number; toLabel: number; unlabeled: number }): string {
  if (p.unlabeled > 0) return `Labeled ${p.labeled} of ${p.toLabel} posts. Open it again to finish.`
  return `Found ${plural(p.calls, 'call')} in ${plural(p.postsRead, 'post')}.`
}

/** What a source has spent so far, when it says (SOURCE's XApiSource keeps `spentUsd`). */
function spentOf(source: XSource): number | null {
  const v = (source as { spentUsd?: unknown }).spentUsd
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** The cached posts in the window with no label for this symbol. */
async function unlabeledIn(store: StoreApi, handle: string, symbol: string, fromMs: number): Promise<{ todo: XPost[]; have: StoredLabel[] }> {
  const [have, posts] = await Promise.all([store.labelsFor(handle, symbol), store.postsFor(handle, fromMs)])
  const labeled = new Set(have.map((l) => l.postId))
  return { todo: posts.filter((p) => !labeled.has(p.id)), have }
}

/** Label `todo` within the deadline and save what came back. */
async function labelAndSave(deps: ScanDeps, todo: XPost[], symbol: string, deadlineMs: number): Promise<{ rows: StoredLabel[]; unlabeled: number }> {
  if (!todo.length) return { rows: [], unlabeled: 0 }
  const res = await deps.label(todo, symbol, { deadlineMs, now: deps.now })
  const rows: StoredLabel[] = res.labels.map((l) => ({ ...l.label, postId: l.postId, symbol, origin: 'scan', model: res.model }))
  if (rows.length) await deps.store.saveLabels(rows)
  return { rows, unlabeled: res.unlabeled.length }
}

export async function runScan(input: ScanInput, deps: ScanDeps = defaultScanDeps()): Promise<ScanOutcome> {
  const { handle, requester, internal } = input
  const symbol = input.symbol.toUpperCase()
  const { store, source } = deps
  const nowMs = deps.now()
  const deadlineMs = input.deadlineMs ?? nowMs + SCAN_TIME_BUDGET_MS
  const next = scanNext(handle, symbol)
  const windowFrom = scanWindowFrom(nowMs)

  const last = await store.latestScan(handle, symbol)
  if (last?.status === 'running' && nowMs - last.startedAt < RUNNING_STALE_MS) return { kind: 'joined', scan: last }

  // A finished scan with posts still to label is FINISHED, for free: nothing
  // is read from X, no row opens, no allowance is spent. Works with no source.
  if (last?.status === 'done') {
    const { todo, have } = await unlabeledIn(store, handle, symbol, windowFrom)
    const fresh = !!last.finishedAt && nowMs - last.finishedAt < RESCAN_AFTER_MS
    if (todo.length && (fresh || !source)) {
      const { rows, unlabeled } = await labelAndSave(deps, todo, symbol, deadlineMs)
      const calls = [...have, ...rows].filter((l) => l.stance !== 'none').length
      try {
        await store.updateScan(last.id, { callsFound: calls, note: doneNote({ calls, postsRead: last.postsRead, labeled: have.length + rows.length, toLabel: have.length + todo.length, unlabeled }) })
      } catch {
        /* the labels are saved; the note is a courtesy */
      }
      return { kind: 'done', scanId: last.id, unlabeled }
    }
    if (fresh) return { kind: 'done', scanId: last.id, unlabeled: 0 }
  }

  if (!source) return refused(503, 'Scans are not switched on on this server, so no new posts can be read. Records already plotted still open, and one pasted post still works.', next)

  const allowed = await deps.allowance(requester, nowMs, { handle, symbol })
  if (!allowed.ok) return refused(429, allowed.reason, allowed.next)

  const profile = await source.profile(handle)
  if (!profile) {
    const miss = (source as { lastProfileMiss?: unknown }).lastProfileMiss
    if (miss === 'protected') {
      try {
        await store.saveProfile({ handle, name: handle, avatarUrl: null, followers: null, blue: false, xUserId: null, isProtected: true })
      } catch {
        /* the refusal still stands */
      }
      return refused(403, `@${handle}'s posts are protected, so they cannot be read. Only posts X shows to everyone can be plotted.`, [{ label: 'Plot another handle', href: '/x' }])
    }
    return refused(404, `There is no X account named @${handle}. Check the spelling.`, [{ label: 'Plot another handle', href: '/x' }])
  }
  if (profile.handle !== handle) return refused(404, `X answered for a different account than @${handle}.`, [{ label: 'Plot another handle', href: '/x' }])
  await store.saveProfile({ ...profile, isProtected: false })

  const windowTo = nowMs
  const { scan, joined } = await store.startScan({ handle, symbol, provider: source.name, requestedBy: requester, isInternal: internal, windowFrom, windowTo })
  if (joined) return { kind: 'joined', scan }

  let costUsd = spentOf(source) ?? 0
  let postsRead = 0
  try {
    await store.updateScan(scan.id, { note: `Reading @${handle}'s posts about ${symbol}`, costUsd })
    // Incremental after a finished scan: newestPostId ignores pasted posts, so a post added today never hides older ones.
    const sinceId = last?.status === 'done' ? ((await store.newestPostId(handle)) ?? undefined) : undefined
    const found = await source.search({ handle, terms: termsFor(symbol), fromMs: windowFrom, toMs: windowTo, cap: allowed.postCap, sinceId })
    // The source bills the profile read into the search's cost; its own running total wins when it keeps one.
    costUsd = spentOf(source) ?? found.costUsd
    postsRead = found.readCount
    const own = found.posts.filter((p) => p.handle === handle && postTimeAgrees(p.id, p.postedAt))
    await store.savePosts(own)
    await store.updateScan(scan.id, { postsRead, costUsd, note: `Read ${plural(postsRead, 'post')}` })

    const { todo, have } = await unlabeledIn(store, handle, symbol, windowFrom)
    if (todo.length) await store.updateScan(scan.id, { note: `Labeling ${plural(todo.length, 'post')}` })
    const { rows, unlabeled } = await labelAndSave(deps, todo, symbol, deadlineMs)
    const calls = [...have, ...rows].filter((l) => l.stance !== 'none').length
    await store.updateScan(scan.id, {
      status: 'done',
      finished: true,
      postsRead,
      costUsd,
      callsFound: calls,
      note: doneNote({ calls, postsRead, labeled: have.length + rows.length, toLabel: have.length + todo.length, unlabeled }),
    })
    return { kind: 'done', scanId: scan.id, unlabeled }
  } catch (err) {
    try {
      await store.updateScan(scan.id, { status: 'failed', finished: true, postsRead, costUsd: spentOf(source) ?? costUsd, note: failNote(err) })
    } catch {
      /* the store retires a running row after RUNNING_STALE_MS */
    }
    return refused(502, `${failNote(err)} Posts already read are kept.`, next)
  }
}

// ── The mutation routes' door (app/api/x/scan, app/api/x/add) ────────────

export const CROSS_SITE: Refused = {
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
  store: Pick<StoreApi, 'saveProfile' | 'savePosts' | 'labelsFor' | 'saveLabels'>
  read: (id: string) => Promise<PostRead>
  label: ScanDeps['label']
  allowance: AllowanceFn
  now: () => number
}

export function defaultAddDeps(): AddDeps {
  return { store: Store, read: readPostById, label: labelPosts, allowance: scanAllowance, now: Date.now }
}

export type AddOutcome = { kind: 'added'; postId: string; label: CallLabel } | { kind: 'refused'; http: number; body: Refused }

/**
 * A viewer pastes a post link: read it from X by id (keyless), refuse it
 * unless it is by this handle, label that one post for this symbol, keep it
 * as `added`. Gated by the allowance (a requester out of scans cannot spend
 * model calls this way either); a post already labeled for the symbol is
 * never read or sent to the model again.
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

  const allowed = await deps.allowance(requester, deps.now(), { handle, symbol })
  if (!allowed.ok && allowed.over === 'requester') return no(429, allowed.reason, [...back, ...allowed.next])

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
