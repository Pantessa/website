// THE CLOSING DOORS — the last thing on the landing before the footer
// (squad landing, 2026-11-10; lane CLOSE owns this file and closing.css).
// Whoever read this far gets the eight sides once more, one door each, then
// one quiet row of the public pages. Nothing else.
//
// TABLE-DRIVEN: the grid is TOUR_SIDES in order — each side's label, its
// one line and its PRIMARY door (lib/home-tour) — so it can never drift
// from the tour. The index numbers are a CSS counter (closing.css).
//
// Doors (standing rule 6): an on-page anchor (`#earn`) is a plain <a>;
// everything else is a LandingLink (a public page is a plain link, a
// signed-in page opens the unified door aimed at itself). No `redirectTo`.
// Every link carries `data-journey="Closing: <label>"`.

import LandingLink from '@/components/home/LandingLink'
import { TOUR_SIDES, type TourDoor, type TourSnapshot } from '@/lib/home-tour'
import './closing.css'

/** The quiet row under the grid: the public pages a reader may want last. */
export const CLOSING_QUIET = [
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Analytics', href: '/analytics' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: '/docs' },
  { label: 'The story', href: '/story' },
] as const

/** A side's primary door (the table puts it first; fall back to the first door). */
function primaryDoor(doors: readonly TourDoor[]): TourDoor | undefined {
  return doors.find((d) => d.kind === 'primary') ?? doors[0]
}

export default function ClosingDoors(_props: { data?: TourSnapshot }) {
  return (
    <section className="closing" aria-labelledby="closing-title" data-closing>
      <header className="closing__head">
        <p className="closing__eyebrow mono">Eight ways in</p>
        <h2 id="closing-title" className="closing__title">
          Pick a way in.
        </h2>
        <p className="closing__lede">Every side of Pantessa, one door each. Looking needs no sign-in; your wallet is asked for when you act.</p>
      </header>

      <ul className="closing__grid">
        {TOUR_SIDES.map((side) => {
          const door = primaryDoor(side.doors)
          if (!door) return null
          const journey = `Closing: ${side.label}`
          const inner = (
            <>
              <span className="closing__num mono" aria-hidden="true" />
              <span className="closing__label">{side.label}</span>
              <span className="closing__line">{side.line}</span>
              <span className="closing__go mono">
                {door.label}
                <span aria-hidden="true">{'\u00a0→'}</span>
              </span>
            </>
          )
          return (
            <li key={side.id} className="closing__cell" data-closing-side={side.id}>
              {door.href.startsWith('#') ? (
                <a href={door.href} className="closing__door" data-journey={journey}>
                  {inner}
                </a>
              ) : (
                <LandingLink href={door.href} className="closing__door" prefetch={false} data-journey={journey}>
                  {inner}
                </LandingLink>
              )}
            </li>
          )
        })}
      </ul>

      <nav className="closing__quiet" aria-label="More of Pantessa">
        {CLOSING_QUIET.map((q) => (
          <LandingLink key={q.href} href={q.href} className="closing__quietlink" prefetch={false} data-journey={`Closing: ${q.label}`}>
            {q.label}
          </LandingLink>
        ))}
      </nav>
    </section>
  )
}
