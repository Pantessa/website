// Squad called-gtm (2026-11-16) — THE CONTRACT. Pure rules every lane builds
// on: the address of ONE call, which call an account is shown by, and the
// shape of a board entry (one scanned account on one market, summarized).
//
// The go-to-market this serves: an account that was scanned is shown the call
// it got right, on a page worth reposting; its followers land on the chart
// with that call pinned, and the chart's own buttons build the trade.
//
// HONESTY (carried from squad called-it, never loosened here):
//   - a single call is always shown beside the record's FULL tally, hits and
//     misses, in the record's own headline;
//   - only a call the SCAN found is ever "the best call" (a pasted post never);
//   - a hit rate is printed only over MIN_JUDGED judged calls or more;
//   - every number on a board entry is the record's own.
import { VERDICT_WORDS, type CallStance, type CallVerdict, type CalledCall, type CalledSide, type CalledTally } from './spec'

/** The query key that names one call on a record page or on the chart. Its value is a post id (POST_ID_RE). */
export const CALL_PARAM = 'call'

const POST_ID = /^\d{5,20}$/
const enc = encodeURIComponent

/** A post id from an address, or null. Never trusted as anything else. */
export function parseCallParam(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && POST_ID.test(v.trim()) ? v.trim() : null
}

/** The share landing of ONE call: the record page with that call leading. This is the link outreach sends. */
export function callHref(handle: string, symbol: string, postId: string, side: CalledSide = 'all'): string {
  const q = new URLSearchParams()
  if (side !== 'all') q.set('side', side)
  q.set(CALL_PARAM, postId)
  return `/x/${enc(handle)}/${enc(symbol)}?${q.toString()}`
}

/** The live chart with the account plotted and that call's card open. */
export function chartCallHref(handle: string, symbol: string, postId: string, side: CalledSide = 'all'): string {
  const q = new URLSearchParams({ x: handle })
  if (side !== 'all') q.set('side', side)
  q.set(CALL_PARAM, postId)
  return `/t/${enc(symbol)}?${q.toString()}`
}

/** Judged calls needed before a hit rate is printed. Under it the tally's counts stand alone. */
export const MIN_JUDGED = 3

/** Calls with a verdict either way. Flat and open calls are not judged hits or misses. */
export function judgedOf(tally: Pick<CalledTally, 'right' | 'wrong'>): number {
  return tally.right + tally.wrong
}

/** right / (right + wrong) as a fraction, or null under MIN_JUDGED. */
export function hitRateOf(tally: Pick<CalledTally, 'right' | 'wrong'>): number | null {
  const n = judgedOf(tally)
  return n >= MIN_JUDGED ? tally.right / n : null
}

/** `5 of 8 judged calls` (never a bare percent: the denominator is always in the words). Null under MIN_JUDGED. */
export function hitRateWords(tally: Pick<CalledTally, 'right' | 'wrong'>): string | null {
  const n = judgedOf(tally)
  return n >= MIN_JUDGED ? `${tally.right} of ${n} judged calls` : null
}

type Rankable = Pick<CalledCall, 'postId' | 'verdict' | 'impact' | 'postedAt' | 'origin' | 'target'>

/**
 * THE call an account is shown by: among the calls the scan found that read
 * "called it", a level that was HIT first, then the highest impact, then the
 * newest. Null when the record has no hit (the caller then shows the record,
 * never a miss dressed as a highlight).
 */
export function bestCallOf<T extends Rankable>(calls: readonly T[]): T | null {
  const hits = calls.filter((c) => c.origin === 'scan' && c.verdict === 'right')
  if (!hits.length) return null
  const targetHit = (c: Rankable) => (c.target?.outcome === 'hit' ? 1 : 0)
  return [...hits].sort((a, b) => targetHit(b) - targetHit(a) || b.impact - a.impact || b.postedAt - a.postedAt)[0]
}

/** The call an address names, if the record holds it (any origin: a pasted post has an address too). */
export function callById<T extends Pick<CalledCall, 'postId'>>(calls: readonly T[], postId: string | null): T | null {
  return postId ? (calls.find((c) => c.postId === postId) ?? null) : null
}

/** One call as a board entry carries it: enough to quote it, date it, link it and say how it went. */
export interface BoardCall {
  postId: string
  /** The post on X. Null for the fixture. */
  url: string | null
  text: string
  /** The post's own words that carry the call. */
  quote: string
  postedAt: number
  stance: CallStance
  verdict: CallVerdict
  /** VERDICT_WORDS[verdict]. */
  verdictWords: string
  /** The record's own words for the move (spec moveLine). */
  move: string
  priceAt: number
  likes: number | null
}

export function boardCallOf(c: CalledCall, move: string): BoardCall {
  return { postId: c.postId, url: c.url, text: c.text, quote: c.quote, postedAt: c.postedAt, stance: c.stance, verdict: c.verdict, verdictWords: VERDICT_WORDS[c.verdict], move, priceAt: c.priceAt, likes: c.likes }
}

/** One dot on an entry's small price line (percent across and down a 100 by 100 box). */
export interface BoardDot {
  x: number
  y: number
  verdict: CallVerdict
  postId: string
}

/**
 * ONE SCANNED ACCOUNT ON ONE MARKET, summarized. What the symbol page's
 * Community tab, the account page and the outreach desk all read
 * (lib/called-it/board readBoard; GET /api/x/board).
 */
export interface BoardEntry {
  handle: string
  symbol: string
  name: string | null
  /** X's avatar address (pbs.twimg.com). A page draws it through its own avatar loader or an <img> with a fallback. */
  avatarUrl: string | null
  followers: number | null
  /** The account itself signed in with X (the record's strict rule). */
  verified: boolean
  scannedAt: number
  tally: CalledTally
  /** The record's own headline. */
  headline: string
  coverage: string | null
  /** `5 of 8 judged calls`, or null under MIN_JUDGED. */
  hitRate: string | null
  /** An SVG path in a 100 by 100 box. Empty when the chart did not answer. */
  line: string
  dots: BoardDot[]
  /** The call the account is shown by (bestCallOf). Null when the record has no hit. */
  best: BoardCall | null
  /** The strongest miss, for a page that shows both sides. Null when there is none. */
  worst: BoardCall | null
}

/**
 * How entries are ordered on a board: the most judged hits first, then the
 * better hit rate, then the more followers, then the newest scan. A record
 * with no judged call sorts last. Pure, so it is pinned.
 */
export function rankEntries<T extends Pick<BoardEntry, 'tally' | 'followers' | 'scannedAt'>>(entries: readonly T[]): T[] {
  const rate = (e: T) => hitRateOf(e.tally) ?? -1
  return [...entries].sort((a, b) => b.tally.right - a.tally.right || rate(b) - rate(a) || (b.followers ?? 0) - (a.followers ?? 0) || b.scannedAt - a.scannedAt)
}

/** What a stance offers as the follow-up trade on the chart: a bull call a buy, a bear call a sell or a short. The surface decides what its venue can run. */
export function actSideFor(stance: CallStance): 'buy' | 'sell' {
  return stance === 'bull' ? 'buy' : 'sell'
}
