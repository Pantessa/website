// One record, read on the server: the route (app/api/x/record), the share
// landing (app/x/**) and the share image all call readRecord, so a page and
// the JSON it could have fetched never disagree.
//
// Lane JUDGE (squad called-it, 2026-11-11): the handle row + its cached posts
// + their labels for this symbol + the symbol's daily candles → buildRecord.
// `verified` only when the account itself claimed the handle (and X has not
// since given the handle to a different user id). The fixture handle keeps
// its own path (the harness's and the UI lanes' ground truth): it never
// needs the store, and only reads a claim from it when the store answers.
import { loadCandleSeries } from '@/lib/candles-server'
import type { Candle } from '@/lib/charts'
import * as Store from './store'
import { refreshGone, scansAvailable } from './source'
import { scanAllowance } from './budget'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts, fixtureServed } from './fixture'
import { RUNNING_STALE_MS, scanNext, scanWindowFrom, type AllowanceFn, type StoreApi } from './scan'
import { marketFor, type MarketDoor } from './market'
import type { FinishedScan } from './store'
import { POST_ID_RE, buildRecord, normalizeHandle, normalizeSide, type Coverage, type LabeledPost, type RecordResponse, type Requester, type XProfile } from './spec'

/** @deprecated The market door is lib/called-it/market marketFor (review R5); kept for callers outside this lane. */
export const SYMBOL_RE = /^[A-Za-z0-9.:^-]{1,24}$/

export interface RecordQuery {
  handle: unknown
  symbol: unknown
  side?: unknown
  /** Comma-separated post ids, or a list. */
  pins?: unknown
  /** Who is looking (the route passes it): decides whether `unscanned` says canScan. Pages leave it out. */
  requester?: Requester
}

export interface RecordAnswer {
  http: number
  body: RecordResponse
}

export interface RecordDeps {
  store: Pick<StoreApi, 'getHandle' | 'postsFor' | 'labelsFor' | 'latestScan' | 'finishedScans'>
  candles: (symbol: string) => Promise<Candle[] | null>
  scansAvailable: () => boolean
  allowance?: AllowanceFn
  /** Re-read stale posts by id after the answer (lane SOURCE's refreshGone). */
  refreshGone?: (postIds: readonly string[]) => Promise<unknown>
  /** The market door (lib/called-it/market). Absent: the house resolver. */
  market?: (raw: unknown) => Promise<MarketDoor>
  now: () => number
}

async function loadDaily(symbol: string): Promise<Candle[] | null> {
  const loaded = await loadCandleSeries(symbol, '1d', { deep: true })
  return loaded ? loaded.series.candles : null
}

export function defaultRecordDeps(): RecordDeps {
  return { store: Store, candles: loadDaily, scansAvailable, allowance: scanAllowance, refreshGone, now: Date.now }
}

export function parsePins(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.filter((id): id is string => typeof id === 'string' && POST_ID_RE.test(id)).slice(0, 16)
}

const chartRefused = (symbol: string): RecordAnswer => ({ http: 503, body: { status: 'refused', reason: `The chart for ${symbol} did not answer. Try again in a moment.`, next: [{ label: `Open ${symbol}`, href: `/t/${encodeURIComponent(symbol)}` }] } })
const noChart = (symbol: string): RecordAnswer => ({ http: 404, body: { status: 'refused', reason: `${symbol} has no chart here, so there is nothing to pin a post to.`, next: [{ label: 'Markets', href: '/' }] } })

/** The claim counts only while X still says the handle belongs to the account that claimed it. */
export function verifiedOf(row: Pick<Store.StoredHandle, 'claimedXUserId' | 'claimedAt' | 'xUserId'> | null): { at: number } | null {
  if (!row?.claimedXUserId || !row.claimedAt) return null
  if (row.xUserId && row.xUserId !== row.claimedXUserId) return null
  return { at: row.claimedAt }
}

/**
 * What this symbol's finished scans read (review R8), never the chart's window: `from` is the earliest
 * moment any of them reached (for a truncated scan, the oldest post it read), `to` the latest end,
 * `postsRead` their sum, and `truncated` whether the OLDEST reach was a truncated one (posts before it
 * were not read). Null when nothing has finished. Pure; pinned.
 */
export function coverageOf(scans: readonly Pick<FinishedScan, 'windowFrom' | 'windowTo' | 'postsRead' | 'truncated' | 'oldestPostAt'>[]): Coverage | null {
  if (!scans.length) return null
  const reach = (s: (typeof scans)[number]) => (s.truncated ? (s.oldestPostAt ?? s.windowTo) : s.windowFrom)
  let oldest = scans[0]
  for (const s of scans) if (reach(s) < reach(oldest) || (reach(s) === reach(oldest) && !s.truncated)) oldest = s
  return {
    from: reach(oldest),
    to: Math.max(...scans.map((s) => s.windowTo)),
    postsRead: scans.reduce((n, s) => n + s.postsRead, 0),
    truncated: oldest.truncated,
  }
}

export async function readRecord(q: RecordQuery, deps: RecordDeps = defaultRecordDeps()): Promise<RecordAnswer> {
  const handle = normalizeHandle(q.handle)
  if (!handle) return { http: 400, body: { status: 'refused', reason: 'That is not an X handle. A handle is 1 to 15 letters, numbers or underscores.', next: [{ label: 'Plot a handle', href: '/x' }] } }
  // One door for the market (review R5): the symbol page's own spelling, or a named refusal before anything is read.
  const door = await (deps.market ?? marketFor)(q.symbol)
  if (!door.ok) return { http: door.http, body: { status: 'refused', reason: door.reason, next: door.next } }
  const symbol = door.symbol
  const side = normalizeSide(q.side)
  const pins = parsePins(q.pins)
  const nowMs = deps.now()

  // ── The fixture (local servers and previews only) ──
  if (handle === FIXTURE_HANDLE && fixtureServed()) {
    let candles: Candle[] | null
    try {
      candles = await deps.candles(symbol)
    } catch {
      return chartRefused(symbol)
    }
    if (!candles || candles.length === 0) return noChart(symbol)
    let verified: { at: number } | null = null
    try {
      verified = verifiedOf(await deps.store.getHandle(handle))
    } catch {
      verified = null
    }
    const posts = fixturePosts(nowMs)
    return { http: 200, body: { status: 'ready', record: buildRecord({ handle, symbol, side, profile: FIXTURE_PROFILE, verified, posts, candles, nowMs, scannedAt: nowMs, postsRead: posts.length, pins }) } }
  }

  // ── A real handle ──
  let row: Store.StoredHandle | null
  let scan: Awaited<ReturnType<StoreApi['latestScan']>>
  let labels: Awaited<ReturnType<StoreApi['labelsFor']>>
  let finished: FinishedScan[]
  try {
    // Each read runs inside its own async call, so a store that throws at once rejects instead of stranding the others.
    ;[row, scan, labels, finished] = await Promise.all([(async () => deps.store.getHandle(handle))(), (async () => deps.store.latestScan(handle, symbol))(), (async () => deps.store.labelsFor(handle, symbol))(), (async () => deps.store.finishedScans(handle, symbol))()])
  } catch {
    return { http: 200, body: { status: 'unscanned', handle, symbol, canScan: false, reason: 'Records are not kept on this server yet, so nothing has been plotted here.' } }
  }

  if (scan?.status === 'running' && nowMs - scan.startedAt < RUNNING_STALE_MS) {
    return { http: 200, body: { status: 'scanning', handle, symbol, scanId: scan.id, progress: scan.note ?? `Reading @${handle}'s posts about ${symbol}` } }
  }

  // A pasted call, or calls an earlier scan found (a later re-scan may have failed), still make a record.
  const hasCalls = labels.some((l) => l.stance !== 'none')
  if (!finished.length && !hasCalls) {
    let canScan = deps.scansAvailable()
    let reason: string | undefined
    if (!canScan) reason = 'Scans are not switched on on this server. One pasted post still works.'
    else if (row?.isProtected) {
      canScan = false
      reason = `@${handle}'s posts are protected, so they cannot be read.`
    } else if (q.requester && deps.allowance) {
      try {
        const a = await deps.allowance(q.requester, nowMs, { handle, symbol })
        if (!a.ok) {
          canScan = false
          reason = a.reason
        }
      } catch {
        /* the scan route will word it */
      }
    }
    if (canScan && scan?.status === 'failed' && scan.note) reason = `The last scan did not finish (${scan.note.replace(/^Stopped: /, '').replace(/\.$/, '')}). It can run again.`
    return { http: 200, body: reason ? { status: 'unscanned', handle, symbol, canScan, reason } : { status: 'unscanned', handle, symbol, canScan } }
  }

  let candles: Candle[] | null
  try {
    candles = await deps.candles(symbol)
  } catch {
    return chartRefused(symbol)
  }
  if (!candles || candles.length === 0) return noChart(symbol)

  const fromMs = candles[0].t * 1000
  let cached: Awaited<ReturnType<StoreApi['postsFor']>>
  try {
    cached = await deps.store.postsFor(handle, fromMs)
  } catch {
    return { http: 503, body: { status: 'refused', reason: 'The record did not load. Try again in a moment.', next: scanNext(handle, symbol) } }
  }
  const byPost = new Map(labels.map((l) => [l.postId, l]))
  const posts: LabeledPost[] = []
  for (const p of cached) {
    const l = byPost.get(p.id)
    if (l) posts.push({ ...p, label: { stance: l.stance, conviction: l.conviction, quote: l.quote }, origin: l.origin })
  }
  const coverage = coverageOf(finished)
  const profile: XProfile = row ? { handle, name: row.name, avatarUrl: row.avatarUrl, followers: row.followers, blue: row.blue, xUserId: row.xUserId } : { handle, name: handle, avatarUrl: null, followers: null, blue: false, xUserId: null }
  const record = buildRecord({
    handle,
    symbol,
    side,
    profile,
    verified: verifiedOf(row),
    posts,
    candles,
    nowMs,
    scannedAt: finished.length ? Math.max(...finished.map((f) => f.finishedAt)) : null,
    // What THIS symbol's scans read (review R8), not every post cached for the handle on any market.
    postsRead: coverage?.postsRead ?? 0,
    scanned: finished.length > 0,
    coverage,
    pins,
  })
  if (deps.refreshGone && record.calls.length) {
    const ids = record.calls.map((c) => c.postId)
    const refresh = deps.refreshGone
    try {
      const { after } = await import('next/server')
      after(() => refresh(ids).catch(() => undefined))
    } catch {
      /* outside a request (a script): skip */
    }
  }
  // Posts kept but not yet labeled for this symbol (a scan that ran out of time): the UI offers to finish them, free.
  const winFrom = Math.max(fromMs, scanWindowFrom(nowMs))
  const unlabeled = cached.filter((p) => p.postedAt >= winFrom && !byPost.has(p.id)).length
  return { http: 200, body: unlabeled > 0 ? { status: 'ready', record, unlabeled } : { status: 'ready', record } }
}
