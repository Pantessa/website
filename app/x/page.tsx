import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import { recordHref } from '@/lib/called-it/spec'
import { avatarDataUri } from './_lib/avatar'
import { agoWords, readPlotted } from './_lib/plotted'
import { Avatar, DoorBlock, Eyebrow, MethodBlock, Schematic } from './_lib/parts'
import '@/components/called/called-record.css'

// /x — THE DOOR (squad called-it, lane RECORD): "Whose calls?", plot
// yourself, and the handles other people plotted lately.
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

const LIST_ROWS = 18
/** Avatars are fetched together under one two-second ceiling; rows past this wear an initial. */
const AVATAR_ROWS = 12

export default async function CalledDoorPage() {
  const list = await readPlotted({ limit: LIST_ROWS })
  const avatars = await Promise.all(list.rows.map((r, i) => (i < AVATAR_ROWS ? avatarDataUri(r.avatarUrl) : Promise.resolve(null))))
  const now = Date.now()
  return (
    <>
      <main className="xrc" data-xrc="door" data-plots={list.rows.length}>
        <div className="xrc__wrap xrc__wrap--door">
          <div className="xrc__main">
            <header className="xrc-head">
              <Eyebrow />
            </header>
            <DoorBlock level={1} heading="Whose calls?" lede="Type an X handle. Every post where the account took a side on a market is pinned to the day it was posted, and judged by what the price did next." />
            <Schematic />
          </div>
          <aside className="xrc__side">
            <section className="xrc-recent" aria-label="Recently plotted">
              <h2 className="xrc-recent__title">Recently plotted</h2>
              {list.rows.length > 0 ? (
                <ul className="xrc-rows">
                  {list.rows.map((r, i) => (
                    <li key={`${r.handle}:${r.symbol}`}>
                      <Link href={recordHref(r.handle, r.symbol)} className="xrc-row xrc-row--who" prefetch={false} data-journey="called_recent">
                        <Avatar uri={avatars[i]} name={r.name} handle={r.handle} size="sm" />
                        <span className="xrc-row__sym">
                          @{r.handle} <span className="xrc-row__on">on {r.symbol}</span>
                        </span>
                        <span className="xrc-row__tally">
                          {r.calls} {r.calls === 1 ? 'call' : 'calls'}
                          {r.verified ? ' · Verified' : ''}
                        </span>
                        <span className="xrc-row__when">{agoWords(r.scannedAt, now)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="xrc-recent__none">{list.failed ? 'The list did not load just now. The door still works: type a handle.' : 'Nobody has plotted a handle here yet. Plot one and it is the first on this list.'}</p>
              )}
            </section>
            <MethodBlock />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}
