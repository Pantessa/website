import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Fragment } from 'react'
import Footer from '@/components/Footer'
import CallCard from '@/components/called/CallCard'
import CallLead, { BestCall } from '@/components/called/CallLead'
import RecordChart from '@/components/called/RecordChart'
import ScanNow from '@/components/called/ScanNow'
import ShareRow from '@/components/called/ShareRow'
import ScoreBar from '@/components/sleek/ScoreBar'
import { FIXTURE_HANDLE } from '@/lib/called-it/fixture'
import { getXIdentity } from '@/lib/called-it/x-auth'
import { ADDED_MARK, SCAN_WINDOW_DAYS, VERDICT_WORDS, chartHref, recordHref, type CalledCall, type CalledRecord, type CalledSide } from '@/lib/called-it/spec'
import { CALL_PARAM, bestCallOf, callHref, leadCallOf, parseCallParam } from '@/lib/called-it/gtm'
import { callDescription, callHeadline, calledImageHref, cleanLine, fmtCount, headlineParts } from '@/lib/called-it/card-layout'
import { calledCallPost, calledPost, myCalledCallPost, myCalledPost } from '@/lib/share-posts'
import { absoluteUrl } from '@/lib/site-url'
import { loadRecordView, type RecordView } from '../../_lib/view'
import { Avatar, DoorBlock, Eyebrow, MethodBlock } from '../../_lib/parts'
import '@/components/called/called-record.css'
import '@/components/called/called-call.css'

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
// THE FIRST SCREEN ON A PHONE (squad mobile-sleek, 2026-11-24): who, ONE
// display line, the tally as one bar (components/sleek/ScoreBar) and ONE
// primary press, the live chart, docked under the thumb. Share is the quiet
// press beside it; "Plot a handle" is a quiet link. The list of calls is
// CAPPED: the calls pinned on the chart are shown (misses beside hits, by the
// same rule that pins them), and every other call is in the page behind one
// "Show all N calls" (a <details>, no script). A long post is clamped behind a
// "More" (CallCard). Nothing is dropped and no word of a post is rewritten.
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
//
// ONE CALL (squad called-gtm, lane CALL, 2026-11-16). `?call=<postId>` is the
// address of one call: the link an account is sent about the call it got
// right, and the one that unfurls when it reposts. The page then LEADS with
// that call (components/called/CallLead): the verdict, the post, the price
// that day and what it did next, and on the same first screen the record's
// whole tally and its standing line, then one button onto the live chart with
// the call open. The record follows as it always does.
//   - A call address reads the WHOLE record, whatever `side` says: one call
//     is never set beside half a tally.
//   - Any verdict has an address. The words are spec's: "called it" is said
//     only of a call whose verdict is right.
//   - An id the record does not hold is the plain record page, no error.
//   - The plain page shows the record's hit (gtm bestCallOf) as a highlight
//     that links to its address; a record with no hit shows none.
//   - Its metadata: canonical is the RECORD's address and the call address is
//     noindex (one indexed page per record); og:url is the call's own, and
//     og:image / twitter:image are the call's image.

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

async function viewOf(props: Props): Promise<{ view: RecordView; rawHandle: string; rawSymbol: string; call: CalledCall | null }> {
  const [p, q] = await Promise.all([props.params, props.searchParams])
  const rawHandle = decode(p.handle)
  const rawSymbol = decode(p.symbol)
  // One call's address: read the WHOLE record (no side) and lead with the call it holds.
  const callId = parseCallParam(q[CALL_PARAM])
  if (callId) {
    const whole = await loadRecordView(rawHandle, rawSymbol, '', first(q.pins))
    // Only a call the SCAN found on a SCANNED record leads (review F1): a pasted post's id falls back to the plain record.
    const call = whole.body.status === 'ready' ? leadCallOf(whole.body.record, callId) : null
    if (call) return { view: whole, rawHandle, rawSymbol, call }
  }
  return { view: await loadRecordView(rawHandle, rawSymbol, first(q.side), first(q.pins)), rawHandle, rawSymbol, call: null }
}

/** A record with more calls than this shows its pinned calls and folds the rest behind "Show all". */
const LIST_CAP = 8
/** A fold is drawn only when it hides at least this many. */
const SHOW_ALL_MIN = 3

const withPins = (href: string, pins: readonly string[]) => (pins.length ? `${href}${href.includes('?') ? '&' : '?'}pins=${pins.join(',')}` : href)

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { view, call } = await viewOf(props)
  const { handle, symbol, side, pins, body } = view
  if (!handle || !symbol) {
    const title = 'Called it on Pantessa'
    const description = 'Plot any X handle on a chart: every post where the account took a side, pinned to the day it was posted and judged by what the price did next.'
    return { title, description, robots: { index: false, follow: true }, openGraph: { title, description, siteName: 'Pantessa', type: 'website', images: [{ url: '/api/og/called', width: 1200, height: 630, alt: title, type: 'image/png' }] }, twitter: { card: 'summary_large_image', title, description, images: [{ url: '/api/og/called', alt: title, width: 1200, height: 630, type: 'image/png' }] } }
  }
  const ready = body.status === 'ready' ? body.record : null
  if (ready && call && handle && symbol) {
    // One call: its own title and card, in the record's own words; the whole tally and the standing line ride in the description.
    const headline = callHeadline(handle, symbol, call)
    const description = callDescription(ready, call, view.unit)
    const image = { url: calledImageHref(handle, symbol, 'all', [], call.postId), width: 1200, height: 630, alt: `${headline} ${ready.words.headline}`, type: 'image/png' }
    return {
      title: `${headline.replace(/\.$/, '')} · Called it on Pantessa`,
      description,
      // One indexed address per record: a call's address points at it and stays out of the index.
      alternates: { canonical: absoluteUrl(recordHref(handle, symbol)) },
      robots: { index: false, follow: true },
      openGraph: { title: headline, description, url: absoluteUrl(callHref(handle, symbol, call.postId)), siteName: 'Pantessa', type: 'article', images: [image] },
      twitter: { card: 'summary_large_image', title: headline, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
    }
  }
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

/** The headline: who and the market as the display line. The counts stay in the h1 to the letter (read aloud, read by a crawler) and are drawn by the score bar under it. */
function Headline({ record }: { record: CalledRecord }) {
  const parts = headlineParts(record.words.headline)
  if (!parts) {
    // No tally to draw (no calls found, or posts a viewer pasted with no scan): who and the market are the display line, the rest of the record's own sentence reads under it, to the letter.
    const cut = record.words.headline.indexOf(': ')
    if (cut < 0) return <h1 className="xrc-headline">{record.words.headline}</h1>
    return (
      <h1 className="xrc-headline">
        <span className="xrc-headline__who">
          {record.words.headline.slice(0, cut)}
          <span className="xrc-sr">: </span>
        </span>
        <span className="xrc-headline__rest">{record.words.headline.slice(cut + 2)}</span>
      </h1>
    )
  }
  // Read with the tags off, this is the headline to the letter: the colon, the commas and the full stop are in the
  // text for a reader and a crawler, and out of sight where the chips already separate the counts.
  return (
    <h1 className="xrc-headline">
      <span className="xrc-headline__who">
        {parts.who.replace(/: $/, '')}
        <span className="xrc-sr">: </span>
      </span>
      <span className="xrc-sr">
        {parts.counts.map((c, i) => (
          <Fragment key={c.kind}>
            {c.text}
            {i < parts.counts.length - 1 ? ', ' : parts.end}
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
      <div className="sk-seg">
        {tabs.map((t) => (
          <Link key={t.side} href={recordHref(record.handle, record.symbol, t.side)} className={`xrc-sides__tab${t.side === record.side ? ' is-on' : ''}`} aria-current={t.side === record.side ? 'page' : undefined} prefetch={false} data-journey={`called_side_${t.side}`}>
            {t.label} <span className="xrc-sides__n">{t.n}</span>
          </Link>
        ))}
      </div>
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
  const { view, rawHandle, rawSymbol, call } = await viewOf(props)
  const { handle, symbol, side, pins, body } = view

  // One address per record: @Name, a mixed-case symbol and friends land on the canonical spelling (a call keeps its id).
  if (handle && symbol && (rawHandle !== handle || rawSymbol !== symbol)) redirect(withPins(call ? callHref(handle, symbol, call.postId) : recordHref(handle, symbol, side), pins))

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
                    {/* The scan's own note, closed with a full stop if it has none. */}
                    {`${(body.progress || 'The scan has started').trim().replace(/[.\s]+$/, '')}.`} This page checks again every few seconds.
                  </p>
                ) : (
                  <>
                    <p className="xrc-standing">
                      A scan searches the account's public posts about {symbol}, up to {SCAN_WINDOW_DAYS} days back. A model labels each one bull or bear from its own words, and each call is pinned to the day it was posted.
                    </p>
                    {body.reason && <p className="xrc-standing">{body.reason}</p>}
                    <p className="xrc-next">
                      {canScan ? (
                        <>
                          {/* It scans HERE (and by itself when the door's press brought the visitor): no trip to the chart for a second button. */}
                          <ScanNow handle={handle} symbol={symbol} label={`Scan @${handle} on ${symbol}`} auto />
                          <Link href={live} className="xrc-next__also" prefetch={false} data-journey="called_open_chart">
                            or open the live {symbol} chart
                          </Link>
                        </>
                      ) : (
                        <Link href={live} className="xrc-btn xrc-btn--lead" prefetch={false} data-journey="called_scan_on_chart">
                          Open @{handle} on the live {symbol} chart
                        </Link>
                      )}
                    </p>
                  </>
                )}
              </header>
              <RecordChart symbol={symbol} closes={view.closes} calls={[]} unit={view.unit} emptyNote={scanning ? 'Pins land here when the scan is done' : 'No pins yet'} />
            </div>
            <aside className="xrc__side">
              {/* One primary on this page: Scan. The door's press stays quiet for the handle it is prefilled with. */}
              <DoorBlock symbol={symbol} side={side} initialHandle={scanning ? undefined : handle} heading={scanning ? 'Plot another handle' : 'Plot a handle'} owner="this" quiet />
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
  // A call's page shares THAT call (its own words, its own image); the record's page shares the record.
  const post = call ? (mine ? myCalledCallPost(record, call) : calledCallPost(record, call)) : mine ? myCalledPost(record) : calledPost(record)
  const imageHref = call ? calledImageHref(record.handle, record.symbol, 'all', [], call.postId) : calledImageHref(record.handle, record.symbol, record.side, pins)
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
  // THE CAP: a long record shows the calls pinned on the chart (and the call the page leads with); the rest wait behind one press.
  const pinnedFirst = scannedCalls.filter((c) => c.call.picked || c.call.postId === call?.postId).slice(0, LIST_CAP)
  const shownIfCapped = pinnedFirst.length > 0 ? pinnedFirst : scannedCalls.slice(-LIST_CAP)
  // A "Show all" that would reveal fewer than SHOW_ALL_MIN calls is not drawn: they are all shown instead.
  const capped = scannedCalls.length > LIST_CAP && scannedCalls.length - shownIfCapped.length >= SHOW_ALL_MIN
  const shownCalls = capped ? shownIfCapped : scannedCalls
  const restCalls = capped ? scannedCalls.filter((c) => !shownCalls.includes(c)) : []
  const scored = record.scanned && record.tally.total > 0
  // The plain page's highlight: the hit the record is shown by. Only a call the scan found, only a hit; otherwise nothing.
  const best = call ? null : bestCallOf(record.calls)
  const facts = (record.words.coverage || record.words.added || unlabeled > 0) && (
    <div className="xrc-facts">
      {record.words.coverage && <p data-coverage>{record.words.coverage}</p>}
      {record.words.added && <p data-added>{record.words.added}</p>}
      {unlabeled > 0 && (
        <p data-unlabeled={unlabeled}>
          {unlabeled} {unlabeled === 1 ? 'post' : 'posts'} still to label. <ScanNow handle={record.handle} symbol={record.symbol} label="Finish" variant="link" />
        </p>
      )}
    </div>
  )

  return (
    <>
      <main className="xrc" data-xrc="record" data-status="ready" data-side={record.side} data-calls={record.calls.length} data-scanned={record.scanned ? 'yes' : 'no'} data-verified={record.verified ? 'yes' : 'no'} data-lead={call ? 'call' : 'record'}>
        <div className="xrc__wrap">
          <div className="xrc__main">
            {call ? (
              <>
                {/* ONE CALL leads: the verdict, the post, the proof, the whole tally, the next press. */}
                <CallLead record={record} call={call} avatar={view.avatar} unit={view.unit} closes={view.closes} />
                {/* Then the record, as it always reads. */}
                <header className="xrc-head xcl-rest" id="record">
                  <Eyebrow jump>
                    <span className="xrc-eyebrow__ctx">{record.symbol}</span>
                  </Eyebrow>
                  <h2 className="xcl-rest__title">
                    Every call @{record.handle} made on {record.symbol}
                  </h2>
                  {facts}
                  {pasteOnly && (
                    <p className="xrc-next">
                      <ScanNow handle={record.handle} symbol={record.symbol} label={`Scan @${record.handle} on ${record.symbol}`} />
                    </p>
                  )}
                  {found > 0 && <Sides record={record} />}
                </header>
              </>
            ) : (
              <header className="xrc-head xrc-top">
                <Eyebrow jump>
                  <span className="xrc-eyebrow__ctx">{record.symbol}</span>
                </Eyebrow>
                <Who view={view} record={record} />
                <Headline record={record} />
                {/* The tally as one bar: every verdict the scan counted has a segment, misses beside hits. */}
                {scored && (
                  <div className="xrc-tally" data-score>
                    <p className="xrc-tally__total" aria-hidden>
                      <b>{record.tally.total}</b> {record.tally.total === 1 ? 'call' : 'calls'}
                      {record.side !== 'all' && <span> {record.side === 'bull' ? 'bullish' : 'bearish'}</span>}
                    </p>
                    <ScoreBar counts={record.tally} words={VERDICT_WORDS} size="lg" />
                  </div>
                )}
                <div className="xrc-fine">
                  <p className={`xrc-standing${record.verified ? ' is-verified' : ''}`} data-standing>
                    {record.words.standing}
                  </p>
                  {/* What was read, and what was only added: the record's own words, right under the tally. */}
                  {facts}
                </div>
                {pasteOnly && (
                  <p className="xrc-next">
                    <ScanNow handle={record.handle} symbol={record.symbol} label={`Scan @${record.handle} on ${record.symbol}`} auto />
                  </p>
                )}
                {/* ONE primary press, under the thumb on a phone: the live chart. Share is the quiet one beside it. */}
                <div className="xrc-dock" data-dock>
                  {/* With no scan behind the posts, the scan above is the primary press and this one steps back. */}
                  <Link href={live} className={`xrc-dock__go sk-btn${pasteOnly ? ' sk-btn--quiet is-quiet' : ''}`} prefetch={false} data-journey="called_open_chart_dock">
                    Open the live {record.symbol} chart <span aria-hidden>&rarr;</span>
                  </Link>
                  {record.calls.length > 0 && (
                    <a href="#share" className="xrc-dock__alt sk-btn sk-btn--quiet" data-journey="called_jump_share">
                      Share
                    </a>
                  )}
                </div>
                {found > 0 && <Sides record={record} />}
              </header>
            )}

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

            {/* The hit this record is shown by, with its own address. No hit: nothing is dressed up. */}
            {best && <BestCall record={record} call={best} unit={view.unit} />}

            {scannedCalls.length > 0 && (
              <section className="xrc-list" aria-label={`Every call the scan found: ${scannedCalls.length}`} data-list={scannedCalls.length} data-shown={shownCalls.length}>
                <h2 className="xrc-list__title">
                  {capped ? (
                    <>
                      Pinned on the chart <span>{shownCalls.length} of {scannedCalls.length} calls</span>
                    </>
                  ) : (
                    <>
                      Every call <span>{scannedCalls.length}, oldest first</span>
                    </>
                  )}
                </h2>
                <ol className="xrc-calls">
                  {shownCalls.map(({ call: c, n }) => (
                    <CallCard key={c.postId} call={c} n={n} handle={record.handle} unit={view.unit} lead={c.postId === call?.postId} />
                  ))}
                </ol>
                {restCalls.length > 0 && (
                  <details className="xrc-all" data-all={restCalls.length}>
                    <summary data-journey="called_show_all">
                      <span className="xrc-all__open">Show all {scannedCalls.length} calls</span>
                      <span className="xrc-all__shut">Hide the other {restCalls.length}</span>
                    </summary>
                    <ol className="xrc-calls">
                      {restCalls.map(({ call: c, n }) => (
                        <CallCard key={c.postId} call={c} n={n} handle={record.handle} unit={view.unit} lead={c.postId === call?.postId} />
                      ))}
                    </ol>
                  </details>
                )}
              </section>
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
                  {addedCalls.map(({ call: c, n }) => (
                    <CallCard key={c.postId} call={c} n={n} handle={record.handle} unit={view.unit} lead={c.postId === call?.postId} />
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
              <section className="xrc-share" id="share" aria-label={call ? 'Share this call' : pasteOnly ? 'Share these posts' : 'Share this record'}>
                <h2 className="xrc-share__title">{call ? (mine ? 'Share your call' : 'Share this call') : pasteOnly ? 'Share these posts' : mine ? 'Share your record' : 'Share this record'}</h2>
                {call ? (
                  <>
                    <p className="xrc-share__lede">The post and the card carry this call and the full record: {record.scanned ? 'every call the scan found, hits and misses.' : 'no scan has run, so they state no tally.'}</p>
                    {/* What unfurls on X, shown before it is posted: the same image the link's card draws. */}
                    <a href={imageHref} className="xcl-card" target="_blank" rel="noopener" data-journey="called_call_card" aria-label="The card this link unfurls as: open the image">
                      {/* eslint-disable-next-line @next/next/no-img-element -- our own image route; next/image would re-encode a picture meant to be saved as it unfurls */}
                      <img src={imageHref} width={1200} height={630} alt={`${callHeadline(record.handle, record.symbol, call)} ${record.words.headline}`} loading="lazy" decoding="async" />
                    </a>
                  </>
                ) : (
                  pasteOnly && <p className="xrc-share__lede">The post and the image say what this is: posts a viewer pinned, with no tally.</p>
                )}
                <ShareRow post={post} imageHref={imageHref} fileName={`called-it-${record.handle}-${record.symbol.replace(/[^A-Za-z0-9]/g, '')}${call ? `-${call.postId}` : ''}.png`} kind={call ? 'call' : 'record'} />
                {call && (
                  <p className="xrc-note">
                    <Link href={`${recordHref(record.handle, record.symbol)}#share`} prefetch={false} data-journey="called_call_share_record">
                      Share the whole record instead
                    </Link>
                  </p>
                )}
              </section>
            )}
            <DoorBlock symbol={record.symbol} side={record.side} owner={record.verified ? 'yourself' : 'this'} />
            <MethodBlock />
          </aside>
        </div>
      </main>
      <Footer />
      {/* Room for the docked button under the page's last line on a phone. */}
      <div className="xrc-dockpad" aria-hidden />
    </>
  )
}
