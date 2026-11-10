'use client'

// THE TOUR, STACKED — /story's long form of the home's tour (squad landing,
// 2026-11-10, lane STORY). The home shows one side at a time (the tabbed
// stage, components/home/tour/Tour); the brochure shows all eight at once,
// one under another, so a visitor who asked "What is this?" reads the whole
// product in order.
//
// What it reuses, and why nothing here is a second copy:
//   • the eight panels come from TOUR_PANELS (each side's lane owns its own
//     file) in TOUR_SIDES order (lib/home-tour);
//   • ONE TourProvider around all eight — one connect door for the section,
//     and the server's two snapshots (the tour's + THE READ's) as props, so
//     a panel's first paint is the server's;
//   • the anchors are the home's: `id={tourAnchor(id)}` on each block, so
//     `/story#tour-links` lands on Links here exactly as `/#tour-links` does
//     on the home. The section itself is `#tour`.
//
// Headings: the page has one h1 (the brochure's hero). The section's title
// is an h2; each panel's claim is already an h3 (Panel.tsx), so a block's
// own header (index · label · line) is plain text, never a heading.
//
// Eight panels are mounted at once here. That is fine only because a panel
// polls just while it is on screen (the panels' own rule; a panel that polls
// off screen is reported to its lane, never patched from here).

import { TOUR_ANCHOR, TOUR_SIDES, tourAnchor, tourJourney, type TourSnapshot } from '@/lib/home-tour'
import type { ReadSnapshot } from '@/lib/read'
import { TourProvider } from '@/components/home/tour/context'
import { TOUR_PANELS } from '@/components/home/tour/sides'
import '@/components/markets/look.css'
import './story-tour.css'

/** The section's words. Plain text, no number (a count would come from the snapshot). */
export const STORY_TOUR_COPY = {
  eyebrow: 'Everything it does',
  title: 'Eight ways in. One wallet signs them all.',
  line: 'The whole product, in eight parts. Each one shows what it does with live data, offers a sentence you can run, and opens the door to that side of the app.',
  index: 'The eight parts',
} as const

/** The two-digit index a block wears: 1 → "01". */
export function storyIndex(i: number): string {
  return String(i + 1).padStart(2, '0')
}

export default function StoryTour({ data, read }: { data?: TourSnapshot; read?: ReadSnapshot }) {
  return (
    <TourProvider data={data} read={read}>
      <section className="stour" id={TOUR_ANCHOR} data-story-tour aria-labelledby="stour-title">
        <header className="stour__head">
          <p className="stour__eyebrow mono">{STORY_TOUR_COPY.eyebrow}</p>
          <h2 className="stour__title" id="stour-title">
            {STORY_TOUR_COPY.title}
          </h2>
          <p className="stour__line">{STORY_TOUR_COPY.line}</p>
        </header>

        <nav className="stour__index" aria-label={STORY_TOUR_COPY.index}>
          <ol className="stour__indexlist">
            {TOUR_SIDES.map((s, i) => (
              <li key={s.id} className="stour__indexitem">
                <a className="stour__indexlink" href={`#${tourAnchor(s.id)}`} data-journey={tourJourney(s.id, 'story index')}>
                  <span className="stour__indexnum mono" aria-hidden>
                    {storyIndex(i)}
                  </span>
                  <span className="stour__indexlabel">{s.label}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <ol className="stour__sides">
          {TOUR_SIDES.map((s) => {
            const Panel = TOUR_PANELS[s.id]
            return (
              <li key={s.id} className="stour__side" id={tourAnchor(s.id)} data-story-side={s.id}>
                <div className="stour__sidehead">
                  <span className="stour__num mono" aria-hidden />
                  <span className="stour__label mono">{s.label}</span>
                  <span className="stour__sideline">{s.line}</span>
                </div>
                <div className="stour__panel">
                  <Panel />
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </TourProvider>
  )
}
