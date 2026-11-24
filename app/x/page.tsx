import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import HandleDoor from '@/components/called/HandleDoor'
import VerifyWithX from '@/components/called/VerifyWithX'
import { JUDGE_DAYS, SCAN_WINDOW_DAYS } from '@/lib/called-it/spec'
import { avatarDataUri } from './_lib/avatar'
import { featuredOf, readSummaries } from './_lib/featured'
import { readPlotted } from './_lib/plotted'
import { Eyebrow, MethodBlock, Schematic } from './_lib/parts'
import { Featured, Tile } from './_lib/splash'
import '@/components/called/called-record.css'

// /x — THE SPLASH (2026-11-12; it was lane RECORD's plain door). A hero that
// asks the question and shows a REAL record beside the door, then the
// accounts already scanned as tiles a visitor can open at once (no scan, no
// cost), then how a call is judged.
//
// FLAT (2026-11-16, Nate: "flat no drop shadows, clean elegant modern,
// minimalist"): no card, no shadow, no gradient, no backdrop. The page is a
// ruled sheet: hairlines and type, the door is one line to write on, and the
// scanned accounts sit in a ruled grid. The styles are the `.xrc--splash`
// block of called-record.css.
//
// CACHED, ON PURPOSE (a minute): the page is the same for everybody. It reads
// no query and no cookie; the door and "Verify with X" are client pieces that
// find out who is here by themselves. The list is the public one
// (lib/called-it/store listPlotted through _lib/plotted: finished scans with
// at least one call, internal runs never listed). When the store does not
// answer, the page still renders, with the door, and says the list did not
// load.

export const runtime = 'nodejs'
export const revalidate = 60

const TITLE = 'Called it: an X handle’s market calls, pinned on the chart · Pantessa'
const DESCRIPTION = 'Type an X handle. Every post where the account took a side on a market is pinned to the day it was posted and judged by what the price did next. Plot anyone, or sign in with X and plot yourself, verified.'
const IMAGE = { url: '/api/og/called', width: 1200, height: 630, alt: 'Called it on Pantessa: an X handle’s market calls, pinned on the chart.', type: 'image/png' }

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/x' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/x', siteName: 'Pantessa', type: 'website', images: [IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [{ url: IMAGE.url, alt: IMAGE.alt, width: IMAGE.width, height: IMAGE.height, type: IMAGE.type }] },
}

const LIST_ROWS = 12
/** A phone shows this many scanned accounts before "Show all" (a desk shows six: the sheet's rule). */
const TILES_SHOWN = 4

export default async function CalledDoorPage() {
  const list = await readPlotted({ limit: LIST_ROWS })
  const summaries = await readSummaries(list.rows)
  const avatars = await Promise.all(summaries.map((s) => avatarDataUri(s.avatarUrl)))
  const featured = featuredOf(summaries)
  const featuredAvatar = featured ? avatars[summaries.indexOf(featured)] : null
  const now = Date.now()
  return (
    <>
      <main className="xrc xrc--splash" data-xrc="door" data-plots={summaries.length}>
        <section className="xrc-hero">
          <div className="xrc-hero__in">
            <div className="xrc-hero__say">
              <Eyebrow />
              <h1 className="xrc-hero__title sk-display">See who actually called it.</h1>
              <p className="xrc-hero__lede">
                Type any X handle. Pantessa reads a year of their posts, pins every market call to the day it was posted, and checks it against the price {JUDGE_DAYS} days later.
              </p>
              <div className="xrc-hero__door" id="plot">
                <HandleDoor variant="page" className="xcc-door--flat" />
              </div>
              <div className="xrc-hero__you">
                <span>Is it your account? Your own record says Verified.</span>
                <VerifyWithX className="xva-flat" />
              </div>
            </div>
            <div className="xrc-hero__show">{featured ? <Featured summary={featured} avatar={featuredAvatar} /> : <Schematic />}</div>
          </div>
        </section>

        <section className="xrc-gallery" aria-label="Recently scanned">
          <div className="xrc-gallery__head">
            <h2 className="xrc-gallery__title">Recently scanned</h2>
            <p className="xrc-gallery__sub">Already read and judged. Open one: no scan, no wait.</p>
            {summaries.length > 0 && <span className="xrc-gallery__n">{String(summaries.length).padStart(2, '0')}</span>}
          </div>
          {summaries.length > 0 ? (
            <>
              {/* The list is capped: the first few are shown, the rest are in the page behind one press (a checkbox and its label, no script). */}
              {summaries.length > TILES_SHOWN && <input type="checkbox" id="xrc-all-tiles" className="xrc-tiles__toggle" aria-label={`Show all ${summaries.length} scanned accounts`} data-journey="called_door_show_all" />}
              <ul className="xrc-tiles">
                {summaries.map((s, i) => (
                  <li key={`${s.handle}:${s.symbol}`}>
                    <Tile summary={s} avatar={avatars[i]} now={now} />
                  </li>
                ))}
              </ul>
              {summaries.length > TILES_SHOWN && (
                <label htmlFor="xrc-all-tiles" className="xrc-tiles__more" aria-hidden>
                  <span className="xrc-tiles__more-open">Show all {summaries.length}</span>
                  <span className="xrc-tiles__more-shut">Show fewer</span>
                </label>
              )}
            </>
          ) : (
            <p className="xrc-recent__none">{list.failed ? 'The list did not load just now. The door still works: type a handle.' : 'Nobody has scanned an account here yet. Plot one and it is the first on this list.'}</p>
          )}
        </section>

        <section className="xrc-how" aria-label="How it works">
          <div className="xrc-gallery__head">
            <h2 className="xrc-gallery__title">How it works</h2>
          </div>
          <ol className="xrc-steps">
            <li>
              <h3>Type a handle</h3>
              <p>Any public X account, on any market Pantessa charts. A record somebody already scanned opens at once.</p>
            </li>
            <li>
              <h3>A year of posts is read</h3>
              <p>Up to {SCAN_WINDOW_DAYS} days back, only the posts that name the market. A post counts as a call when it says where the price goes or tells people what to do.</p>
            </li>
            <li>
              <h3>Every call is judged the same way</h3>
              <p>The close on the day it was posted against the close {JUDGE_DAYS} days later. Hits and misses are both on the chart, and every call is counted.</p>
            </li>
          </ol>
          <MethodBlock />
        </section>
      </main>
      <Footer />
    </>
  )
}
