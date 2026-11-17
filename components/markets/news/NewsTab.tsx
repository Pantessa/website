'use client'

// News for the symbol, set as a FRONT PAGE (2026-11-17): a nameplate and a
// dateline, the newest story as the lead with its picture, two seconds beside
// it, an "in brief" column, a picture grid, then the archive in newspaper
// columns. The data is /api/news exactly as before; lib/news-front deals the
// feed into the page's seats in the feed's own order (newest first), so the
// page claims no ranking the feed did not make.
//
// Every story is one click target: the headline's link is stretched over its
// block, and "Show on chart" (a marker published to lib/chart-markers for the
// chart to draw on the bar the story broke on) sits above it.
//
// A story's picture is the feed's own (Cointelegraph ships one per item),
// right-sized through next/image. A LEAD with no picture gets the PLATE: the
// symbol's own tape around the hour it ran, the story marked on it; any other
// story with no picture is set in type alone. Beside a recent story, what the
// price did since: one hourly and one daily candle read
// for the whole tab, fail-soft (no tape, no number, the page still reads).
//
// Every string here renders as a text node: titles and summaries were
// HTML-stripped server-side and are never re-interpreted as markup.

import { notAnswering, shownError } from '@/lib/fetch-words'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowRight, ArrowUpRight, Pin, PinOff, RefreshCw } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import type { ChartPair } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import { ageLabel, NEWS_FEED_LABELS, type NewsItem, type NewsResponse } from '@/lib/news-shared'
import { toggleChartMarker, useChartMarkers } from '@/lib/chart-markers'
import {
  archiveDate,
  editionDate,
  frontPage,
  nameplate,
  plateFor,
  platePath,
  sinceLabel,
  sinceMove,
  plateDir,
  type Bar,
  type Plate,
} from '@/lib/news-front'
import type { PublicPost } from '@/lib/chart-posts'
import '../comm.css'
import './news.css'

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

type Seat = 'lead' | 'second' | 'brief' | 'feature' | 'archive'

/** The tape the "since" numbers and the plates read. */
interface Tape {
  hourly: Bar[]
  daily: Bar[]
  last: number | null
  /** Both reads have settled (answered or failed). */
  ready: boolean
}
const NO_BARS: Bar[] = []
const NO_TAPE: Tape = { hourly: [], daily: [], last: null, ready: false }

/** What next/image should ask for in each seat (the grid's own widths). */
const SIZES: Record<Seat, string> = {
  lead: '(min-width: 1600px) 760px, (min-width: 900px) 56vw, 100vw',
  second: '(min-width: 900px) 380px, 120px',
  brief: '(min-width: 900px) 300px, 45vw',
  feature: '(min-width: 600px) 360px, 120px',
  archive: '64px',
}

const fmtPrice = (n: number, money: boolean) => {
  const body = n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4)
  return money ? `$${body}` : body
}

export default function NewsTab({ symbol, pair, onShowChart }: { symbol: string; pair: ChartPair; onShowChart?: () => void }) {
  const sym = pair.symbol || symbol
  const [news, setNews] = useState<NewsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tape, setTape] = useState<Tape>(NO_TAPE)
  // The dateline is the reader's own day: set after mount, never on the server.
  const [today, setToday] = useState<string | null>(null)
  const markers = useChartMarkers(sym)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}&limit=30`, { cache: 'no-store' })
      const d = (await r.json().catch(() => ({}))) as NewsResponse & { error?: string }
      if (!r.ok) throw new Error(d.error ?? notAnswering('The news feed'))
      setNews(d)
    } catch (e) {
      setErr(shownError(e, 'The news feed'))
    } finally {
      setLoading(false)
    }
  }, [sym])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setToday(editionDate(new Date()))
  }, [])

  // One hourly and one daily read for the whole page. A miss leaves the
  // numbers off; it never blocks a headline.
  useEffect(() => {
    let live = true
    setTape(NO_TAPE)
    const read = async (tf: '1h' | '1d') => {
      try {
        const r = await fetch(`/api/charts/candles?symbol=${encodeURIComponent(sym)}&tf=${tf}`, { cache: 'no-store' })
        if (!r.ok) return { bars: [] as Bar[], last: null as number | null }
        const d = (await r.json()) as { candles?: Bar[]; last?: number | null }
        const bars = (d.candles ?? []).filter((b) => Number.isFinite(b.t) && Number.isFinite(b.o) && Number.isFinite(b.c)).map((b) => ({ t: b.t, o: b.o, c: b.c }))
        return { bars, last: typeof d.last === 'number' && d.last > 0 ? d.last : null }
      } catch {
        return { bars: [] as Bar[], last: null as number | null }
      }
    }
    void Promise.all([read('1h'), read('1d')]).then(([h, d]) => {
      if (!live) return
      const last = h.last ?? d.last ?? h.bars.at(-1)?.c ?? d.bars.at(-1)?.c ?? null
      setTape({ hourly: h.bars, daily: d.bars, last, ready: true })
    })
    return () => {
      live = false
    }
  }, [sym])

  const feedLabel = news && news.feed !== 'none' ? NEWS_FEED_LABELS[news.feed] : null
  const page = useMemo(() => frontPage(news?.items ?? []), [news])
  const onIds = useMemo(() => new Set(markers.map((m) => m.id)), [markers])
  const money = pair.source !== 'index'
  const count = news?.items.length ?? 0
  const cols = page.seconds.length === 0 ? 1 : page.briefs.length === 0 ? 2 : 3

  const story = (item: NewsItem, seat: Seat) => (
    <Story key={item.id} item={item} seat={seat} symbol={sym} on={onIds.has(item.id)} tape={tape} money={money} />
  )

  return (
    <div className="gaz" data-news="front-page">
      <header className="gaz__mast">
        <p className="gaz__dateline">{today ?? ' '}</p>
        <h2 className="gaz__name">{nameplate(symbolName(sym))}</h2>
        <div className="gaz__ed">
          <span className="gaz__via">
            {feedLabel ? `Via ${feedLabel}` : `${sym} headlines`}
            {news?.asOf ? ` · as of ${ageLabel(news.asOf)}` : ''}
          </span>
          <button type="button" className="gaz__refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh headlines">
            <RefreshCw className={loading ? 'gaz__spin' : undefined} aria-hidden /> Refresh
          </button>
        </div>
      </header>

      <div className="gaz__strip">
        <span>
          {count > 0 ? `${count} ${count === 1 ? 'story' : 'stories'} · newest first` : loading ? 'Reading the wires' : `${sym} headlines`}
          {feedLabel && <span className="gaz__stripvia"> · via {feedLabel}</span>}
        </span>
        {markers.length > 0 && (
          <span className="gaz__marks" aria-live="polite">
            {markers.length} on the chart
            {onShowChart && (
              <button type="button" className="gaz__tochart" onClick={onShowChart}>
                See the chart <ArrowRight aria-hidden />
              </button>
            )}
          </span>
        )}
      </div>

      {err && <p className="mkc__err">{err}</p>}
      {!news && loading && !err && <FrontSkeleton />}
      {!err && news && news.items.length === 0 && (
        <div className="mkc__empty">No headlines for {sym} in the last two weeks from any feed we read. The tape still trades — try the community tab.</div>
      )}

      {page.lead && (
        <section className="gaz__front" data-cols={cols} aria-label={`${sym} headlines`}>
          <div className="gaz__leadcol">{story(page.lead, 'lead')}</div>
          {page.seconds.length > 0 && <div className="gaz__seconds">{page.seconds.map((it) => story(it, 'second'))}</div>}
          {page.briefs.length > 0 && (
            <div className="gaz__briefs">
              <h3 className="gaz__label">
                <span>In brief</span>
              </h3>
              <div className="gaz__brieflist">{page.briefs.map((it) => story(it, 'brief'))}</div>
            </div>
          )}
        </section>
      )}

      {page.features.length > 0 && (
        <section className="gaz__sec" aria-label="More headlines">
          <h3 className="gaz__label">
            <span>More headlines</span>
          </h3>
          <div className="gaz__grid">{page.features.map((it) => story(it, 'feature'))}</div>
        </section>
      )}

      {page.archive.length > 0 && (
        <section className="gaz__sec" aria-label="Earlier headlines">
          <h3 className="gaz__label">
            <span>Earlier</span>
          </h3>
          <div className="gaz__archive">{page.archive.map((it) => story(it, 'archive'))}</div>
        </section>
      )}

      <PinnedLinks symbol={sym} />
    </div>
  )
}

// ── one story, in any seat ──────────────────────────────────────────────────

function Story({ item, seat, symbol, on, tape, money }: { item: NewsItem; seat: Seat; symbol: string; on: boolean; tape: Tape; money: boolean }) {
  const [broken, setBroken] = useState(false)
  const photo = item.imageUrl && !broken ? item.imageUrl : null
  // "Since" reads the HOURLY tape only (about a week of a coin, two of a stock)
  // and never the archive: past that the number restates the trend, not the story.
  const since = useMemo(
    () => (tape.ready && seat !== 'archive' ? sinceMove(item.publishedAt, tape.last, tape.hourly, NO_BARS) : null),
    [tape, seat, item.publishedAt],
  )
  // The plate stands in for the LEAD's picture only: stories cluster in time,
  // so a plate on every seat is the same chart a dozen times. Elsewhere a
  // story with no picture is set in type alone.
  const plate = useMemo(
    () => (seat === 'lead' && !photo && tape.ready ? plateFor(item.publishedAt, tape.hourly, tape.daily) : null),
    [seat, photo, tape, item.publishedAt],
  )
  const Hed = seat === 'lead' ? 'h3' : 'h4'
  const when = seat === 'archive' ? archiveDate(item.publishedAt) : ageLabel(item.publishedAt)
  const figure = photo ? (
    <div className="gaz__fig">
      <Image className="gaz__img" src={photo} alt="" fill sizes={SIZES[seat]} loading={seat === 'lead' ? 'eager' : 'lazy'} onError={() => setBroken(true)} />
    </div>
  ) : plate ? (
    <div className="gaz__fig gaz__fig--plate">
      <PlateFigure plate={plate} symbol={symbol} />
    </div>
  ) : null

  return (
    <article className={`gaz__story gaz__story--${seat}${on ? ' is-on' : ''}${figure ? ' has-fig' : ''}`}>
      {figure}
      <div className="gaz__text">
        <p className="gaz__kicker">
          <span className="gaz__src">{item.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>{when}</time>
        </p>
        <Hed className="gaz__hed">
          <a className="gaz__link" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
            {item.title}
            <ArrowUpRight className="gaz__out" aria-hidden />
          </a>
        </Hed>
        {item.summary && <p className="gaz__deck">{item.summary}</p>}
        <div className="gaz__foot">
          {since && (
            <span
              className={`gaz__since is-${since.dir}`}
              title={`${symbol} is ${since.dir === 'flat' ? 'flat' : `${since.dir} ${sinceLabel(since).slice(1)}`} since this story ran (from ${fmtPrice(since.from, money)})`}
            >
              <b>
                {symbol} {sinceLabel(since)}
              </b>{' '}
              since
            </span>
          )}
          <button
            type="button"
            className={on ? 'gaz__pin is-on' : 'gaz__pin'}
            aria-pressed={on}
            aria-label={on ? 'On chart: remove this headline from the chart' : 'Show on chart'}
            onClick={() => toggleChartMarker(symbol, { id: item.id, t: item.publishedAt, label: `${item.source}: ${item.title}`, url: item.url })}
            title={on ? 'Remove from the chart' : 'Pin this headline to the bar it broke on'}
          >
            {on ? <PinOff aria-hidden /> : <Pin aria-hidden />}
            <span className="gaz__pinlabel">{on ? 'On chart' : 'Show on chart'}</span>
          </button>
        </div>
      </div>
    </article>
  )
}

/** The tape around a story, the story marked on it. */
function PlateFigure({ plate, symbol }: { plate: Plate; symbol: string }) {
  const W = 320
  const H = 120
  const p = useMemo(() => platePath(plate, W, H, 14), [plate])
  // The line after the story is coloured by what IT drew (story to the end of
  // the window), so a rising line is never painted as a fall.
  const dir = plateDir(plate)
  return (
    <div className={`gaz__plate is-${dir}`} role="img" aria-label={`${symbol} price around this story`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <path className="gaz__platearea" d={p.area} />
        <path className="gaz__plateline" d={p.line} vectorEffect="non-scaling-stroke" />
        <path className="gaz__platetail" d={p.tail} vectorEffect="non-scaling-stroke" />
        <line className="gaz__platemark" x1={p.x} x2={p.x} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="gaz__platedot" style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }} aria-hidden />
      <span className="gaz__platecap" aria-hidden>
        {symbol} · {plate.grain === 'hour' ? 'the hours around this story' : 'the days around this story'}
      </span>
    </div>
  )
}

function FrontSkeleton() {
  return (
    <div className="gaz__front gaz__skel" data-cols={3} aria-hidden>
      <div className="gaz__leadcol">
        <div className="gaz__bone gaz__bone--fig" />
        <div className="gaz__bone gaz__bone--hed" />
        <div className="gaz__bone gaz__bone--hed" style={{ width: '62%' }} />
        <div className="gaz__bone gaz__bone--line" />
      </div>
      <div className="gaz__seconds">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="gaz__bone gaz__bone--fig" />
            <div className="gaz__bone gaz__bone--line" style={{ width: '88%' }} />
            <div className="gaz__bone gaz__bone--line" style={{ width: '54%' }} />
          </div>
        ))}
      </div>
      <div className="gaz__briefs">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="gaz__bonebrief">
            <div className="gaz__bone gaz__bone--line" style={{ width: '40%' }} />
            <div className="gaz__bone gaz__bone--line" />
            <div className="gaz__bone gaz__bone--line" style={{ width: '70%' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Links the community pinned to this symbol — kind 'link' posts. */
function PinnedLinks({ symbol }: { symbol: string }) {
  const session = useSession()
  const pathname = usePathname()
  const search = useSearchParams()
  const [posts, setPosts] = useState<PublicPost[]>([])
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const here = useMemo(() => `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`, [pathname, search])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/posts?symbol=${encodeURIComponent(symbol)}&kind=link&limit=20`, { cache: 'no-store' })
      const d = (await r.json()) as { posts?: PublicPost[] }
      setPosts(d.posts ?? [])
    } catch {
      /* the list is optional */
    }
  }, [symbol])

  useEffect(() => {
    void load()
  }, [load])

  const pin = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol, kind: 'link', linkUrl: url.trim(), title: title.trim() }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(d.error ?? notAnswering('The board'))
      setUrl('')
      setTitle('')
      setMsg('Pinned.')
      await load()
    } catch (e) {
      setMsg(shownError(e, 'The board'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="gaz__sec gaz__community" aria-label="Community-pinned links">
      <h3 className="gaz__label">
        <span>Pinned by the community</span>
      </h3>
      {posts.length === 0 && <p className="mkc__note">Nothing pinned to {symbol} yet. Paste an https link below — the page&rsquo;s own title rides along.</p>}
      {posts.length > 0 && (
        <div className="gaz__archive">
          {posts.map((p) => (
            <article key={p.id} className="gaz__story gaz__story--archive">
              <div className="gaz__text">
                <p className="gaz__kicker">
                  <span className="gaz__src">{p.linkUrl ? hostOf(p.linkUrl) : 'link'}</span>
                  <span aria-hidden>·</span>
                  <span className="mkp__author">pinned by {p.authorLabel}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={new Date(p.createdAt * 1000).toISOString()}>{ageLabel(p.createdAt)}</time>
                </p>
                {p.linkUrl && (
                  <h4 className="gaz__hed">
                    <a className="gaz__link" href={p.linkUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
                      {p.title}
                      <ArrowUpRight className="gaz__out" aria-hidden />
                    </a>
                  </h4>
                )}
                {p.body && <p className="gaz__deck">{p.body}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
      {session.address ? (
        <form
          className="mkn__pinform"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && url.trim()) void pin()
          }}
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (public https page)" inputMode="url" aria-label="Link to pin" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional — read from the page)" maxLength={120} aria-label="Pinned link title" style={{ flexBasis: 200 }} />
          <button type="submit" className="mkc__cta" disabled={busy || !url.trim()}>
            {busy ? 'Pinning…' : 'Pin link'}
          </button>
          {msg && <span className={msg === 'Pinned.' ? 'mkc__note' : 'mkc__err'}>{msg}</span>}
        </form>
      ) : (
        <div className="mkp__door">
          <span>Pin a link to {symbol} — one free signature, no account form.</span>
          {/* Rule 6: the unified sign-in door, redirect back to this tab. */}
          <CreateAccountButton className="mkc__cta" label="Sign in to pin" redirectTo={here} />
        </div>
      )}
    </section>
  )
}
