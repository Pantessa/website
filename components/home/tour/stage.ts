// THE TOUR's shell rules (squad landing, 2026-11-10; lane STAGE). Pure and
// client-safe: which of the three layouts the tour is in, where a key moves
// the selection, what the stage's foot says. Tour.tsx draws from these and
// scripts/landing-stage-pins.ts pins them on tables of cases.
import { TOUR_IDS, type TourId } from '@/lib/home-tour'

/** The tour answers to ITS OWN width (a container query in tour.css), never
 *  the viewport's:
 *    wide   a vertical list of the eight sides beside the stage;
 *    mid    the list is a row of tabs above the stage;
 *    phone  the eight rows stay a list and the open side's panel sits under
 *           its row (an accordion). */
export type TourLayout = 'wide' | 'mid' | 'phone'

/** tour.css names the layout it is drawing in `--tour-layout` on the body, so
 *  the breakpoints live in ONE place (the stylesheet). The shell reads the
 *  property back; anything unreadable is the server's layout, 'wide'. */
export const TOUR_LAYOUT_PROP = '--tour-layout'

export function parseTourLayout(raw: string | null | undefined): TourLayout {
  const v = (raw ?? '').trim().replace(/['"]/g, '')
  return v === 'phone' || v === 'mid' ? v : 'wide'
}

/** A tablist's orientation by layout: the list runs down the page when wide,
 *  across it as a row of tabs. (The phone's rows are plain buttons.) */
export function tourOrientation(layout: TourLayout): 'vertical' | 'horizontal' {
  return layout === 'mid' ? 'horizontal' : 'vertical'
}

/** Where a key moves the selection from `at`: the arrows of the list's own
 *  orientation step and wrap, Home and End jump. NULL for every other key
 *  (Enter and Space are the button's own; the cross-axis arrows are not the
 *  list's). */
export function tourKeyTarget(at: TourId, key: string, orientation: 'vertical' | 'horizontal'): TourId | null {
  const n = TOUR_IDS.length
  const i = TOUR_IDS.indexOf(at)
  if (i < 0) return null
  if (key === (orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight')) return TOUR_IDS[(i + 1) % n]
  if (key === (orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft')) return TOUR_IDS[(i + n - 1) % n]
  if (key === 'Home') return TOUR_IDS[0]
  if (key === 'End') return TOUR_IDS[n - 1]
  return null
}

/** The side after this one; the last walks back to the first. */
export function tourNextId(at: TourId): TourId {
  return TOUR_IDS[(TOUR_IDS.indexOf(at) + 1) % TOUR_IDS.length]
}

/** The words on the stage's foot button: it walks the tour, and says so when
 *  the walk wraps. */
export function tourNextLabel(at: TourId, label: (id: TourId) => string): string {
  const last = TOUR_IDS.indexOf(at) === TOUR_IDS.length - 1
  return `${last ? 'Start again' : 'Next'}: ${label(tourNextId(at))}`
}

/** A side's place in the tour: `03 / 08` for the eye, "Side 3 of 8" for a
 *  screen reader. Counted from the table, never typed. */
export function tourPosition(at: TourId): { n: number; of: number; label: string; spoken: string } {
  const of = TOUR_IDS.length
  const n = TOUR_IDS.indexOf(at) + 1
  const pad = (v: number) => String(v).padStart(2, '0')
  return { n, of, label: `${pad(n)} / ${pad(of)}`, spoken: `Side ${n} of ${of}` }
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** The tour's heading. The count is the table's own length in words: a side
 *  added to lib/home-tour changes the heading with it. */
export function tourTitle(sides: number = TOUR_IDS.length): string {
  return `One wallet. ${COUNT_WORDS[sides] ?? String(sides)} ways in.`
}

/** The line under the heading. */
export const TOUR_SUB = 'Pick a side to see how it works, then walk straight in.'

/** Two-digit index for a row: `01` … `08`. */
export function tourIndexLabel(i: number): string {
  return String(i + 1).padStart(2, '0')
}
