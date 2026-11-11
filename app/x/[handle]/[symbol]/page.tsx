import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Fragment } from 'react'
import Footer from '@/components/Footer'
import CallCard from '@/components/called/CallCard'
import RecordChart from '@/components/called/RecordChart'
import ShareRow from '@/components/called/ShareRow'
import { FIXTURE_HANDLE } from '@/lib/called-it/fixture'
import { getXIdentity } from '@/lib/called-it/x-auth'
import { ADDED_MARK, SCAN_WINDOW_DAYS, chartHref, recordHref, type CalledRecord, type CalledSide } from '@/lib/called-it/spec'
import { calledImageHref, cleanLine, fmtCount, headlineParts } from '@/lib/called-it/card-layout'
import { calledPost, myCalledPost } from '@/lib/share-posts'
import { absoluteUrl } from '@/lib/site-url'
import { loadRecordView, type RecordView } from '../../_lib/view'
import { Avatar, DoorBlock, Eyebrow, MethodBlock } from '../../_lib/parts'
import '@/components/called/called-record.css'

// /x/<handle>/<SYMBOL>[?side=bull|bear][&pins=id,id] — ONE RECORD: an X
// handle's calls on one market, each pinned to the day it was posted and
// judged by what the price did next (squad called-it, lane RECORD).
//
// This is the page a stranger lands on from X, on a phone: who, the full
// tally, the chart, then the posts as cards, and one next move (plot
// somebody else, or plot yourself). It is server-rendered from
// lib/called-it/record readRecord (the function the API answers with, never a
// fetch of our own API) and loads no chart library.
//
// DYNAMIC, ON PURPOSE. The address carries the toggle and a viewer's own pins
// in its query, so the page reads searchParams; and the standing line must
// flip to "Verified" the moment the account's owner comes back from X, so the
// record is read on every request rather than held in a cache (readRecord
// also schedules its own after-the-answer work, which a cache would swallow).
// What is expensive is already held elsewhere: the daily candles (30s per
// process, lib/candles-server), the avatar (an hour, _lib/avatar), and the
// share image (the CDN, by its own cache headers). One request reads the
// record once (React cache), however many of metadata and page ask.
//
// Every answer is a real page: a ready record, a scanned account with no
// calls, posts a viewer pasted with no scan behind them, a handle nobody has
// plotted yet, a scan in flight, and a refusal each say what is so and offer
// somewhere to go.
//
// WHAT IS COUNTED (squad review R1, R8). The tally is what the SCAN found, in
// the record's own headline. A post a viewer pasted is shown in its own group
// under the scanned calls, wears spec's mark, and is never counted; a record
// with no scan has no tally at all (no chips, no score) and offers the scan.
// What the scans read is the record's own coverage line, printed under the
// tally. The chart's window is only the chart's: nothing here says "since".

export const runtime = 'nodejs'

type Search = Record<string, string | string[] | undefined>
type Props = { params: Promise<{ handle: string; symbol: string }>; searchParams: Promise<Search> }

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function viewOf(props: Props): Promise<{ view: RecordView; rawHandle: string; rawSymbol: string }> {
  const [p, q] = await Promise.all([props.params, props.searchParams])
  const rawHandle = decode(p.handle)
  const rawSymbol = decode(p.symbol)
  return { view: await loadRecordView(rawHandle, rawSymbol, first(q.side), first(q.pins)), rawHandle, rawSymbol }
}

const withPins = (href: string, pins: readonly string[]) => (pins.length ? `${href}${href.includes('?') ? '&' : '?'}pins=${pins.join(',')}` : href)

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { view } = await viewOf(props)
  const { handle, symbol, side, pins, body } = view
  if (!handle || !symbol) {
    const title = 'Called it on Pantessa'
    const description = 'Plot any X handle on a chart: every post where the account took a side, pinned to the day it was posted and judged by what the price did next.'
    return { title, description, robots: { index: false, follow: true }, openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [{ url: '/api/og/called', width: 1200, height: 630, alt: title, type: 'image/png' }] }, twitter: { card: 'summary_large_image', title, description, images: [{ url: '/api/og/called', alt: title, width: 1200, height: 630, type: 'image/png' }] } }
  }
  const ready = body.status === 'ready' ? body.record : null
  const headline = ready ? ready.words.headline : `@${handle} on ${symbol}: not plotted yet.`
  const title = `${headline.replace(/\.$/, '')} · Called it on Pantessa`
  const description = ready ? `${ready.words.standing} ${ready.words.method}` : `Plot @${handle} on ${symbol}: every post where the account took a side, pinned to the day it was posted and judged by what the price did next.`
  const image = { url: calledImageHref(handle, symbol, side, pins), width: 1200, height: 630, alt: headline, type: 'image/png' }
  // One address per record: the toggle is part of it, a viewer's own pins are not.
  const canonical = absoluteUrl(recordHref(handle, symbol, side))
  const index = !!ready && ready.scanned && ready.tally.total > 0 && pins.length === 0 && handle !== FIXTURE_HANDLE
  return {
    title,
    description,
    alternates: { canonical },
    robots: index ? undefined : { index: false, follow: true },
    openGraph: { title: headline, description, url: canonical, siteName: 'Pantessa', type: 'article', images: [image] },
    twitter: { card: 'summary_large_image', title: headline, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
  }
}

// ── The pieces of a record ──────────────────────────────────────────────

/** The headline, every count a chip in its verdict's colour. */
function Headline({ record }: { record: CalledRecord }) {
  const parts = headlineParts(record.words.headline)
  if (!parts) return <h1 className="xrc-headline">{record.words.headline}</h1>
  // Read with the tags off, this is the headline to the letter: the colon, the commas and the full stop are in the
  // text for a reader and a crawler, and out of sight where the chips already separate the counts.
  return (
    <h1 className="xrc-headline">
      <span className="xrc-headline__who">
        {parts.who.replace(/: $/, '')}
        <span className="xrc-sr">: </span>
      </span>
      <span className="xrc-headline__counts">
        {parts.counts.map((c, i) => (
          <Fragment key={c.kind}>
            <span className={`xrc-count is-${c.kind}`}>{c.text}</span>
            <span className="xrc-sr">{i < parts.counts.length - 1 ? ', ' : parts.end}</span>
          </Fragment>
        ))}
      </span>
    </h1>
  )
}

function Sides({ record }: { record: CalledRecord }) {
  const all = record.bySide.bull.total + record.bySide.bear.total
  const tabs: { side: CalledSide; label: string; n: number }[] = [
    { side: 'all', label: 'All', n: all },
    { side: 'bull', label: 'Bull', n: record.bySide.bull.total },
    { side: 'bear', label: 'Bear', n: record.bySide.bear.total },
  ]
  return (
    <nav className="xrc-sides" aria-label="Which calls">
      {tabs.map((t) => (
        <Link key={t.side} href={recordHref(record.handle, record.symbol, t.side)} className={`xrc-sides__tab${t.side === record.side ? ' is-on' : ''}`} aria-current={t.side === record.side ? 'page' : undefined} prefetch={false} data-journey={`called_side_${t.side}`}>
          {t.label} <span className="xrc-sides__n">{t.n}</span>
        </Link>
      ))}
    </nav>
  )
}

function Who({ view, record }: { view: RecordView; record: CalledRecord | null }) {
  const handle = view.handle ?? ''
  // A display name is X's text: cleaned of control and override characters, and isolated (<bdi>) where it is printed.
  const name = record?.profile.name ? cleanLine(record.profile.name, 60) || null : null
  // X gave no display name (or we have only the handle): the handle is the name.
  const named = !!name && name.toLowerCase() !== handle && name.toLowerCase() !== `@${handle}`
  const followers = record?.profile.followers != null ? `${fmtCount(record.profile.followers)} followers` : null
  // The whole block is one link to the account's page: a target a thumb can hit.
  return (
    <Link href={`/x/${handle}`} className="xrc-who" prefetch={false} data-journey="called_handle" aria-label={`@${handle}: every market plotted`}>
      <Avatar uri={view.avatar} name={name} handle={handle} size="lg" />
      <span className="xrc-who__id">
        <span className="xrc-who__name">{named ? <bdi>{name}</bdi> : `@${handle}`}</span>
        {(named || followers) && <span className="xrc-who__handle">{[named ? `@${handle}` : null, followers].filter(Boolean).join(' · ')}</span>}
      </span>
    </Link>
  )
}

export default async function RecordPage(props: Props) {
  const { view, rawHandle, rawSymbol } = await viewOf(props)
  const { handle, symbol, side, pins, body } = view

  // One address per record: @Name, a mixed-case symbol and friends land on the canonical spelling.
  if (handle && symbol && (rawHandle !== handle || rawSymbol !== symbol)) redirect(withPins(recordHref(handle, symbol, side), pins))

  // ── Not a handle, or not a market: the refusal, and the door ──
  if (!handle || !symbol || body.status === 'refused') {
    const reason = body.status === 'refused' ? body.reason : 'That address does not name a handle and a market.'
    // Somewhere to go, on this site only; the door itself is on this page, so a link to it is left out.
    const next = (body.status === 'refused' ? body.next : []).filter((n) => n.href.startsWith('/') && !n.href.startsWith('//') && n.href !== '/x')
    return (
      <>
        <main className="xrc" data-xrc="record" data-status="refused">
          <div className="xrc__wrap xrc__wrap--narrow">
            <header className="xrc-head">
              <Eyebrow />
              <h1 className="xrc-headline">{reason}</h1>
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
            <DoorBlock symbol={symbol ?? undefined} initialHandle={handle ?? undefined} heading="Plot a handle" />
            <MethodBlock />
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // ── Nobody has plotted this handle here yet, or a scan is reading it now ──
  if (body.status !== 'ready') {
    const scanning = body.status === 'scanning'
    const canScan = body.status === 'unscanned' && body.canScan
    const live = chartHref(handle, symbol, side)
    return (
      <>
        {/* A scan in flight: the page asks again by itself, with no script. */}
        {scanning && <meta httpEquiv="refresh" content="6" />}
        <main className="xrc" data-xrc="record" data-status={body.status}>
          <div className="xrc__wrap">
            <div className="xrc__main">
              <header className="xrc-head">
                <Eyebrow jump>
                  <span className="xrc-eyebrow__ctx">{symbol}</span>
                </Eyebrow>
                <Who view={view} record={null} />
                <h1 className="xrc-headline">{scanning ? `Reading @${handle}'s posts about ${symbol}.` : `Nobody has plotted @${handle} on ${symbol} yet.`}</h1>
                {scanning ? (
                  <p className="xrc-standing" role="status">
                    {body.progress || 'The scan has started.'} This page checks again every few seconds.
                  </p>
                ) : (
                  <>
                    <p className="xrc-standing">
                      A scan searches the account's public posts about {symbol}, up to {SCAN_WINDOW_DAYS} days back. A model labels each one bull or bear from its own words, and each call is pinned to the day it was posted.
                    </p>
                    {body.reason && <p className="xrc-standing">{body.reason}</p>}
                    <p className="xrc-next">
                      <Link href={live} className="xrc-btn xrc-btn--lead" prefetch={false} data-journey="called_scan_on_chart">
                        {canScan ? `Scan @${handle} on the live ${symbol} chart` : `Open @${handle} on the live ${symbol} chart`}
                      </Link>
                    </p>
                  </>
                )}
              </header>
              <RecordChart symbol={symbol} closes={view.closes} calls={[]} unit={view.unit} emptyNote={scanning ? 'Pins land here when the scan is done' : 'No pins yet'} />
            </div>
            <aside className="xrc__side">
              <DoorBlock symbol={symbol} side={side} initialHandle={scanning ? undefined : handle} heading={scanning ? 'Plot another handle' : 'Plot a handle'} owner="this" />
              <MethodBlock />
            </aside>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // ── The record ──
  const record = body.record
  const unlabeled = body.unlabeled ?? 0
  const me = await getXIdentity().catch(() => null)
  // "This viewer is the owner": the record is verified AND X's user id on the cookie is the record's own. Never the cookie's handle.
  const mine = !!record.verified && !!me && !!record.profile.xUserId && me.xUserId === record.profile.xUserId
  const post = mine ? myCalledPost(record) : calledPost(record)
  const imageHref = calledImageHref(record.handle, record.symbol, record.side, pins)
  const live = chartHref(record.handle, record.symbol, record.side)
  const ownPins = pins.length > 0 && record.calls.some((c) => pins.includes(c.postId))
  const pinned = record.calls.filter((c) => c.picked).length
  /** What the scans found, both sides (the toggle's numbers). Pasted posts are not in it. */
  const found = record.bySide.bull.total + record.bySide.bear.total
  // Numbers follow the record's own order (by date), so a flag on the chart and its card always agree.
  const numbered = record.calls.map((call, i) => ({ call, n: i + 1 }))
  const scannedCalls = numbered.filter((c) => c.call.origin === 'scan')
  const addedCalls = numbered.filter((c) => c.call.origin === 'added')
  const pasteOnly = !record.scanned

  return (
    <>
      <main className="xrc" data-xrc="record" data-status="ready" data-side={record.side} data-calls={record.calls.length} data-scanned={record.scanned ? 'yes' : 'no'} data-verified={record.verified ? 'yes' : 'no'}>
        <div className="xrc__wrap">
          <div className="xrc__main">
            <header className="xrc-head">
              <Eyebrow jump share={record.calls.length > 0}>
                <span className="xrc-eyebrow__ctx">{record.symbol}</span>
              </Eyebrow>
              <Who view={view} record={record} />
              <p className={`xrc-standing${record.verified ? ' is-verified' : ''}`} data-standing>
                {record.words.standing}
              </p>
              <Headline record={record} />
              {/* What was read, and what was only added: the record's own words, right under the tally. */}
              {(record.words.coverage || record.words.added || unlabeled > 0) && (
                <div className="xrc-facts">
                  {record.words.coverage && <p data-coverage>{record.words.coverage}</p>}
                  {record.words.added && <p data-added>{record.words.added}</p>}
                  {unlabeled > 0 && (
                    <p data-unlabeled={unlabeled}>
                      {unlabeled} {unlabeled === 1 ? 'post' : 'posts'} still to label.{' '}
                      <Link href={live} prefetch={false} data-journey="called_finish_on_chart">
                        Finish on the live chart
                      </Link>
                    </p>
                  )}
                </div>
              )}
              {pasteOnly && (
                <p className="xrc-next">
                  <Link href={live} className="xrc-btn xrc-btn--lead" prefetch={false} data-journey="called_scan_on_chart">
                    Scan @{record.handle} on the live {record.symbol} chart
                  </Link>
                </p>
              )}
              {found > 0 && <Sides record={record} />}
            </header>

            <RecordChart
              symbol={record.symbol}
              closes={view.closes}
              calls={record.calls}
              unit={view.unit}
              readFrom={view.readFrom}
              emptyNote="No calls found in this window"
              action={
                <Link href={live} prefetch={false} data-journey="called_open_chart_top">
                  Live chart
                </Link>
              }
            />
            {ownPins && (
              <p className="xrc-note">
                These {pinned} pins were chosen by a viewer. The tally counts every call the scan found.{' '}
                <Link href={recordHref(record.handle, record.symbol, record.side)} prefetch={false}>
                  Show the rule's pins
                </Link>
              </p>
            )}

            {scannedCalls.length > 0 && (
              <ol className="xrc-calls" aria-label={`Every call the scan found, oldest first: ${scannedCalls.length}`}>
                {scannedCalls.map(({ call, n }) => (
                  <CallCard key={call.postId} call={call} n={n} handle={record.handle} unit={view.unit} />
                ))}
              </ol>
            )}
            {record.scanned && scannedCalls.length === 0 && (
              <div className="xrc-none" data-empty={found === 0 ? 'record' : 'side'}>
                <p>
                  {found > 0
                    ? `No ${record.side === 'bull' ? 'bullish' : 'bearish'} calls on ${record.symbol} in what the scan read. The other side has ${found}.`
                    : record.postsRead > 0
                      ? `The scan read ${record.postsRead} ${record.postsRead === 1 ? 'post' : 'posts'} about ${record.symbol}. None took a side.`
                      : `The scan found no posts by @${record.handle} about ${record.symbol}.`}
                </p>
                <p>{found > 0 ? 'The toggle above shows them.' : 'Know of one? Paste its link on the live chart. It is shown here, marked as added, and not counted.'}</p>
              </div>
            )}

            {/* Posts viewers pasted: their own group, under what the scan found, marked, never counted. */}
            {addedCalls.length > 0 && (
              <section className="xrc-addedgroup" aria-label={`Posts ${ADDED_MARK}: ${addedCalls.length}`} data-added-group={addedCalls.length}>
                <h2 className="xrc-addedgroup__title">
                  {addedCalls.length === 1 ? 'A post' : 'Posts'} {ADDED_MARK}
                </h2>
                <p className="xrc-addedgroup__lede">{record.words.added ?? `Somebody picked ${addedCalls.length === 1 ? 'this post' : 'these posts'} by hand. No scan has run, so nothing here is a tally.`}</p>
                <ol className="xrc-calls">
                  {addedCalls.map(({ call, n }) => (
                    <CallCard key={call.postId} call={call} n={n} handle={record.handle} unit={view.unit} />
                  ))}
                </ol>
              </section>
            )}

            <p className="xrc-live">
              <Link href={live} className="xrc-btn xrc-btn--wide" prefetch={false} data-journey="called_open_chart">
                Open the live chart
              </Link>
            </p>
          </div>

          <aside className="xrc__side">
            {record.calls.length > 0 && (
              <section className="xrc-share" id="share" aria-label={pasteOnly ? 'Share these posts' : 'Share this record'}>
                <h2 className="xrc-share__title">{pasteOnly ? 'Share these posts' : mine ? 'Share your record' : 'Share this record'}</h2>
                {pasteOnly && <p className="xrc-share__lede">The post and the image say what this is: posts a viewer pinned, with no tally.</p>}
                <ShareRow post={post} imageHref={imageHref} fileName={`called-it-${record.handle}-${record.symbol.replace(/[^A-Za-z0-9]/g, '')}.png`} />
              </section>
            )}
            <DoorBlock symbol={record.symbol} side={record.side} owner={record.verified ? 'yourself' : 'this'} />
            <MethodBlock />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}
