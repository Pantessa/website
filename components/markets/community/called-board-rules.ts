// The rules behind "Called it on <SYM>" (components/markets/community/CalledBoard),
// squad called-gtm, lane COMMUNITY. Pure (no React, no CSS), so the lane's pin
// file can import them: which address each press builds, how many cards show
// before "Show all", which call a card is highlighted by, and the small words.
import { chartCallHref, type BoardEntry } from '@/lib/called-it/gtm'
import { chartHref, recordHref } from '@/lib/called-it/spec'
import { cleanLine, fmtCount } from '@/lib/called-it/card-layout'

/** Cards shown before "Show all N". */
export const BOARD_SHOWN = 4

/** Where "Plot another handle" goes. /x reads no market from its address today, so the door opens on its own default. */
export const BOARD_DOOR_HREF = '/x'

/** The board's read. */
export function boardHref(symbol: string): string {
  return `/api/x/board?sym=${encodeURIComponent(symbol)}`
}

/** The card's main press: this page's chart with the account plotted, and its best call's card open when it has one. */
export function plotHref(e: Pick<BoardEntry, 'handle' | 'symbol' | 'best'>): string {
  return e.best ? chartCallHref(e.handle, e.symbol, e.best.postId) : chartHref(e.handle, e.symbol)
}

/** The quiet second press: the account's full record on this market. */
export function fullRecordHref(e: Pick<BoardEntry, 'handle' | 'symbol'>): string {
  return recordHref(e.handle, e.symbol)
}

/** The call a card leads with: only the scan's best HIT. A miss is never dressed as a highlight (`worst` is never read here). */
export function highlightOf(e: Pick<BoardEntry, 'best'>): BoardEntry['best'] {
  return e.best ?? null
}

/** The cards shown now and how many wait behind "Show all". The order is the board's own (never re-sorted). */
export function shownEntries<T>(entries: readonly T[], all: boolean): { shown: T[]; hidden: number } {
  if (all || entries.length <= BOARD_SHOWN) return { shown: [...entries], hidden: 0 }
  return { shown: entries.slice(0, BOARD_SHOWN), hidden: entries.length - BOARD_SHOWN }
}

/** `@cz_binance · 10.9M followers`, or the handle alone when the count is unknown. */
export function handleLine(e: Pick<BoardEntry, 'handle' | 'followers'>): string {
  return e.followers == null ? `@${e.handle}` : `@${e.handle} · ${fmtCount(e.followers)} follower${e.followers === 1 ? '' : 's'}`
}

/** The name a card prints: the display name cleaned to one line, else the handle. */
export function displayName(e: Pick<BoardEntry, 'handle' | 'name'>): string {
  const n = cleanLine(e.name ?? '', 60).trim()
  return n || `@${e.handle}`
}

/** An avatar only from X's own image hosts (the CallsPanel rule), at X's 200px size; anything else draws the initial. */
export function avatarSrc(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'pbs.twimg.com' || u.hostname === 'abs.twimg.com') ? u.toString().replace(/_normal(\.[a-z]+)$/i, '_200x200$1') : null
  } catch {
    return null
  }
}

/** What the board draws for a read: nothing yet, nothing at all (a failed read), one quiet line, or the cards. */
export type BoardView = 'loading' | 'hidden' | 'none' | 'cards'
export function boardView(read: { entries: readonly unknown[]; failed: boolean } | 'loading' | 'error'): BoardView {
  if (read === 'loading') return 'loading'
  if (read === 'error' || read.failed) return 'hidden'
  return read.entries.length ? 'cards' : 'none'
}

export const boardIntro = 'X accounts whose posts about this market were pinned to the day they were posted, then judged by what the price did next.'
export const noEntriesLine = (symbol: string) => `No X account has been plotted on ${symbol} yet.`
