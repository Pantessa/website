import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import HandleDoor from '@/components/called/HandleDoor'
import VerifyWithX from '@/components/called/VerifyWithX'
import { JUDGE_DAYS, SCAN_WINDOW_DAYS } from '@/lib/called-it/spec'
import { avatarDataUri } from './_lib/avatar'
import { featuredOf, readSummaries } from './_lib/featured'
import { readPlotted } from './_lib/plotted'
import { Eyebrow, MethodBlock, Schematic } from './_lib/parts'
import { CutBands, Featured, Tile } from './_lib/splash'
import '@/components/called/called-record.css'

// /x — THE SPLASH (2026-11-12; it was lane RECORD's plain door). A hero that
// asks the question and shows a REAL record beside the door, then the
// accounts already scanned as tiles a visitor can open at once (no scan, no
// cost), then how a call is judged.
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
          <CutBands />
          <div className="xrc-hero__in">
            <div className="xrc-hero__say">
              <Eyebrow />
              <h1 className="xrc-hero__title">
                Who actually <em>called it?</em>
              </h1>
              <p className="xrc-hero__lede">
                Type any X handle. Pantessa reads a year of their posts, pins every market call to the day it was posted, and checks it against the price {JUDGE_DAYS} days later.
              </p>
              <div className="xrc-hero__door" id="plot">
                <HandleDoor variant="page" />
              </div>
              <ul className="xrc-hero__facts">
                <li>Their own words, read from X</li>
                <li>Judged by the chart, not by us</li>
                <li>One link to share</li>
              </ul>
              <div className="xrc-hero__you">
                <span>Is it your account? Your own record says Verified.</span>
                <VerifyWithX />
              </div>
            </div>
            <div className="xrc-hero__show">{featured ? <Featured summary={featured} avatar={featuredAvatar} /> : <Schematic />}</div>
          </div>
        </section>

        <section className="xrc-gallery" aria-label="Recently scanned">
          <div className="xrc-gallery__head">
            <h2 className="xrc-gallery__title">Recently scanned</h2>
            <p className="xrc-gallery__sub">Already read and judged. Open one: no scan, no wait.</p>
          </div>
          {summaries.length > 0 ? (
            <ul className="xrc-tiles">
              {summaries.map((s, i) => (
                <li key={`${s.handle}:${s.symbol}`}>
                  <Tile summary={s} avatar={avatars[i]} now={now} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="xrc-recent__none">{list.failed ? 'The list did not load just now. The door still works: type a handle.' : 'Nobody has scanned an account here yet. Plot one and it is the first on this list.'}</p>
          )}
        </section>

        <section className="xrc-how" aria-label="How it works">
          <h2 className="xrc-gallery__title">How it works</h2>
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
