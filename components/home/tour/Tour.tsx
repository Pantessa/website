'use client'

// THE TOUR — "everything it does" on the landing (squad landing, 2026-11-10;
// lane STAGE owns this file and tour.css after the contract). Eight sides of
// the product; each has a claim, a live miniature and a door into that side
// of the app (lib/home-tour).
//
// CONTRACT BASELINE: a plain working shell — a heading, eight tabs, the
// selected side's panel, the hash (`/#tour-links`) read after mount. It
// exists so every lane sees its panel in place from the first minute. Lane
// STAGE builds the real thing over it: the list-beside-a-stage layout, the
// phone's posture, keyboard, the quiet auto-advance, the returning
// visitor's slim strip.
//
// Kept by whoever rewrites this:
//   • the section is `<section id="tour" data-tour>`; a tab is
//     `id={tourAnchor(id)}` (`#tour-links`) with `data-tour-tab={id}`;
//   • panels come from TOUR_PANELS and are wrapped in ONE TourProvider;
//   • the page is ISR — a side is selected from the HASH in the browser,
//     never from a query string on the server;
//   • headings here are h2 (the section) and h3 (a panel): the page has one h1.

import { useEffect, useState } from 'react'
import { TOUR_ANCHOR, TOUR_SIDES, parseTourHash, tourAnchor, tourJourney, type TourId, type TourSnapshot } from '@/lib/home-tour'
import type { ReadSnapshot } from '@/lib/read'
import { TourProvider } from './context'
import { TOUR_PANELS } from './sides'
import './tour.css'

export default function Tour({ data, read }: { data?: TourSnapshot; read?: ReadSnapshot }) {
  const [on, setOn] = useState<TourId>(TOUR_SIDES[0].id)
  useEffect(() => {
    const sync = () => {
      const id = parseTourHash(window.location.hash)
      if (id) setOn(id)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const Panel = TOUR_PANELS[on]
  return (
    <TourProvider data={data} read={read}>
      <section className="tour" id={TOUR_ANCHOR} data-tour aria-labelledby="tour-title">
        <header className="tour__head">
          <p className="tour__eyebrow mono">Everything it does</p>
          <h2 className="tour__title" id="tour-title">
            One wallet. Eight ways in.
          </h2>
        </header>
        <div className="tour__tabs" role="tablist" aria-label="What Pantessa does">
          {TOUR_SIDES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={tourAnchor(s.id)}
              className={`tour__tab${s.id === on ? ' is-on' : ''}`}
              aria-selected={s.id === on}
              aria-controls="tour-stage"
              tabIndex={s.id === on ? 0 : -1}
              onClick={() => setOn(s.id)}
              data-tour-tab={s.id}
              data-journey={tourJourney(s.id, 'tab')}
            >
              <span className="tour__tablabel">{s.label}</span>
              <span className="tour__tabline">{s.line}</span>
            </button>
          ))}
        </div>
        <div className="tour__stage" id="tour-stage" role="tabpanel" aria-labelledby={tourAnchor(on)} data-tour-stage={on}>
          <Panel />
        </div>
      </section>
    </TourProvider>
  )
}
