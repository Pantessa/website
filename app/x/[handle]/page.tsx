import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import Footer from '@/components/Footer'
import { readRecord } from '@/lib/called-it/record'
import { STANDING_NOT_VERIFIED, normalizeHandle, recordHref, standingVerified } from '@/lib/called-it/spec'
import { headlineTally } from '@/lib/called-it/card-layout'
import { avatarDataUri } from '../_lib/avatar'
import { agoWords, readPlotted } from '../_lib/plotted'
import { Avatar, DoorBlock, Eyebrow, MethodBlock } from '../_lib/parts'
import '@/components/called/called-record.css'

// /x/<handle> — ONE ACCOUNT: every market its calls have been plotted on, one
// row each with the full tally and a link to the record (squad called-it,
// lane RECORD). The list is the public one (lib/called-it/store listPlotted
// through _lib/plotted: finished scans, internal runs never listed).
//
// DYNAMIC, ON PURPOSE: the standing line must read "Verified" the moment the
// account's owner comes back from X, and a handle is an unbounded address
// space that should not fill a page cache. Its reads are small: one list
// query, and at most eight record reads over candles that are already held.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ handle: string }> }

/** Markets offered when an account has no plots yet: the three most-argued-about charts. */
const STARTERS = ['BTC', 'ETH', 'SOL'] as const
/** Rows whose tally is read in full (a record read each); the rest print their call count. */
const TALLY_ROWS = 8
const LIST_ROWS = 24

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = normalizeHandle(decode((await params).handle))
  const title = handle ? `@${handle}'s calls, pinned on the chart · Called it on Pantessa` : 'Called it on Pantessa'
  const description = handle
    ? `Every market @${handle}'s calls have been plotted on: each post pinned to the day it was posted and judged by what the price did next.`
    : 'Plot any X handle on a chart: every post where the account took a side, pinned to the day it was posted and judged by what the price did next.'
  const image = { url: handle ? `/api/og/called?handle=${handle}` : '/api/og/called', width: 1200, height: 630, alt: title, type: 'image/png' }
  return {
    title,
    description,
    robots: { index: false, follow: true },
    openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
  }
}

export default async function HandlePage({ params }: Props) {
  const raw = decode((await params).handle)
  const handle = normalizeHandle(raw)
  if (!handle) {
    return (
      <>
        <main className="xrc" data-xrc="handle" data-status="refused">
          <div className="xrc__wrap xrc__wrap--narrow">
            <header className="xrc-head">
              <Eyebrow />
              <h1 className="xrc-headline">That is not an X handle. A handle is 1 to 15 letters, numbers or underscores.</h1>
            </header>
            <DoorBlock heading="Plot a handle" />
            <MethodBlock />
          </div>
        </main>
        <Footer />
      </>
    )
  }
  if (raw !== handle) redirect(`/x/${handle}`)

  const list = await readPlotted({ limit: LIST_ROWS, handle })
  const rows = list.rows.filter((r) => r.handle === handle)
  const top = rows[0] ?? null
  const verified = rows.some((r) => r.verified)
  const [avatar, tallies] = await Promise.all([
    avatarDataUri(top?.avatarUrl),
    Promise.all(
      rows.slice(0, TALLY_ROWS).map(async (r) => {
        try {
          const { body } = await readRecord({ handle, symbol: r.symbol })
          return body.status === 'ready' ? headlineTally(body.record.words.headline) : null
        } catch {
          return null
        }
      }),
    ),
  ])
  const now = Date.now()

  return (
    <>
      <main className="xrc" data-xrc="handle" data-status={rows.length ? 'ready' : 'empty'} data-plots={rows.length}>
        <div className="xrc__wrap">
          <div className="xrc__main">
            <header className="xrc-head">
              <Eyebrow jump />
              <div className="xrc-who">
                <Avatar uri={avatar} name={top?.name} handle={handle} size="lg" />
                <div className="xrc-who__id">
                  <span className="xrc-who__name">{top?.name || `@${handle}`}</span>
                  <span className="xrc-who__handle">@{handle}</span>
                </div>
              </div>
              {rows.length > 0 && <p className={`xrc-standing${verified ? ' is-verified' : ''}`}>{verified ? standingVerified(handle) : STANDING_NOT_VERIFIED}</p>}
              <h1 className="xrc-headline">{rows.length > 0 ? `@${handle}'s calls, market by market.` : `Nothing is plotted for @${handle} yet.`}</h1>
              {rows.length === 0 && (
                <p className="xrc-standing">{list.failed ? 'The list of plots did not load just now. The door still works: pick a market and plot this handle.' : 'Pick a market. The door reads the account’s public posts about it and pins every call to the day it was posted.'}</p>
              )}
            </header>

            {rows.length > 0 ? (
              <ul className="xrc-rows" aria-label={`Markets @${handle} is plotted on`}>
                {rows.map((r, i) => (
                  <li key={r.symbol}>
                    <Link href={recordHref(handle, r.symbol)} className="xrc-row" prefetch={false} data-journey="called_row">
                      <span className="xrc-row__sym">{r.symbol}</span>
                      <span className="xrc-row__tally">{tallies[i] ?? `${r.calls} ${r.calls === 1 ? 'call' : 'calls'}.`}</span>
                      <span className="xrc-row__when">scanned {agoWords(r.scannedAt, now)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="xrc-starters" aria-label="Pick a market">
                {STARTERS.map((s) => (
                  <Link key={s} href={recordHref(handle, s)} className="xrc-btn" prefetch={false} data-journey="called_starter">
                    @{handle} on {s}
                  </Link>
                ))}
              </p>
            )}
          </div>
          <aside className="xrc__side">
            <DoorBlock initialHandle={rows.length ? undefined : handle} heading={rows.length ? 'Plot anyone' : `Plot @${handle}`} owner="this" />
            <MethodBlock />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}
