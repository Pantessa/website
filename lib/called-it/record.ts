// One record, read on the server: the route (app/api/x/record), the share
// landing (app/x/**) and the share image all call readRecord, so a page and
// the JSON it could have fetched never disagree.
//
// CONTRACT BASELINE (squad called-it, 2026-11-11): answers the fixture handle
// only, judged on the symbol's real daily candles. Lane JUDGE replaces the
// body with the real read (the post cache, the labels, the scan state, the
// claim) and keeps the signature and the response shape exactly.
import { loadCandleSeries } from '@/lib/candles-server'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts, fixtureServed } from './fixture'
import { POST_ID_RE, buildRecord, normalizeHandle, normalizeSide, type RecordResponse } from './spec'

export const SYMBOL_RE = /^[A-Za-z0-9.:^-]{1,24}$/

export interface RecordQuery {
  handle: unknown
  symbol: unknown
  side?: unknown
  /** Comma-separated post ids, or a list. */
  pins?: unknown
}

export interface RecordAnswer {
  http: number
  body: RecordResponse
}

export function parsePins(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.filter((id): id is string => typeof id === 'string' && POST_ID_RE.test(id)).slice(0, 16)
}

export async function readRecord(q: RecordQuery): Promise<RecordAnswer> {
  const handle = normalizeHandle(q.handle)
  const symRaw = typeof q.symbol === 'string' ? q.symbol.trim() : ''
  if (!handle) return { http: 400, body: { status: 'refused', reason: 'That is not an X handle. A handle is 1 to 15 letters, numbers or underscores.', next: [{ label: 'Plot a handle', href: '/x' }] } }
  if (!SYMBOL_RE.test(symRaw)) return { http: 400, body: { status: 'refused', reason: 'Name a market to plot the handle on.', next: [{ label: 'Markets', href: '/' }] } }
  const symbol = symRaw.toUpperCase()
  const side = normalizeSide(q.side)

  if (handle !== FIXTURE_HANDLE || !fixtureServed()) return { http: 200, body: { status: 'unscanned', handle, symbol, canScan: false, reason: 'Scans arrive with the squad. Only the fixture handle answers yet.' } }

  let loaded
  try {
    loaded = await loadCandleSeries(symbol, '1d', { deep: true })
  } catch {
    return { http: 503, body: { status: 'refused', reason: `The chart for ${symbol} did not answer. Try again in a moment.`, next: [{ label: `Open ${symbol}`, href: `/t/${encodeURIComponent(symbol)}` }] } }
  }
  if (!loaded || loaded.series.candles.length === 0) return { http: 404, body: { status: 'refused', reason: `${symbol} has no chart here, so there is nothing to pin a post to.`, next: [{ label: 'Markets', href: '/' }] } }

  const nowMs = Date.now()
  const posts = fixturePosts(nowMs)
  return { http: 200, body: { status: 'ready', record: buildRecord({ handle, symbol, side, profile: FIXTURE_PROFILE, verified: null, posts, candles: loaded.series.candles, nowMs, scannedAt: nowMs, postsRead: posts.length, pins: parsePins(q.pins) }) } }
}
