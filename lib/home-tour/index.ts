// THE TOUR's table (squad landing, 2026-11-10; COORDINATOR-OWNED, frozen
// after the contract commit — a lane edits its own side's file, never this
// one). Assembles the eight sides in order and holds the small pure rules
// every surface shares: the anchor ids, the hash reader, the slot filler.
import { meta as charts } from './charts'
import { meta as ask } from './ask'
import { meta as links } from './links'
import { meta as autopilots } from './autopilots'
import { meta as community } from './community'
import { meta as earn } from './earn'
import { meta as wallet } from './wallet'
import { meta as build } from './build'
import { TOUR_IDS, type TourId, type TourSideMeta, type TourSnapshot } from './types'

export * from './types'

const BY_ID: Record<TourId, TourSideMeta> = { charts, ask, links, autopilots, community, earn, wallet, build }

/** The eight sides, in TOUR_IDS order. */
export const TOUR_SIDES: readonly TourSideMeta[] = TOUR_IDS.map((id) => BY_ID[id])

export function tourSide(id: TourId): TourSideMeta {
  return BY_ID[id]
}

export function isTourId(v: unknown): v is TourId {
  return typeof v === 'string' && (TOUR_IDS as readonly string[]).includes(v)
}

/** The section's own anchor: the hero's "see everything" lands here. */
export const TOUR_ANCHOR = 'tour'

/** A side's anchor id. Prefixed, because the page already owns `#earn`,
 *  `#macro`, `#equities`, `#crypto` and `#perps` (the boards). A post can
 *  link straight to a side: pantessa.com/#tour-links. */
export function tourAnchor(id: TourId): string {
  return `${TOUR_ANCHOR}-${id}`
}

/** Read a location hash: `#tour-links` → 'links'; `#tour` or anything else → null.
 *  The page is ISR, so a side is NEVER selected from a query string on the
 *  server — only from the hash, in the browser, after mount. */
export function parseTourHash(hash: string | null | undefined): TourId | null {
  if (!hash) return null
  const m = /^#?tour-([a-z]+)$/.exec(hash.trim())
  return m && isTourId(m[1]) ? m[1] : null
}

/** Every `{slot}` a side's words may carry, and where its value comes from. */
function slotValue(slot: string, snap: TourSnapshot): string | null {
  const n = (v: number | null) => (v == null ? null : v.toLocaleString('en-US'))
  switch (slot) {
    case 'stocks':
      return n(snap.counts.stocks)
    case 'crypto':
      return n(snap.counts.crypto)
    case 'macro':
      return n(snap.counts.macro)
    case 'apps':
      return n(snap.counts.apps)
    case 'chains':
      return n(snap.counts.chains)
    case 'venues':
      return n(snap.counts.venues)
    case 'pinnedAddresses':
      return n(snap.counts.pinnedAddresses)
    case 'earnWays':
      return n(snap.counts.earnWays)
    case 'swapPct':
      return snap.fees?.swapPct ?? null
    case 'linkPct':
      return snap.fees?.linkPct ?? null
    case 'creatorPct':
      return snap.fees?.creatorPct ?? null
    case 'hlPct':
      return snap.fees?.hlPct ?? null
    default:
      return null
  }
}

/** Fill a line's `{slot}`s from the snapshot. Returns NULL when any slot has
 *  no value — the caller drops the line (a fact) or falls back to words
 *  without the number (a body). A number is never typed and never a hole. */
export function fillSlots(text: string, snap: TourSnapshot): string | null {
  let missing = false
  const out = text.replace(/\{([a-zA-Z]+)\}/g, (_, slot: string) => {
    const v = slotValue(slot, snap)
    if (v == null) missing = true
    return v ?? ''
  })
  return missing ? null : out
}

/** A side's facts with their slots filled; a fact with a missing value is dropped. */
export function tourFacts(side: TourSideMeta, snap: TourSnapshot): string[] {
  return side.facts.map((f) => fillSlots(f, snap)).filter((f): f is string => f !== null)
}

/** A side's body with its slots filled. With a value missing, the slot's
 *  clause is cut back to plain words (the `{n} ` before a noun is removed),
 *  so the sentence still reads. */
export function tourBody(side: TourSideMeta, snap: TourSnapshot): string {
  return fillSlots(side.body, snap) ?? side.body.replace(/\{[a-zA-Z]+\}\s*/g, '').replace(/\s{2,}/g, ' ')
}

/** The journey label for a door or a chip, so the flows page can say which
 *  side pulled a visitor in. One spelling, used by every panel. */
export function tourJourney(id: TourId, what: string): string {
  return `Tour ${BY_ID[id].label}: ${what}`
}
