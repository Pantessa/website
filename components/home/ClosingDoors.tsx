// THE CLOSING DOORS — the last thing on the landing before the footer
// (squad landing, 2026-11-10; lane CLOSE owns this file and closing.css).
// Whoever read this far gets the ways in once more, plainly: the three main
// doors, then the quieter ones (the public numbers, the docs, the story).
//
// CONTRACT STUB: one line and three doors. The lane builds the real band.
// Every link is a SpineLink (standing rule 6): a public page is a plain
// link, a signed-in page opens the unified door aimed at itself. No
// `redirectTo` on a working page.

import SpineLink from '@/components/SpineLink'
import { TOUR_ANCHOR, type TourSnapshot } from '@/lib/home-tour'
import './closing.css'

export default function ClosingDoors({ data: _data }: { data?: TourSnapshot }) {
  return (
    <section className="closing" aria-labelledby="closing-title" data-closing>
      <h2 id="closing-title" className="closing__title">
        Pick a way in.
      </h2>
      <div className="closing__doors">
        <SpineLink href="/t/AAPL" className="closing__door closing__door--primary" prefetch={false} data-journey="Closing: open a chart">
          Open a chart
        </SpineLink>
        <SpineLink href="/chat" className="closing__door" prefetch={false} data-journey="Closing: ask anything">
          Ask anything
        </SpineLink>
        <SpineLink href="/chat?tab=links" className="closing__door" prefetch={false} data-journey="Closing: mint a link">
          Mint a link
        </SpineLink>
        <a href={`#${TOUR_ANCHOR}`} className="closing__door closing__door--quiet" data-journey="Closing: back to the tour">
          See everything again
        </a>
      </div>
    </section>
  )
}
