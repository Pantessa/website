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
import { SCAN_WINDOW_DAYS, chartHref, recordHref, type CalledRecord, type CalledSide } from '@/lib/called-it/spec'
import { calledImageHref, fmtCount, fmtUtcDate, headlineParts } from '@/lib/called-it/card-layout'
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
// record is read on every request rather than held in a cache. What is
// expensive is already held elsewhere: the daily candles (30s per process,
// lib/candles-server), the avatar (an hour, _lib/avatar), and the share image
// (the CDN, by its own cache headers). One request reads the record once
// (React cache), however many of metadata and page ask.
//
// Every answer is a real page: a ready record, a handle nobody has plotted
// yet, a scan in flight, and a refusal each say what is so and offer the door.

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
  const index = !!ready && ready.tally.total > 0 && pins.length === 0 && handle !== FIXTURE_HANDLE
  return {
    title,
    description,
    alternates: { canonical },
    robots: index ? undefined : { index: false, follow: true },
    openGraph: { title: headline, description, url: canonical, siteName: 'Pantessa', type: 'article', images: [image] },
    twitter: { card: 'summary_large_image', title: headline, description, images: [{ url: image.url, alt: image.alt, width: image.width, height: image.height, type: image.type }] },
  }
}

// ── The pieces of a ready record ────────────────────────────────────────

/** The headline, every count a chip in its verdict's colour. The text is spec's sentence, unchanged. */
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
  const name = record?.profile.name ?? null
  return (
    <div className="xrc-who">
      <Avatar uri={view.avatar} name={name} handle={handle} size="lg" />
      <div className="xrc-who__id">
        <span className="xrc-who__name">{name || `@${handle}`}</span>
        <span className="xrc-who__handle">
          <Link href={`/x/${handle}`} prefetch={false} data-journey="called_handle">
            @{handle}
          </Link>
          {record?.profile.followers != null && <span> · {fmtCount(record.profile.followers)} followers</span>}
        </span>
      </div>
    </div>
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
    const next = body.status === 'refused' ? body.next : []
    return (
      <>
        <main className="xrc" data-xrc="record" data-status="refused">
          <div className="xrc__wrap xrc__wrap--narrow">
            <header className="xrc-head">
              <Eyebrow />
              <h1 className="xrc-headline">{reason}</h1>
              {next.length > 0 && (
                <p className="xrc-next">
                  {next
                    .filter((n) => n.href.startsWith('/') && !n.href.startsWith('//'))
                    .map((n) => (
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
    return (
      <>
        {/* A scan in flight: the page asks again by itself, with no script. */}
        {scanning && <meta httpEquiv="refresh" content="6" />}
        <main className="xrc" data-xrc="record" data-status={body.status}>
          <div className="xrc__wrap">
            <div className="xrc__main">
              <header className="xrc-head">
                <Eyebrow>
                  <span className="xrc-eyebrow__ctx">{symbol}</span>
                </Eyebrow>
                <Who view={view} record={null} />
                <h1 className="xrc-headline">{scanning ? `Reading @${handle}'s posts about ${symbol}.` : `Nobody has plotted @${handle} on ${symbol} yet.`}</h1>
                {scanning ? (
                  <p className="xrc-standing" role="status">
                    {body.progress || 'The scan has started.'} This page checks again every few seconds.
                  </p>
                ) : (
                  <p className="xrc-standing">
                    A scan reads the account's public posts about {symbol} from the last {SCAN_WINDOW_DAYS} days, labels each one bull or bear from its own words, and pins it to the day it was posted.
                    {!body.canScan && body.reason ? ` ${body.reason}` : ''}
                  </p>
                )}
              </header>
              <RecordChart symbol={symbol} closes={view.closes} calls={[]} unit={view.unit} emptyNote={scanning ? 'Pins land here when the scan is done.' : 'No pins yet.'} action={<Link href={`/t/${encodeURIComponent(symbol)}`} prefetch={false}>Open the live chart</Link>} />
            </div>
            <aside className="xrc__side">
              <DoorBlock symbol={symbol} side={side} initialHandle={handle} heading={scanning ? 'Plot another handle' : `Plot @${handle}`} lede={scanning ? undefined : `Start here. The door reads @${handle}'s posts about ${symbol} and draws the record on this page.`} owner="this" />
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
  const me = await getXIdentity().catch(() => null)
  const mine = !!record.verified && !!me && me.handle === record.handle
  const post = mine ? myCalledPost(record) : calledPost(record)
  const imageHref = calledImageHref(record.handle, record.symbol, record.side, pins)
  const ownPins = pins.length > 0 && record.calls.some((c) => pins.includes(c.postId))
  const pinned = record.calls.filter((c) => c.picked).length

  return (
    <>
      <main className="xrc" data-xrc="record" data-status="ready" data-side={record.side} data-verified={record.verified ? 'yes' : 'no'}>
        <div className="xrc__wrap">
          <div className="xrc__main">
            <header className="xrc-head">
              <Eyebrow jump>
                <span className="xrc-eyebrow__ctx">
                  {record.symbol} · since {fmtUtcDate(record.window.from)}
                </span>
              </Eyebrow>
              <Who view={view} record={record} />
              <p className={`xrc-standing${record.verified ? ' is-verified' : ''}`} data-standing>
                {record.words.standing}
              </p>
              <Headline record={record} />
              <Sides record={record} />
            </header>

            <RecordChart symbol={record.symbol} closes={view.closes} calls={record.calls} unit={view.unit} action={<Link href={chartHref(record.handle, record.symbol, record.side)} prefetch={false} data-journey="called_open_chart_top">Live chart</Link>} />
            {ownPins && (
              <p className="xrc-note">
                These {pinned} pins were chosen by a viewer. The tally counts every call found.{' '}
                <Link href={recordHref(record.handle, record.symbol, record.side)} prefetch={false}>
                  Show the rule's pins
                </Link>
              </p>
            )}

            {record.calls.length > 0 ? (
              <ol className="xrc-calls" aria-label={`Every call, oldest first: ${record.calls.length}`}>
                {record.calls.map((c, i) => (
                  <CallCard key={c.postId} call={c} n={i + 1} handle={record.handle} unit={view.unit} />
                ))}
              </ol>
            ) : (
              <p className="xrc-note">
                {record.side === 'all'
                  ? `${record.postsRead} posts were read and none took a side on ${record.symbol} in this window.`
                  : `No ${record.side === 'bull' ? 'bullish' : 'bearish'} calls on ${record.symbol} in this window. The other side may have some.`}
              </p>
            )}

            <p className="xrc-live">
              <Link href={chartHref(record.handle, record.symbol, record.side)} className="xrc-btn xrc-btn--wide" prefetch={false} data-journey="called_open_chart">
                Open the live chart
              </Link>
            </p>
          </div>

          <aside className="xrc__side">
            <section className="xrc-share" aria-label="Share this record">
              <h2 className="xrc-share__title">{mine ? 'Share your record' : 'Share this record'}</h2>
              <ShareRow post={post} imageHref={imageHref} fileName={`called-it-${record.handle}-${record.symbol.replace(/[^A-Za-z0-9]/g, '')}.png`} />
            </section>
            <DoorBlock symbol={record.symbol} side={record.side} owner={record.verified ? 'yourself' : 'this'} />
            <MethodBlock />
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}
