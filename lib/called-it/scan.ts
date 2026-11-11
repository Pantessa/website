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
import { addAllowanceFor, allowanceFor, dailyUsdCap, maxScanCostUsd, scanAllowance, scanPostCap, type Allowance } from './budget'
import type { XSearchQueryTimed } from './source/x-api'
import { readPostById, sourceFor } from './source'
import { labelPosts, type LabelDeps, type LabelResult } from './classify'
import { assetTermsFor, marketTermsFor, termsFor } from './terms'
import { marketFor, type MarketDoor } from './market'
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
/** Of the budget, what the search leaves for labeling (review R4e): the search stops paging this long before the deadline. */
export const SEARCH_LABEL_RESERVE_MS = 15_000
/** "No such account" and "protected" are answered from the store this long before X is asked again (review R4b). */
export const MISS_REMEMBER_MS = 24 * 60 * 60 * 1000
/** An incremental re-scan starts this long before the last scan's end (review R7). */
export const RESCAN_OVERLAP_MS = 60 * 60 * 1000

export type StoreApi = Pick<
  typeof Store,
  'getHandle' | 'saveProfile' | 'savePosts' | 'postsFor' | 'newestPostId' | 'labelsFor' | 'saveLabels' | 'latestScan' | 'startScan' | 'updateScan' | 'openScan' | 'markMissing' | 'markProtected' | 'finishedScans' | 'openFinish' | 'closeFinish'
>

export type AllowanceFn = (requester: Requester, nowMs: number, ctx: { handle?: string; symbol?: string }) => Promise<Allowance>

export interface ScanDeps {
  store: StoreApi
  /** ONE instance per scan: a source bills its profile read into the next search's cost. */
  source: XSource | null
  label: (posts: readonly XPost[], symbol: string, deps?: LabelDeps) => Promise<LabelResult>
  allowance: AllowanceFn
  now: () => number
  /** The market door (lib/called-it/market). Absent: the house resolver. */
  market?: (raw: unknown) => Promise<MarketDoor>
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
  if (kind === 'no-credits') return 'Stopped: the credits this site reads X with are spent. Scans return when they are topped up.'
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
/** A post whose batch failed to parse once (in an earlier request) is marked with this model; a second failure gives it UNPARSED_MODEL (review R11b). */
export const UNPARSED_ONCE_MODEL = 'unparsed-1'
export const UNPARSED_MODEL = 'unparsed'

async function unlabeledIn(store: StoreApi, handle: string, symbol: string, fromMs: number): Promise<{ todo: XPost[]; have: StoredLabel[]; failedOnce: Set<string> }> {
  const [all, posts] = await Promise.all([store.labelsFor(handle, symbol), store.postsFor(handle, fromMs)])
  // A post that failed to parse once is still to label (one more try, in a later request).
  const failedOnce = new Set(all.filter((l) => l.model === UNPARSED_ONCE_MODEL).map((l) => l.postId))
  const have = all.filter((l) => !failedOnce.has(l.postId))
  const labeled = new Set(have.map((l) => l.postId))
  return { todo: posts.filter((p) => !labeled.has(p.id)), have, failedOnce }
}

/** Label `todo` within the deadline and save what came back. */
async function labelAndSave(deps: ScanDeps, todo: XPost[], symbol: string, deadlineMs: number, failedOnce: ReadonlySet<string> = new Set()): Promise<{ rows: StoredLabel[]; unlabeled: number }> {
  if (!todo.length) return { rows: [], unlabeled: 0 }
  const res = await deps.label(todo, symbol, { deadlineMs, now: deps.now })
  const rows: StoredLabel[] = res.labels.map((l) => ({ ...l.label, postId: l.postId, symbol, origin: 'scan', model: res.model }))
  // A batch that never parsed (asked twice): its posts are marked, and on the second request that fails they are
  // given `none` for good (review R11b: an account whose posts break the JSON answer cannot buy relabels forever).
  const failed = new Set(res.failed ?? [])
  const marks: StoredLabel[] = [...failed].map((postId) => ({ postId, symbol, stance: 'none', conviction: 0, quote: null, origin: 'scan', model: failedOnce.has(postId) ? UNPARSED_MODEL : UNPARSED_ONCE_MODEL }))
  if (rows.length || marks.length) await deps.store.saveLabels([...rows, ...marks])
  const settled = marks.filter((m) => m.model === UNPARSED_MODEL).length
  return { rows: [...rows, ...marks.filter((m) => m.model === UNPARSED_MODEL)], unlabeled: res.unlabeled.length - settled }
}

export async function runScan(input: ScanInput, deps: ScanDeps = defaultScanDeps()): Promise<ScanOutcome> {
  const { handle, requester, internal } = input
  // One door for the market (review R5): six spellings of BTC are one record, and a market with no chart is refused before anything is read.
  const door = await (deps.market ?? marketFor)(input.symbol)
  if (!door.ok) return refused(door.http, door.reason, door.next)
  const symbol = door.symbol
  // A symbol with no words to search would read every post the account wrote (review R20).
  if (!termsFor(symbol).length) return refused(422, `There are no words to search X for ${symbol} (its ticker starts with a number and it has no name we know), so a scan would read every post the account wrote. Paste one of their posts instead.`, scanNext(handle, symbol))
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
    const pending = await unlabeledIn(store, handle, symbol, windowFrom)
    const fresh = !!last.finishedAt && nowMs - last.finishedAt < RESCAN_AFTER_MS
    if (pending.todo.length && (fresh || !source)) {
      // The same lock as a scan (review R11a): a second request joins, it does not label the same posts again.
      const lease = await store.openFinish({ handle, symbol, requestedBy: requester, isInternal: internal, nowMs })
      if (lease.kind === 'joined') return { kind: 'joined', scan: lease.scan }
      try {
        // Read again under the lease: a finish that just ended may have labeled them.
        const { todo, have, failedOnce } = await unlabeledIn(store, handle, symbol, windowFrom)
        const { rows, unlabeled } = await labelAndSave(deps, todo, symbol, deadlineMs, failedOnce)
        const calls = [...have, ...rows].filter((l) => l.stance !== 'none').length
        try {
          await store.updateScan(last.id, { callsFound: calls, note: doneNote({ calls, postsRead: last.postsRead, labeled: have.length + rows.length, toLabel: have.length + todo.length, unlabeled }) })
        } catch {
          /* the labels are saved; the note is a courtesy */
        }
        return { kind: 'done', scanId: last.id, unlabeled }
      } finally {
        await store.closeFinish(lease.id).catch(() => undefined)
      }
    }
    if (fresh) return { kind: 'done', scanId: last.id, unlabeled: 0 }
  }

  if (!source) return refused(503, 'Scans are not switched on on this server, so no new posts can be read. Records already plotted still open, and one pasted post still works.', next)

  // What we already know about the account answers for a day, before X is asked again (review R4b).
  const known = await store.getHandle(handle)
  const another = [{ label: 'Plot another handle', href: '/x' }]
  if (known?.missingAt && nowMs - known.missingAt < MISS_REMEMBER_MS) return refused(404, `There is no X account named @${handle}. Check the spelling.`, another)
  if (known?.isProtected && known.readAt && nowMs - known.readAt < MISS_REMEMBER_MS) return refused(403, `@${handle}'s posts are protected, so they cannot be read. Only posts X shows to everyone can be plotted.`, another)

  // AN INCREMENTAL RE-SCAN IS PER MARKET (review R7): it reads from the end of the last FINISHED scan of THIS
  // handle on THIS symbol, an hour of overlap kept (the upsert de-duplicates), never from the handle's newest
  // post on any market. With no finished scan it reads the whole window.
  const prior = await store.finishedScans(handle, symbol)
  const lastTo = prior.length ? Math.max(...prior.map((p) => p.windowTo)) : null
  const fromMs = lastTo === null ? windowFrom : Math.max(windowFrom, lastTo - RESCAN_OVERLAP_MS)

  // RESERVE BEFORE SPENDING (review R3): the allowance, the day's spend (running scans at their worst case) and
  // this row are decided together under one lock, and the row holds this scan's worst case until it finishes.
  const postCap = scanPostCap()
  const capUsd = dailyUsdCap()
  const opened = await store.openScan({
    handle,
    symbol,
    provider: source.name,
    requestedBy: requester,
    isInternal: internal,
    windowFrom: fromMs,
    windowTo: nowMs,
    reserveUsd: maxScanCostUsd(postCap),
    nowMs,
    decide: (c) => allowanceFor({ requester, ...c, capUsd, postCap, handle, symbol }),
  })
  if (opened.kind === 'joined') return { kind: 'joined', scan: opened.scan }
  if (opened.kind === 'refused') {
    const a = opened.allowance
    return a.ok ? refused(429, 'Scans are resting.', next) : refused(429, a.reason, a.next)
  }
  const { scan } = opened

  let postsRead = 0
  let saved = false
  const cost = () => spentOf(source) ?? 0
  try {
    // NO SPEND WITHOUT A ROW (review R4a): the profile read happens after the row is open, so its cent is on it whatever X answers.
    const profile = await source.profile(handle)
    if (!profile || profile.handle !== handle) {
      const miss = (source as { lastProfileMiss?: unknown }).lastProfileMiss
      const reason = !profile && miss === 'protected' ? `@${handle}'s posts are protected, so they cannot be read. Only posts X shows to everyone can be plotted.` : !profile ? `There is no X account named @${handle}. Check the spelling.` : `X answered for a different account than @${handle}.`
      try {
        if (!profile && miss === 'protected') await store.markProtected(handle)
        else if (!profile) await store.markMissing(handle)
      } catch {
        /* the refusal still stands */
      }
      await store.updateScan(scan.id, { status: 'refused', finished: true, costUsd: cost(), note: reason })
      return refused(!profile && miss === 'protected' ? 403 : 404, reason, another)
    }
    await store.saveProfile({ ...profile, isProtected: false })
    await store.updateScan(scan.id, { note: `Reading @${handle}'s posts about ${symbol}`, costUsd: cost() })

    // The search gets the scan's time budget less what labeling needs (review R4e).
    const searchDeadline = Math.max(nowMs, deadlineMs - SEARCH_LABEL_RESERVE_MS)
    const found = await searchInPhases(source, { handle, symbol, fromMs, toMs: nowMs, cap: postCap, deadlineMs: searchDeadline })
    postsRead = found.readCount
    // Every post carries its author's id (review R9): X's own author_id when the search named it, else the profile X just answered.
    const own = found.posts.filter((p) => p.handle === handle && postTimeAgrees(p.id, p.postedAt)).map((p) => ({ ...p, xUserId: (p as { xUserId?: string | null }).xUserId ?? profile.xUserId }))
    await store.savePosts(own)
    saved = true
    const readNote = found.stoppedByX ? `Read ${plural(postsRead, 'post')} before X stopped answering; older posts were not read.` : `Read ${plural(postsRead, 'post')}`
    // What this scan covered goes on its row (review R8): the record says how far back it read, never the chart's window.
    await store.updateScan(scan.id, { postsRead, costUsd: cost() || found.costUsd, note: readNote, truncated: found.truncated, oldestPostAt: found.oldestPostAt })

    const { todo, have, failedOnce } = await unlabeledIn(store, handle, symbol, windowFrom)
    if (todo.length) await store.updateScan(scan.id, { note: `Labeling ${plural(todo.length, 'post')}` })
    const { rows, unlabeled } = await labelAndSave(deps, todo, symbol, deadlineMs, failedOnce)
    const calls = [...have, ...rows].filter((l) => l.stance !== 'none').length
    await store.updateScan(scan.id, {
      status: 'done',
      finished: true,
      postsRead,
      costUsd: cost() || found.costUsd,
      callsFound: calls,
      note: doneNote({ calls, postsRead, labeled: have.length + rows.length, toLabel: have.length + todo.length, unlabeled }),
    })
    return { kind: 'done', scanId: scan.id, unlabeled }
  } catch (err) {
    try {
      // What was spent is on the row whatever failed (review R4): the profile, and every page the source billed.
      await store.updateScan(scan.id, { status: 'failed', finished: true, postsRead, costUsd: cost(), note: failNote(err) })
    } catch {
      /* the store retires a running row after RUNNING_STALE_MS, charged its whole reservation */
    }
    return refused(502, saved ? `${failNote(err)} The posts already read are kept.` : failNote(err), next)
  }
}

/** What one scan's search read, over its phases. */
export interface PhasedRead {
  posts: XPost[]
  readCount: number
  costUsd: number
  /** A phase stopped before its window's start: posts older than `oldestPostAt` were not all read. */
  truncated: boolean
  /** For a truncated read, the time from which it is complete (ms); null when it read the whole window. */
  oldestPostAt: number | null
  /** X itself stopped the read (an error or a rate limit after a page), not the cap. */
  stoppedByX: boolean
}

/**
 * The search, in two phases for a market proxy (review R8): the asset's own
 * words first with the whole cap, then the market-call words with whatever
 * the cap left. A phase that stopped early marks the read truncated; the read
 * is complete only from the NEWEST of the truncated phases' oldest posts.
 */
export async function searchInPhases(source: XSource, q: { handle: string; symbol: string; fromMs: number; toMs: number; cap: number; deadlineMs: number }): Promise<PhasedRead> {
  const phases = [assetTermsFor(q.symbol), marketTermsFor(q.symbol)].filter((t) => t.length > 0)
  const byId = new Map<string, XPost>()
  let readCount = 0
  let costUsd = 0
  let truncated = false
  let stoppedByX = false
  let completeFrom: number | null = null
  for (const terms of phases) {
    const left = q.cap - readCount
    // Too little cap left for X's smallest page: the market-word phase is not read. The read is not whole, and
    // the coverage stays what the asset's own words reached (the market words are the secondary net; judgment
    // call, lane FIX hand-back).
    if (left < 10) {
      truncated = true
      if (completeFrom === null) completeFrom = byId.size ? Math.min(...[...byId.values()].map((p) => p.postedAt)) : q.toMs
      break
    }
    const query: XSearchQueryTimed = { handle: q.handle, terms, fromMs: q.fromMs, toMs: q.toMs, cap: left, deadlineMs: q.deadlineMs }
    const r = await source.search(query)
    readCount += r.readCount
    costUsd += r.costUsd
    for (const p of r.posts) byId.set(p.id, p)
    if (r.truncated) {
      truncated = true
      const oldest = r.posts.length ? Math.min(...r.posts.map((p) => p.postedAt)) : q.toMs
      completeFrom = Math.max(completeFrom ?? -Infinity, oldest)
      const stop = (source as { lastStop?: unknown }).lastStop
      if (stop === 'error' || stop === 'rate-limited') stoppedByX = true
      // X stopped, or the time ran out: the next phase would only read less of it.
      if (stop !== 'cap') break
    }
  }
  const posts = [...byId.values()].sort((a, b) => b.postedAt - a.postedAt)
  return { posts, readCount, costUsd: Math.round(costUsd * 1e6) / 1e6, truncated, oldestPostAt: truncated ? completeFrom : null, stoppedByX }
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
  store: Pick<StoreApi, 'saveProfile' | 'savePosts' | 'labelsFor' | 'saveLabels'> & Pick<typeof Store, 'addsCount' | 'reserveAdd'>
  read: (id: string) => Promise<PostRead>
  label: ScanDeps['label']
  now: () => number
  market?: (raw: unknown) => Promise<MarketDoor>
}

export function defaultAddDeps(): AddDeps {
  return { store: Store, read: readPostById, label: labelPosts, now: Date.now }
}

export type AddOutcome = { kind: 'added'; postId: string; label: CallLabel } | { kind: 'refused'; http: number; body: Refused }

/**
 * A viewer pastes a post link: read it from X by id (keyless), refuse it
 * unless it is by this handle, label that one post for this symbol, keep it
 * as `added`. METERED (review R2b): each paste is one house-paid model call,
 * so a requester may add GUEST_ADDS_PER_DAY / PROVEN_ADDS_PER_DAY a UTC day
 * and ADDS_PER_MINUTE a minute, counted from x_calls.added_by (a `none` label
 * counts: it cost a call). The count and the reservation happen together
 * under the requester's lock (store reserveAdd), BEFORE the model is called.
 * A post already labeled for the symbol costs nothing and is not counted.
 */
export async function addPost(input: { handle: string; symbol: string; url: unknown; requester: Requester }, deps: AddDeps = defaultAddDeps()): Promise<AddOutcome> {
  const { handle, requester } = input
  // The market door first (review R2a): no read and no model call for a market with no chart.
  const door = await (deps.market ?? marketFor)(input.symbol)
  if (!door.ok) return { kind: 'refused', http: door.http, body: { status: 'refused', reason: door.reason, next: door.next } }
  const symbol = door.symbol
  const back = [{ label: `Back to @${handle} on ${symbol}`, href: `/t/${encodeURIComponent(symbol)}?x=${handle}` }]
  const no = (http: number, reason: string, next = back): AddOutcome => ({ kind: 'refused', http, body: { status: 'refused', reason, next } })
  const ref = postRefFromUrl(input.url)
  if (!ref) return no(400, 'That is not a link to a post on X. Copy the post\'s link (x.com/<handle>/status/<number>) and paste it here.')
  if (ref.handle && ref.handle !== handle) return no(400, `That link is a post by @${ref.handle}, not @${handle}.`)

  const have = await deps.store.labelsFor(handle, symbol)
  const already = have.find((l) => l.postId === ref.id)
  if (already?.model === Store.ADD_PENDING_MODEL) return no(409, 'That post is being labeled right now. Open the record again in a moment.')
  if (already) return { kind: 'added', postId: ref.id, label: { stance: already.stance, conviction: already.conviction, quote: already.quote } }

  // A cheap look before the read (so a requester over the limit does not make us read X either); the locked count below decides.
  const decide = (c: { today: number; lastMinute: number }) => addAllowanceFor({ requester, ...c, handle, symbol })
  const early = decide(await deps.store.addsCount(requester, deps.now()))
  if (!early.ok) return no(429, early.reason, [...back, ...early.next])

  const got = await deps.read(ref.id)
  if (!got.ok) return got.reason === 'gone' ? no(404, 'X no longer serves that post, so it cannot be added.') : no(503, 'X did not answer for that post. Try again in a moment.')
  const { post, profile } = got
  if (post.handle !== handle || profile.handle !== handle) return no(400, `That post is by @${post.handle}, not @${handle}.`)
  if (!postTimeAgrees(post.id, post.postedAt)) return no(400, 'X answered with a time that does not match the post, so it was not added.')

  await deps.store.saveProfile(profile)
  await deps.store.savePosts([post])
  const held = await deps.store.reserveAdd({ postId: post.id, symbol, requester, nowMs: deps.now(), decide })
  if (held.kind === 'over') return no(429, held.allowance.ok ? 'Too many posts added.' : held.allowance.reason, held.allowance.ok ? back : [...back, ...held.allowance.next])
  if (held.kind === 'exists') {
    if (held.label.model === Store.ADD_PENDING_MODEL) return no(409, 'That post is being labeled right now. Open the record again in a moment.')
    return { kind: 'added', postId: post.id, label: { stance: held.label.stance, conviction: held.label.conviction, quote: held.label.quote } }
  }
  const res = await deps.label([post], symbol)
  const one = res.labels.find((l) => l.postId === post.id)
  if (!one) {
    // The call was made and paid for: the reservation stays counted, as a post that took no side we could check.
    await deps.store.saveLabels([{ stance: 'none', conviction: 0, quote: null, postId: post.id, symbol, origin: 'added', model: 'unparsed', addedBy: requester }])
    return no(502, 'The post was read, but the labeler gave no answer we could check against its words, so it is kept as not a call.')
  }
  await deps.store.saveLabels([{ ...one.label, postId: post.id, symbol, origin: 'added', model: res.model, addedBy: requester }])
  if (one.label.stance === 'none') return no(200, `Read it. That post does not take a side on ${symbol} in words we can quote, so it is not a call.`)
  return { kind: 'added', postId: post.id, label: one.label }
}
