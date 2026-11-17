import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import Footer from '@/components/Footer'
import { readBoard } from '@/lib/called-it/board'
import { takenDown } from '@/lib/called-it/record'
import { getHandle } from '@/lib/called-it/store'
import { getXIdentity } from '@/lib/called-it/x-auth'
import { LIST_MIN_FOLLOWERS, STANDING_NOT_VERIFIED, chartHref, normalizeHandle, recordHref, standingVerified } from '@/lib/called-it/spec'
import { cleanLine, fmtCount } from '@/lib/called-it/card-layout'
import { absoluteUrl } from '@/lib/site-url'
import { avatarDataUri } from '../_lib/avatar'
import { agoWords, readPlotted } from '../_lib/plotted'
import { Avatar, DoorBlock, Eyebrow, MethodBlock } from '../_lib/parts'
import { OwnerBlock, PlotDoor, ProfileCalls, ProfileMarkets, ProfileShare, ProfileSum } from '../_lib/profile'
import { bestCallsOf, missCallsOf, profileIndexable, profileLine, profilePost } from '../_lib/profile-rules'
import '@/components/called/called-record.css'
import '@/components/called/called-profile.css'

// /x/<handle> — ONE ACCOUNT (squad called-it, lane RECORD; rebuilt by squad
// called-gtm, lane PROFILE, 2026-11-16). The page an account's owner opens
// when somebody tells them "you called this one", and the page a follower
// opens to see how the account's calls went.
//
// In reading order: who (name, handle, followers, the standing line), ONE
// line across every market the account is scanned on (the sum of the
// records' own tallies), one press onto the live chart, the calls that carry
// the record (each market's best hit, and its strongest miss the same size),
// a tile per market (its price line with a dot per call, its tally, what the
// scan read), and at the foot what the owner can do: verify it, earn from
// it, have it taken down. Share and the door stand beside it from a desk.
//
// Everything is read through lib/called-it/board readBoard (the PUBLIC list's
// rows, each summarized from its own record and held five minutes). A row
// the list has but whose record did not summarize is still offered, as a
// plain row onto the chart.
//
// DYNAMIC, ON PURPOSE: the standing line must read "Verified" the moment the
// account's owner comes back from X, the share text turns to the first
// person for that owner alone, and a handle is an unbounded address space
// that should not fill a page cache. Its reads are small: the list (twice,
// one of them inside readBoard), and the board's entries from their cache.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ handle: string }> }

/** Markets offered when an account has nothing listed yet: the three most-argued-about charts. */
const STARTERS = ['BTC', 'ETH', 'SOL'] as const
const LIST_ROWS = 24

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The handle's own row, once per request (null when it cannot be read). */
const loadRow = cache(async (handle: string) => getHandle(handle).catch(() => null))

/** One read per request, however many of the metadata and the page ask. */
const loadAccount = cache(async (handle: string) => {
  const [board, list] = await Promise.all([readBoard({ handle, limit: LIST_ROWS }), readPlotted({ limit: LIST_ROWS, handle })])
  const entries = board.entries.filter((e) => e.handle === handle)
  // Listed, but its record did not summarize just now: still a way onto the chart.
  const rest = list.rows.filter((r) => r.handle === handle && !entries.some((e) => e.symbol === r.symbol))
  return { entries, rest, failed: board.failed || list.failed }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = normalizeHandle(decode((await params).handle))
  if (!handle) {
    const title = 'Called it on Pantessa'
    const description = 'Plot any X handle on a chart: every post where the account took a side, pinned to the day it was posted and judged by what the price did next.'
    return { title, description, robots: { index: false, follow: true }, openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [{ url: '/api/og/called', width: 1200, height: 630, alt: title, type: 'image/png' }] }, twitter: { card: 'summary_large_image', title, description, images: [{ url: '/api/og/called', alt: title, width: 1200, height: 630, type: 'image/png' }] } }
  }
  // A taken-down or protected handle (review F3): a page with no handle in its title, out of the index.
  if (takenDown(handle, await loadRow(handle))) {
    const title = 'Called it on Pantessa'
    const description = 'This record is not shown.'
    return { title, description, robots: { index: false, follow: false }, openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [{ url: '/api/og/called', width: 1200, height: 630, alt: title, type: 'image/png' }] }, twitter: { card: 'summary_large_image', title, description, images: [{ url: '/api/og/called', alt: title, width: 1200, height: 630, type: 'image/png' }] } }
  }
  const { entries } = await loadAccount(handle)
  const line = profileLine(handle, entries)
  const verified = entries.some((e) => e.verified)
  // The title and the card's headline are the summed line itself; the standing line leads the description.
  const headline = line || `@${handle}'s calls, pinned on the chart.`
  const title = `${headline.replace(/\.$/, '')} · Called it on Pantessa`
  const description = line
    ? `${verified ? standingVerified(handle) : STANDING_NOT_VERIFIED} Every market @${handle} is scanned on: each call pinned to the day it was posted and judged by what the price did next.`
    : `Every market @${handle}'s calls have been plotted on: each post pinned to the day it was posted and judged by what the price did next.`
  const image = { url: `/api/og/called?handle=${handle}`, width: 1200, height: 630, alt: headline, type: 'image/png' }
  const canonical = absoluteUrl(`/x/${handle}`)
  return {
    title,
    description,
    alternates: { canonical },
    // Indexed only when the page says something: a call judged either way, and never the fixture.
    robots: profileIndexable(handle, entries) ? undefined : { index: false, follow: true },
    openGraph: { title: headline, description, url: canonical, siteName: 'Pantessa', type: 'profile', images: [image] },
    twitter: { card: 'summary_large_image', title: headline, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
  }
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />
    </svg>
  )
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

  // Taken down by an admin, or protected (review F3): the record page's refusal shell. No rows, no "Plot @h",
  // no door prefilled with the handle, no owner block (verifying never lists a hidden handle).
  const down = takenDown(handle, await loadRow(handle))
  if (down) {
    const next = down.next.filter((n) => n.href.startsWith('/') && !n.href.startsWith('//') && n.href !== '/x')
    return (
      <>
        <main className="xrc" data-xrc="handle" data-status="refused">
          <div className="xrc__wrap xrc__wrap--narrow">
            <header className="xrc-head">
              <Eyebrow />
              <h1 className="xrc-headline">{down.reason}</h1>
              {next.length > 0 && (
                <p className="xrc-next">
                  {next.map((n) => (
                    <Link key={n.href + n.label} href={n.href} className="xrc-btn" prefetch={false}>
                      {n.label}
                    </Link>
                  ))}
                </p>
              )}
            </header>
            <DoorBlock heading="Plot a handle" />
            <MethodBlock />
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const { entries, rest, failed } = await loadAccount(handle)
  const top = entries[0] ?? rest[0] ?? null
  const plots = entries.length + rest.length
  const verified = entries.some((e) => e.verified) || rest.some((r) => r.verified)
  const [avatar, me, row] = await Promise.all([avatarDataUri(top?.avatarUrl), verified ? getXIdentity().catch(() => null) : null, verified ? loadRow(handle) : null])
  // "This viewer is the owner": the account is verified AND X's user id on the cookie is the account's own. Never the cookie's name.
  const mine = verified && !!me && !!row?.xUserId && me.xUserId === row.xUserId
  const now = Date.now()
  // X gave no display name (or nothing is listed yet): the handle is the name, printed once.
  const named = !!top?.name?.trim() && top.name.trim().toLowerCase() !== handle
  const followers = entries[0]?.followers != null ? `${fmtCount(entries[0].followers)} followers` : null
  const line = profileLine(handle, entries)
  const standing = verified ? standingVerified(handle) : STANDING_NOT_VERIFIED
  const lead = entries[0] ?? null

  return (
    <>
      <main className="xrc xpf" data-xrc="handle" data-status={plots ? 'ready' : 'empty'} data-plots={plots} data-verified={verified ? 'yes' : 'no'}>
        <div className="xrc__wrap">
          <div className="xrc__main xpf-main">
            <header className="xpf-head">
              <Eyebrow jump share={entries.length > 0} />
              <div className="xpf-id">
                <span className="xpf-id__face">
                  <Avatar uri={avatar} name={top?.name} handle={handle} size="lg" />
                </span>
                <div className="xpf-id__text">
                  <h1 className="xpf-id__name">{named ? <bdi>{cleanLine(top?.name ?? '', 60)}</bdi> : `@${handle}`}</h1>
                  {(named || followers) && (
                    <p className="xpf-id__meta">
                      {named && <span>@{handle}</span>}
                      {followers && <span>{followers}</span>}
                    </p>
                  )}
                </div>
                <a href={`https://x.com/${handle}`} className="xpf-id__x" target="_blank" rel="noopener noreferrer" aria-label={`@${handle} on X`} title={`@${handle} on X`} data-journey="called_profile_x">
                  <XGlyph />
                </a>
              </div>

              {plots > 0 ? (
                <p className={`xpf-standing${verified ? ' is-verified' : ''}`} data-standing>
                  {verified ? standingVerified(handle) : STANDING_NOT_VERIFIED}
                </p>
              ) : (
                <>
                  <p className="xpf-empty__title">No market is listed for @{handle} yet.</p>
                  <p className="xpf-empty__lede">
                    {failed
                      ? 'The list of plots did not load just now. The door still works: pick a market and plot this handle.'
                      : 'Pick a market. The door reads the account’s public posts about it and pins every call to the day it was posted.'}
                  </p>
                  <p className="xpf-empty__lede">
                    A market is listed here once a scan has found calls on it, for an account with {fmtCount(LIST_MIN_FOLLOWERS)} followers or more, or one its owner has verified.
                  </p>
                </>
              )}

              {entries.length > 0 && <ProfileSum line={line} entries={entries} />}

              {lead && (
                <p className="xpf-acts">
                  <Link href={chartHref(handle, lead.symbol)} className="xpf-btn xpf-btn--lead xpf-btn--wide" prefetch={false} data-journey="called_profile_chart_top">
                    Open the {lead.symbol} chart with these calls
                  </Link>
                </p>
              )}
            </header>

            {entries.length > 0 && <ProfileCalls handle={handle} best={bestCallsOf(entries)} misses={missCallsOf(entries)} />}
            {entries.length > 0 && <ProfileMarkets entries={entries} now={now} />}

            {rest.length > 0 && (
              <section className="xpf-sec" aria-label={`More markets @${handle} is plotted on`} data-xpf="rest">
                {entries.length > 0 && <h2 className="xpf-sec__title">Also plotted</h2>}
                <ul className="xrc-rows">
                  {rest.map((r) => (
                    <li key={r.symbol}>
                      <Link href={chartHref(handle, r.symbol)} className="xrc-row" prefetch={false} data-journey="called_row">
                        <span className="xrc-row__sym">{r.symbol}</span>
                        <span className="xrc-row__tally">Open the chart for its tally.</span>
                        <span className="xrc-row__when">scanned {agoWords(r.scannedAt, now)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plots === 0 && (
              <ul className="xpf-starters" aria-label="Pick a market">
                {STARTERS.map((s) => (
                  <li key={s}>
                    <Link href={recordHref(handle, s)} className="xpf-starter" prefetch={false} data-journey="called_starter">
                      <span className="xpf-starter__sym">{s}</span>
                      <span className="xpf-starter__say">Plot @{handle} on {s}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <OwnerBlock handle={handle} symbol={lead?.symbol} verified={verified} listed={plots > 0} />
          </div>

          <aside className="xrc__side xpf-side">
            {entries.length > 0 && <ProfileShare handle={handle} post={profilePost({ handle, line, markets: entries.length, standing, mine })} mine={mine} />}
            <PlotDoor heading={plots ? 'Plot anyone' : `Plot @${handle}`} initialHandle={plots ? undefined : handle} initialMarket={top?.symbol} />
            <div className="xpf-aside">
              <MethodBlock />
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}
