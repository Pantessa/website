// THE WORDS OF THE FIGHT (GTM squad 2026-10-13, lane ARENA; Direction B
// "Your markets, everywhere"). Pure: the sentences the stage, the share card
// and the first-run sheet say about a pick. Nothing here reads a feed, a
// wallet or the DOM — every number in a sentence was measured by the caller
// (lib/battle's ground, the tape's fills) and is printed as given. Pinned by
// scripts/arena-pins.ts (`npm run pins:arena`). Lane CARD imports
// `challengeLine` + `arenaHeadline` for the share copy; lane PICK mounts
// `arenaHeadline` / `warLogLine` / `hillLine` on the battle's head and rail.
//
// Honesty rules (README §3): a leader with the most ground still LEADS when
// every army is under water, but the verb changes ("holds up best"); a window
// the series does not reach back to is said ("since the first price held");
// a war-log line names the measured dollars, the price and the UTC minute, so
// it reads the same wherever it is pasted; nothing promises a result.

import { ARMY_SLICE, MAX_PICK, type PickSource, pickSourceWord } from '@/lib/market-pick'
import { FRONT_WINDOWS, PICK_MODES, armyLabel, fmtPct, type FrontWindow } from '@/lib/battle'
import { fmtPrice, fmtUsd, type TapeSide } from '@/lib/tape'

// ── The challenge (the share copy) ──────────────────────────────────────────

/** The words after the names on a shared fight. ASCII on purpose: a tweet, a
 *  URL's title, a card's alt — never a wallet's, but never a surprise either. */
export const CHALLENGE_TAIL = "who's winning"
/** One market is not a fight; its line asks where it stands. */
export const SOLO_TAIL = 'where it stands'
/** No pick yet (a cold share from an empty row). */
export const EMPTY_CHALLENGE = `Pick your markets · ${CHALLENGE_TAIL}`

/** The window's word in a sentence: `since open` · `15m` · `1h` · `4h` · `24h`. */
export function windowWord(window: FrontWindow): string {
  return FRONT_WINDOWS.find((w) => w.id === window)?.label ?? window
}

/** `ZK · OP · AZTEC`, the venue's spelling through lib/battle armyLabel
 *  (`NVDA·xyz` for a stock perp); past `max` names, `+N`. */
export function namesLine(markets: readonly string[], max = ARMY_SLICE, sep = ' · '): string {
  const names = markets.slice(0, max).map(armyLabel)
  const rest = markets.length - names.length
  return rest > 0 ? `${names.join(sep)} +${rest}` : names.join(sep)
}

/**
 * The challenge: "ZK vs OP vs AZTEC · 1h · who's winning". The battle views
 * march the first five (lib/market-pick ARMY_SLICE), so the line names five
 * and counts the rest; one market reads "ZK · 1h · where it stands"; an empty
 * pick reads the empty challenge (never a blank).
 */
export function challengeLine(markets: readonly string[], window: FrontWindow): string {
  const w = windowWord(window)
  if (markets.length === 0) return EMPTY_CHALLENGE
  if (markets.length === 1) return `${armyLabel(markets[0])} · ${w} · ${SOLO_TAIL}`
  return `${namesLine(markets, ARMY_SLICE, ' vs ')} · ${w} · ${CHALLENGE_TAIL}`
}

// ── The stage headline ──────────────────────────────────────────────────────

export interface ArenaHeadlineInput {
  /** The army holding the most ground (lib/battle rankArmies' first), or null before any price landed. */
  leader: string | null
  /** Its ground, percent since the anchor; null = no track yet. */
  groundPct: number | null
  window: FrontWindow
  /** lib/battle Anchor.partial: the series starts after the window's edge. */
  partial?: boolean
  /** The number of armies on the field (one army "leads" nobody; it "stands"). */
  armies?: number
}

/** What the sentence says before any price has landed. */
export const NO_GROUND_HEADLINE = 'No ground yet · first prices landing'

/** "since 1h ago" · "since open" · "since the first price held (1h window)". */
export function sinceWords(window: FrontWindow, partial = false): string {
  const w = windowWord(window)
  if (partial && window !== 'open') return `since the first price held (${w} window)`
  return window === 'open' ? 'since open' : `since ${w} ago`
}

/**
 * One sentence for the stage head: "OP leads · +8.88% since 1h ago". When
 * the leader's own ground is negative every army is under water and the
 * verb says so: "OP holds up best · −1.20% since 1h ago". A lone army
 * "stands" (there is nobody to lead). Null leader → the waiting words.
 */
export function arenaHeadline(h: ArenaHeadlineInput): string {
  if (!h.leader || h.groundPct === null || !Number.isFinite(h.groundPct)) return NO_GROUND_HEADLINE
  const name = armyLabel(h.leader)
  const solo = (h.armies ?? 2) <= 1
  const verb = solo ? 'stands at' : h.groundPct < 0 ? 'holds up best ·' : 'leads ·'
  return `${name} ${verb} ${fmtPct(h.groundPct)} ${sinceWords(h.window, h.partial)}`
}

/** The Siege's hill, named: "HYPE holds the hill" · "the hill is open". */
export function hillLine(leader: string | null): string {
  return leader ? `${armyLabel(leader)} holds the hill` : 'the hill is open'
}

// ── The war log, shareable ──────────────────────────────────────────────────

export type WarLogInput =
  | { kind: 'burst'; market: string; side: TapeSide; usd: number; price: number; at: number }
  | { kind: 'lead'; market: string; pct: number | null; second?: { market: string; pct: number | null } | null; at: number }

/** `14:02Z` — the UTC minute, so a pasted line reads the same for everyone. */
export function fmtUtcMinute(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`
}

/**
 * Past tense, self-contained, with its minute:
 *   "$120.00K bought on HYPE in one fill at 42.1 · 14:02Z"
 *   "HYPE took the lead at +2.10%, ahead of ETH at +1.00% · 14:02Z"
 * The numbers are the caller's measurements (lib/tape fmtUsd / fmtPrice,
 * lib/battle fmtPct); nothing is rounded here beyond those formats.
 */
export function warLogLine(e: WarLogInput): string {
  if (e.kind === 'burst') {
    return `${fmtUsd(e.usd)} ${e.side === 'buy' ? 'bought' : 'sold'} on ${armyLabel(e.market)} in one fill at ${fmtPrice(e.price)} · ${fmtUtcMinute(e.at)}`
  }
  const second = e.second && e.second.pct !== null ? `, ahead of ${armyLabel(e.second.market)} at ${fmtPct(e.second.pct)}` : ''
  return `${armyLabel(e.market)} took the lead at ${fmtPct(e.pct)}${second} · ${fmtUtcMinute(e.at)}`
}

// ── The first-run sheet (lib words; the component is components/live/PickSheet) ──

/** Once per browser: the sheet opened itself (or a hand dismissed it). */
export const PICK_SHEET_SEEN_KEY = 'pantessa.markets.picksheet.v1'
/** The sheet waits this long after mount before offering itself, so the page paints first and a memory / URL pick settles. */
export const PICK_SHEET_OFFER_DELAY_MS = 1200

export type PickSheetSeat = 'battle' | 'pulse' | 'tape' | 'deck'

export type FillRowId = 'watchlist' | 'held' | 'gainers' | 'biggest'

export interface FillRow {
  id: FillRowId
  /** The row's words — `pickSourceWord`'s for the two that are yours, the venue's PICK_MODES labels for its lists. */
  label: string
  /** What the tap would fill, venue spellings (already resolved; the row is omitted when empty). */
  markets: string[]
  /** Under the label: where the list comes from. */
  hint: string
  /** The journey label (lib/journey reads data-journey). */
  journey: string
}

/** First letter up: `from your watchlist` → `From your watchlist`. */
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** How many a venue list fills in one tap (lib/battle DEFAULT_PICK is three on the field; the row takes the same). */
export const FILL_FROM_VENUE = 3

/**
 * The rows the sheet offers, in order: yours first (the watchlist, the
 * wallet), then the venue's lists. A row whose list resolves to nothing is
 * OMITTED — never a dead button. Each list is capped at MAX_PICK; the
 * venue's at FILL_FROM_VENUE so one tap gives a readable field.
 */
export function fillRows(src: { watch: readonly string[]; held: readonly string[]; gainers: readonly string[]; biggest: readonly string[] }): FillRow[] {
  const gainersDef = PICK_MODES.find((m) => m.id === 'gainers')!
  const biggestDef = PICK_MODES.find((m) => m.id === 'biggest')!
  const rows: FillRow[] = [
    { id: 'watchlist', label: cap(pickSourceWord('watchlist') ?? 'from your watchlist'), markets: src.watch.slice(0, MAX_PICK), hint: 'every watched symbol the venue lists a market for', journey: 'Fill pick from watchlist' },
    { id: 'held', label: cap(pickSourceWord('held') ?? 'from your wallet'), markets: src.held.slice(0, MAX_PICK), hint: 'what the connected wallet holds, biggest first', journey: 'Fill pick from wallet' },
    { id: 'gainers', label: gainersDef.label, markets: src.gainers.slice(0, FILL_FROM_VENUE), hint: gainersDef.hint, journey: 'Fill pick top gainers' },
    { id: 'biggest', label: biggestDef.label, markets: src.biggest.slice(0, FILL_FROM_VENUE), hint: biggestDef.hint, journey: 'Fill pick biggest' },
  ]
  return rows.filter((r) => r.markets.length > 0)
}

/** The sheet's title per seat; the battle's row is a field of armies. */
export function pickSheetTitle(seat: PickSheetSeat): string {
  return seat === 'battle' ? 'Pick your armies' : 'Pick your markets'
}

/** Under the title: what one tap does, and the slice the field marches. */
export function pickSheetBlurb(seat: PickSheetSeat): string {
  return seat === 'battle'
    ? `One tap fills the field. The first ${ARMY_SLICE} march; the row holds ${MAX_PICK}.`
    : `One tap fills the row (up to ${MAX_PICK}). The Front and The Siege march the first ${ARMY_SLICE}.`
}

/** The deck's bar seat is the PHONE's trigger only (a 36px pill beside the channel chips, the bar's own
 *  idiom; a desktop's channel rows carry the picker) — one label, never Pick/Change. */
export const DECK_TRIGGER_WORD = 'Your markets'

/** The trigger's words beside the row: nothing yet → "Pick"; a filled row → "Change"; the deck's bar pill
 *  always "Your markets". */
export function pickTriggerWord(markets: readonly string[], seat: PickSheetSeat = 'battle'): string {
  if (seat === 'deck') return DECK_TRIGGER_WORD
  return markets.length ? 'Change' : 'Pick'
}

/**
 * Whether the sheet may open BY ITSELF this visit: only on an untouched row
 * (not a hand's, not a link's — a default the venue painted still counts as
 * untouched; the moment a hand removes one of its chips the store says
 * 'hand' and the offer is off), only once the store's opening has PAINTED
 * (`ready` — false on the server and until the first read decides, so a
 * memory that lands late never races the offer), only once per browser
 * (`seen` = the flag is set), never on the server. The caller decides after
 * mount and after PICK_SHEET_OFFER_DELAY_MS.
 */
export function shouldOfferFirstRun(d: { source: PickSource; seen: boolean; ready?: boolean }): boolean {
  if (d.seen) return false
  if (d.ready === false) return false
  return d.source !== 'hand' && d.source !== 'url'
}

/** Browser: the once-per-browser flag (try/catch, never throws). */
export function readPickSheetSeen(): boolean {
  try {
    return window.localStorage.getItem(PICK_SHEET_SEEN_KEY) !== null
  } catch {
    return true
  }
}

export function writePickSheetSeen(at = Date.now()): void {
  try {
    window.localStorage.setItem(PICK_SHEET_SEEN_KEY, JSON.stringify({ v: 1, at }))
  } catch {
    // blocked storage: the sheet simply never offers itself again this visit
  }
}
