'use client'

// THE TOUR — "everything it does" on the landing (squad landing, 2026-11-10;
// lane STAGE owns this file, tour.css, stage.ts and icons.ts). Eight sides of
// the product; each has a claim, a live miniature and a door into that side
// of the app (lib/home-tour). This file is the SHELL: the list of the eight,
// the stage that shows the selected side's panel, the phone's accordion, the
// keyboard, the hash, and the slim strip a returning visitor gets.
//
// ONE server HTML, folded by CSS (the page is a 60-second static page):
//
//   • POSTURE. The server always renders the stranger's tour AND the
//     returning visitor's strip; `:root[data-home='return']` (set before
//     first paint, lib/home-mode) shows one and hides the other, so nothing
//     jumps. After mount the shell reads the same attribute and, in the
//     return posture, does not mount the stage at all (a panel polls and
//     measures). A deep link to a side (`/#tour-links`) opens the whole tour
//     for that page view without touching the visitor's remembered choice.
//
//   • LAYOUT. The tour answers to its own width (container queries in
//     tour.css): WIDE is a vertical list beside the stage, MID is a row of
//     tabs above it, PHONE is the eight rows as a list with the open side's
//     panel under its row. A PHONE STARTS FOLDED: the point of the section
//     is the list, so all eight rows fit one screen and nothing is open
//     until a tap (or a deep link). The fold is the stylesheet's, in the
//     first paint: the phone query hides the stage until the shell marks a
//     side open (`data-tour-open`), so hydration pulls nothing out from
//     under the reader. The stylesheet names the layout it is drawing in
//     `--tour-layout`; the shell reads that back (one source for the
//     breakpoints) to pick the roles — a real tablist when wide or mid,
//     buttons with aria-expanded on a phone — and, on a phone, to move the
//     stage in the DOM to sit under its row, where the stylesheet had
//     already drawn it (`order`), so focus order follows the eye.
//
//   • NOTHING CHANGES BY ITSELF. No timer selects a side. The stage's foot
//     says where you are (`03 / 08`) and offers the next side.
//
//   • THE STAGE'S HEIGHT is the stylesheet's: a floor per layout (wide: the
//     list's own height, the two share a bottom edge; mid: a fixed floor).
//     A taller panel grows the stage and a shorter one gives the height
//     back. (Round 1 kept the tallest panel seen; with real panels that left
//     a large blank under every side after the tallest, so it went.)
//
// Kept by whoever edits this:
//   • the section is `<section id="tour" data-tour>`; a row is
//     `id={tourAnchor(id)}` (`#tour-links`) with `data-tour-tab={id}`;
//   • panels come from TOUR_PANELS, ONE at a time, inside ONE TourProvider;
//   • a side is selected from the HASH in the browser, never from a query
//     string; a visitor's own selection writes the hash with
//     history.replaceState (never the router: that would re-render the page);
//   • headings are h2 (the section) and h3 (a panel): the page has one h1.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, X } from 'lucide-react'
import LandingLink from '@/components/home/LandingLink'
import { HOME_MODE_EVENT, setTourPref } from '@/components/home/HomeModeSync'
import { HOME_MODE_ATTR, type HomeMode } from '@/lib/home-mode'
import { TOUR_ANCHOR, TOUR_SIDES, parseTourHash, tourAnchor, tourJourney, tourSide, type TourId, type TourSideMeta, type TourSnapshot } from '@/lib/home-tour'
import type { ReadSnapshot } from '@/lib/read'
import { TourProvider } from './context'
import { TOUR_ICONS } from './icons'
import { TOUR_PANELS } from './sides'
import { TOUR_LAYOUT_PROP, TOUR_SUB, parseTourLayout, tourIndexLabel, tourKeyTarget, tourNextId, tourNextLabel, tourOrientation, tourPosition, tourTitle, type TourLayout } from './stage'
import './tour.css'

// ── The posture, read from <html> (never from storage: lib/home-mode owns that) ──
function subscribeHomeMode(onChange: () => void): () => void {
  window.addEventListener(HOME_MODE_EVENT, onChange)
  // The attribute also moves without the event: another tab's choice (a
  // storage event in HomeModeSync) and a soft navigation's first apply.
  const seen = new MutationObserver(onChange)
  seen.observe(document.documentElement, { attributes: true, attributeFilter: [HOME_MODE_ATTR] })
  return () => {
    window.removeEventListener(HOME_MODE_EVENT, onChange)
    seen.disconnect()
  }
}
const homeModeNow = (): HomeMode => (document.documentElement.getAttribute(HOME_MODE_ATTR) === 'return' ? 'return' : 'new')
const homeModeOnServer = (): HomeMode => 'new'

/** The element that scrolls `el`: the phone frame scrolls inside an element
 *  (app/native-shell.css), the desktop page scrolls the document. */
function scrollerOf(el: HTMLElement): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const flow = getComputedStyle(p).overflowY
    if ((flow === 'auto' || flow === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return document.scrollingElement ?? document.documentElement
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A sideways-scrolling row says which of its ends hold more (`data-more`),
 *  so the stylesheet fades only an edge that hides something. */
function useMoreEdges(ref: RefObject<HTMLElement | null>, watch: unknown) {
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const mark = () => {
      const start = row.scrollLeft > 2
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 2
      row.dataset.more = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none'
    }
    mark()
    row.addEventListener('scroll', mark, { passive: true })
    const sized = new ResizeObserver(mark)
    sized.observe(row)
    return () => {
      row.removeEventListener('scroll', mark)
      sized.disconnect()
    }
  }, [ref, watch])
}

/** What to do with the scroll once the next frame is drawn. */
type After =
  | { kind: 'hold'; id: TourId; top: number } // a phone tap: the tapped row stays under the finger
  | { kind: 'land'; id: TourId } // a deep link, or Next on a phone: that side comes to the top
  | { kind: 'top' } // the tour was asked for: its head comes to the top
  | { kind: 'near' } // the tour was folded: the strip stays in view

/** A side's PRIMARY door from the table, as one small door on the strip. */
function StripDoor({ side }: { side: TourSideMeta }) {
  const door = side.doors[0]
  const Icon = TOUR_ICONS[side.id]
  const inner = (
    <>
      <Icon className="tour__dooricon" aria-hidden />
      <span>{side.label}</span>
    </>
  )
  const shared = { className: 'tour__door', title: door.label, 'aria-label': `${side.label}: ${door.label}`, 'data-tour-door': side.id, 'data-journey': tourJourney(side.id, 'strip door') }
  return door.href.startsWith('#') ? (
    <a href={door.href} {...shared}>
      {inner}
    </a>
  ) : (
    <LandingLink href={door.href} prefetch={false} {...shared}>
      {inner}
    </LandingLink>
  )
}

export default function Tour({ data, read }: { data?: TourSnapshot; read?: ReadSnapshot }) {
  // The selected side. `open` is the phone's accordion: nothing is open until the visitor taps a row (or a deep
  // link names one), and a second tap on the open row folds it. Wide and mid always show the selected side.
  const [sel, setSel] = useState<{ id: TourId; open: boolean }>({ id: TOUR_SIDES[0].id, open: false })
  const [layout, setLayout] = useState<TourLayout>('wide')
  // A deep link to a side shows the whole tour for this page view, whatever the posture.
  const [forced, setForced] = useState(false)
  // The panel fades in only after the visitor changed the side (never on load).
  const [fade, setFade] = useState(false)
  const mode = useSyncExternalStore(subscribeHomeMode, homeModeNow, homeModeOnServer)
  const strip = mode === 'return' && !forced

  const sectionRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stripRowRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<TourId, HTMLButtonElement | null>>>({})
  const layoutRef = useRef<TourLayout>('wide')
  const after = useRef<After | null>(null)

  // ── The layout: the stylesheet decides, the shell reads it back ──
  useLayoutEffect(() => {
    const section = sectionRef.current
    const body = bodyRef.current
    if (!section || !body) return
    const readLayout = () => {
      const next = parseTourLayout(getComputedStyle(body).getPropertyValue(TOUR_LAYOUT_PROP))
      layoutRef.current = next
      setLayout(next)
    }
    readLayout()
    const sized = new ResizeObserver(readLayout)
    sized.observe(section)
    return () => sized.disconnect()
  }, [])

  // ── The hash: `/#tour-links` selects that side after mount and brings it into view ──
  useEffect(() => {
    const sync = () => {
      const id = parseTourHash(window.location.hash)
      if (!id) return
      after.current = { kind: 'land', id }
      setForced(true)
      setSel({ id, open: true })
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  /** The visitor picks a side: a tap, a key, or the foot's Next. */
  const select = useCallback((id: TourId, why: 'tap' | 'key' | 'next') => {
    const phone = layoutRef.current === 'phone'
    const row = tabRefs.current[id]
    after.current = !phone ? null : why === 'next' ? { kind: 'land', id } : row ? { kind: 'hold', id, top: row.getBoundingClientRect().top } : null
    setFade(true)
    setSel((cur) => (phone && why === 'tap' && cur.id === id ? { id, open: !cur.open } : cur.id === id && cur.open ? cur : { id, open: true }))
    // The address names the side (a link to copy, a reload that returns here). replaceState: no navigation, no re-render of the page.
    window.history.replaceState(window.history.state, '', `#${tourAnchor(id)}`)
  }, [])

  const hide = useCallback(() => {
    after.current = { kind: 'near' }
    setForced(false)
    // A reload must not re-open what the visitor just closed: the address goes back to the section's own anchor.
    if (parseTourHash(window.location.hash)) window.history.replaceState(window.history.state, '', `#${TOUR_ANCHOR}`)
    setTourPref('closed')
  }, [])
  const show = useCallback(() => {
    after.current = { kind: 'top' }
    setTourPref('open')
  }, [])

  // ── The scroll that follows a change, once the change is drawn (before paint) ──
  useLayoutEffect(() => {
    const todo = after.current
    after.current = null
    if (!todo) return
    if (todo.kind === 'hold') {
      const row = tabRefs.current[todo.id]
      const moved = row ? row.getBoundingClientRect().top - todo.top : 0
      if (row && Math.abs(moved) > 1) scrollerOf(row).scrollTop += moved
    } else if (todo.kind === 'land') {
      const target = layout === 'phone' ? tabRefs.current[todo.id] : sectionRef.current
      target?.scrollIntoView({ block: 'start' })
    } else {
      sectionRef.current?.scrollIntoView({ block: todo.kind === 'top' ? 'start' : 'nearest' })
    }
  }, [sel, layout, strip])

  // ── A row of tabs keeps the selected one in view (the row scrolls, never the page) ──
  useEffect(() => {
    const row = listRef.current
    const el = tabRefs.current[sel.id]
    if (layout !== 'mid' || !row || !el || row.scrollWidth <= row.clientWidth) return
    const left = el.offsetLeft
    if (left < row.scrollLeft + 24 || left + el.offsetWidth > row.scrollLeft + row.clientWidth - 24) row.scrollTo({ left: Math.max(0, left - 48), behavior: calm() ? 'auto' : 'smooth' })
  }, [sel.id, layout])
  useMoreEdges(listRef, layout)
  useMoreEdges(stripRowRef, strip)

  const phone = layout === 'phone'
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phone || e.metaKey || e.ctrlKey || e.altKey) return
    const to = tourKeyTarget(sel.id, e.key, tourOrientation(layout))
    if (!to) return
    e.preventDefault()
    // The markets index walks its rows with the same arrows on window: these belong to the list.
    e.stopPropagation()
    select(to, 'key')
    tabRefs.current[to]?.focus()
  }

  const side = tourSide(sel.id)
  const at = TOUR_SIDES.findIndex((s) => s.id === sel.id)
  const pos = tourPosition(sel.id)
  const nextId = tourNextId(sel.id)
  const Panel = TOUR_PANELS[sel.id]
  // Wide and mid always show the selected side; a phone shows one only once it was opened.
  const showStage = !strip && (!phone || sel.open)

  // The stage: the selected side's panel (the ONLY one mounted) and the foot that walks the tour.
  const stage = showStage ? (
    <div
      className="tour__stage"
      id="tour-stage"
      role={phone ? 'region' : 'tabpanel'}
      aria-labelledby={tourAnchor(sel.id)}
      data-tour-stage={sel.id}
    >
      <div className={`tour__panel${fade ? ' is-in' : ''}`} key={sel.id}>
        <Panel />
      </div>
      <footer className="tour__foot">
        <span className="tour__pips" aria-hidden>
          {TOUR_SIDES.map((s, i) => (
            <i key={s.id} className={i <= at ? 'is-done' : undefined} />
          ))}
        </span>
        {/* The digits and the name are for the eye; a screen reader gets one plain sentence. */}
        <span className="tour__count mono" aria-hidden>
          {pos.label}
        </span>
        <span className="tour__here" aria-hidden>
          {side.label}
        </span>
        <span className="sr-only">{`${pos.spoken}: ${side.label}`}</span>
        <button type="button" className="tour__next" onClick={() => select(nextId, 'next')} data-tour-next={nextId} data-journey={tourJourney(nextId, 'next')}>
          {tourNextLabel(sel.id, (id) => tourSide(id).label)}
          <span className="tour__arrow" aria-hidden>
            →
          </span>
        </button>
      </footer>
    </div>
  ) : null

  return (
    <TourProvider data={data} read={read}>
      <section className="tour" id={TOUR_ANCHOR} ref={sectionRef} data-tour data-tour-layout={layout} data-tour-forced={forced || undefined} aria-labelledby="tour-title">
        {/* ── The returning visitor's strip: eight doors, one row ── */}
        <nav className="tour__strip" aria-label="Jump into a side of the app" data-tour-strip>
          <div className="tour__striprow" ref={stripRowRef}>
            <span className="tour__striplab mono">Jump in</span>
            <ul className="tour__doors">
              {TOUR_SIDES.map((s) => (
                <li key={s.id}>
                  <StripDoor side={s} />
                </li>
              ))}
            </ul>
            <button type="button" className="tour__show mono" onClick={show} data-tour-show data-journey="Tour: show the tour">
              Show the tour
            </button>
          </div>
        </nav>

        {/* ── The stranger's tour ── */}
        <div className="tour__full" data-tour-full>
          <header className="tour__head">
            <div className="tour__headtext">
              <p className="tour__eyebrow mono">Everything it does</p>
              <h2 className="tour__title" id="tour-title">
                {tourTitle(TOUR_SIDES.length)}
              </h2>
              <p className="tour__sub">{TOUR_SUB}</p>
            </div>
            <button type="button" className="tour__hide mono" onClick={hide} aria-label="Hide the tour" title="Fold the tour into one row of doors" data-tour-hide data-journey="Tour: hide the tour">
              Hide
              <X className="tour__hideicon" aria-hidden />
            </button>
          </header>

          <div className="tour__body" ref={bodyRef} data-tour-open={sel.open || undefined} style={{ '--tour-at': at } as CSSProperties}>
            <div
              className="tour__list"
              ref={listRef}
              role={phone ? 'group' : 'tablist'}
              aria-label="What Pantessa does"
              aria-orientation={phone ? undefined : tourOrientation(layout)}
              onKeyDown={onListKey}
            >
              {TOUR_SIDES.map((s, i) => {
                const on = s.id === sel.id
                const Icon = TOUR_ICONS[s.id]
                // A real tab when the list is a tablist; on a phone a button that opens its panel under itself.
                const role = phone
                  ? { 'aria-expanded': on && sel.open, 'aria-controls': on && showStage ? 'tour-stage' : undefined }
                  : { role: 'tab' as const, 'aria-selected': on, 'aria-controls': 'tour-stage', tabIndex: on ? 0 : -1 }
                return (
                  <Fragment key={s.id}>
                    <button
                      type="button"
                      {...role}
                      id={tourAnchor(s.id)}
                      ref={(el) => {
                        tabRefs.current[s.id] = el
                      }}
                      className={`tour__tab${on && (!phone || sel.open) ? ' is-on' : ''}`}
                      style={{ '--i': i } as CSSProperties}
                      onClick={() => select(s.id, 'tap')}
                      data-tour-tab={s.id}
                      data-journey={tourJourney(s.id, 'tab')}
                    >
                      <span className="tour__idx mono" aria-hidden>
                        {tourIndexLabel(i)}
                      </span>
                      <Icon className="tour__icon" aria-hidden />
                      <span className="tour__tabtext">
                        <span className="tour__tablabel">{s.label}</span>{' '}
                        <span className="tour__tabline">{s.line}</span>
                      </span>
                      <ChevronDown className="tour__chev" aria-hidden />
                    </button>
                    {/* On a phone the stage lives under its row, where the stylesheet already drew it. */}
                    {phone && on && stage}
                  </Fragment>
                )
              })}
            </div>
            {!phone && stage}
          </div>
        </div>
      </section>
    </TourProvider>
  )
}
