// THE ACCOUNT PAGE'S RULES (squad called-gtm, lane PROFILE, 2026-11-16).
// Pure: what /x/<handle> sums, which calls it shows, what its share text says
// and whether a crawler may index it. No component and no stylesheet is
// imported here, so scripts/called-gtm-profile-pins.ts can run every rule.
//
// HONESTY (the squad's rule 1, applied to a page of several records):
//   - the one line across markets is the SUM of the entries' own tallies, and
//     its words are spec's (recordHeadline), never re-typed here;
//   - for an account on one market that line IS the record's own headline;
//   - a "best call" is only ever an entry's `best` (gtm bestCallOf: a hit the
//     scan found). No hit anywhere means no block, never a miss dressed up;
//   - misses are shown the same way, under their own label, the same size;
//   - a hit rate is gtm hitRateWords of the sum: counts with their
//     denominator, and nothing under MIN_JUDGED judged calls.
import { FIXTURE_HANDLE } from '@/lib/called-it/fixture'
import { hitRateWords, judgedOf, type BoardCall, type BoardEntry } from '@/lib/called-it/gtm'
import { VERDICT_WORDS, recordHeadline, type CalledTally } from '@/lib/called-it/spec'
import { headlineTally } from '@/lib/called-it/card-layout'
import { X_POST_MAX, xPostWeight, type SharePost } from '@/lib/share-posts'
import { absoluteUrl } from '@/lib/site-url'
import { X_MENTION } from '@/lib/social'

/** Calls shown in each group (the hits, the misses): one per market, three at most. */
export const PROFILE_CALLS_MAX = 3

/**
 * Where a request to take an account's page down is sent: the address the
 * privacy policy itself names (app/docs/privacy CONTACT). The site has no one
 * exported source for its contact addresses; the pin reads the policy's
 * source and holds the two equal.
 */
export const TAKEDOWN_EMAIL = 'privacy@pantessa.com'

type Tallied = Pick<BoardEntry, 'tally'>

/** Every market's tally, added. */
export function sumTally(entries: readonly Tallied[]): CalledTally {
  const sum: CalledTally = { total: 0, right: 0, wrong: 0, flat: 0, open: 0 }
  for (const e of entries) {
    sum.total += e.tally.total
    sum.right += e.tally.right
    sum.wrong += e.tally.wrong
    sum.flat += e.tally.flat
    sum.open += e.tally.open
  }
  return sum
}

/**
 * The account in one sentence, across every market it is scanned on:
 * `@h across 3 markets: 12 calls, 5 called it, 4 missed, 3 too early to say.`
 * On one market it is that record's own headline, to the letter. Empty when
 * there is nothing to sum. The counts' words are spec's (recordHeadline), so
 * lib/called-it/card-layout headlineParts cuts it like any record headline.
 */
export function profileLine(handle: string, entries: readonly Pick<BoardEntry, 'tally' | 'headline' | 'symbol'>[]): string {
  if (!entries.length) return ''
  if (entries.length === 1) return entries[0].headline
  const sum = sumTally(entries)
  return `@${handle} across ${entries.length} markets: ${headlineTally(recordHeadline(handle, entries[0].symbol, 'all', sum))}`
}

/** `Called it on 5 of 8 judged calls.` for a tally, or null under gtm MIN_JUDGED. The verdict's word is spec's. */
export function rateSentence(tally: Pick<CalledTally, 'right' | 'wrong'>): string | null {
  const words = hitRateWords(tally)
  if (!words) return null
  const verdict = VERDICT_WORDS.right
  return `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)} on ${words}.`
}

export interface ProfileCall {
  symbol: string
  call: BoardCall
}

type WithCalls = Pick<BoardEntry, 'symbol' | 'best' | 'worst'>

/** The hits an account is shown by: each market's `best`, in the board's own order. Empty when no market has a hit. */
export function bestCallsOf(entries: readonly WithCalls[], max = PROFILE_CALLS_MAX): ProfileCall[] {
  return entries.flatMap((e) => (e.best && e.best.verdict === 'right' ? [{ symbol: e.symbol, call: e.best }] : [])).slice(0, max)
}

/** The misses, chosen and cut the same way from each market's `worst`. */
export function missCallsOf(entries: readonly WithCalls[], max = PROFILE_CALLS_MAX): ProfileCall[] {
  return entries.flatMap((e) => (e.worst && e.worst.verdict === 'wrong' ? [{ symbol: e.symbol, call: e.worst }] : [])).slice(0, max)
}

/**
 * May a crawler index the account's page? Only when it says something: at
 * least one call that was judged either way, and never the fixture. An empty
 * page, a page of calls all still open, and a handle nobody plotted stay out.
 */
export function profileIndexable(handle: string, entries: readonly Tallied[]): boolean {
  return handle !== FIXTURE_HANDLE && judgedOf(sumTally(entries)) > 0
}

/** The creator's share of a link's fee as a word: `half`, or a percent when the split is not a half. */
export function creatorShareWords(split: number): string {
  return split === 0.5 ? 'half' : `${Math.round(split * 100)}%`
}

const fitPost = (variants: string[]): string => variants.find((t) => xPostWeight(t) <= X_POST_MAX) ?? variants[variants.length - 1]

/**
 * The post for an account's page. The house rules of lib/share-posts hold:
 * printable ASCII on one line, the handle tagged INSIDE the sentence (a post
 * that opens with a mention is filed as a reply), the tally in the records'
 * own words and in full, the standing line as given, one link, last. `mine`
 * (the verified owner is the viewer) turns it to the first person. Only the
 * handle names the account: a display name never enters a post.
 */
export function profilePost(input: { handle: string; line: string; markets: number; standing: string; mine?: boolean }): SharePost {
  const { handle, line, markets, standing, mine = false } = input
  const tally = headlineTally(line)
  const where = markets > 1 ? ` on ${markets} markets` : ''
  const short = `${standing.split('. ')[0].replace(/\.$/, '')}.`
  const lead = mine ? `My calls${where}, each pinned to the day I posted it: ${tally}` : `Calls by @${handle}${where}, each pinned to the day it was posted: ${tally}`
  const close = mine ? `Plot yours with ${X_MENTION}:` : `Plot any handle with ${X_MENTION}:`
  return {
    url: absoluteUrl(`/x/${handle}`),
    title: line,
    text: fitPost([`${lead} ${standing} ${close}`, `${lead} ${short} ${close}`, `${lead} ${short}`, lead]),
  }
}
