'use client'

// THE READ — the home's lead (2026-11-09; rules in lib/read, pinned).
//
// The market as one sentence, every clause a button; the macro line under
// it (nine tiles, the 10-year yield and the dollar among them); the chart of
// whatever is picked; and, beside the chart, what can be done about it here.
// It replaced the live deck on `/` (the deck's channels live on /live): the
// home opens no stream — the tiles re-read one cached route every 30s while
// the tab is in view, and nothing here fires a turn.
//
// The server renders the whole first frame from the snapshot `/` read (the
// headline, the tiles, the chart's paths — lib/read readChart draws in a
// stretched viewBox, so nothing is measured), so a crawler reads the line
// and a visitor sees the chart before any script runs. What only a browser
// knows (the local clock words, the hover readout, a longer range) lands
// after mount.
//
// Acting: a market the app can build orders on wears its own chips (bitcoin,
// ether); a market it cannot (an index, a Hyperliquid market the order layer
// does not build yet) names the nearest thing listed here and offers THAT
// sentence — "Buy $25 of SPY" — gated by the measured venue verdicts
// (lib/trade-venue-gate), through the connect-to-act door into the ask
// door's sheet on this page. Every link out of the card is a SpineLink (the
// app's own door: a plain link for a public page such as /t/<symbol>).

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import SpineLink from '@/components/SpineLink'
import ShareActions from '@/components/ShareActions'
import { readPost } from '@/lib/share-posts'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { chartPairFor, isChartOnlyPair } from '@/lib/charts'
import { fmtCountdown, sessionStripFor } from '@/lib/markets'
import { quickActs } from '@/lib/symbol-venues'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useTradable } from '@/lib/use-tradable'
import {
  READ_DEFAULT_ID,
  READ_DEFAULT_RANGE,
  READ_INSTRUMENTS,
  READ_RANGES,
  READ_REFRESH_MS,
  READ_SOURCES_LINE,
  READ_WAITING,
  fmtReadChange,
  fmtReadPct,
  fmtReadValue,
  fmtReadValueFull,
  readBasisWords,
  readChart,
  readHeadline,
  readHeadlineText,
  readInstrument,
  readNoActLine,
  readOwnPair,
  readPageHref,
  readPointAt,
  readSeriesChange,
  readSpark,
  readTileTag,
  readTone,
  readVenueLine,
  type ReadId,
  type ReadPoint,
  type ReadRange,
  type ReadSnapshot,
} from '@/lib/read'
import './read.css'

interface ReadActChip {
  label: string
  ask: string
  tone: 'buy' | 'sell' | 'neutral'
}

/** A point's time as the readout prints it: the clock for a day, the date past it. */
function fmtPointTime(t: number, range: ReadRange): string {
  const d = new Date(t * 1000)
  if (range === '1d') return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  if (range === '6m') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function TheRead({ initial }: { initial: ReadSnapshot }) {
  const [snap, setSnap] = useState<ReadSnapshot>(initial)
  const clauses = useMemo(() => readHeadline(snap), [snap])
  // The first frame opens on the headline's first market (stocks, when quoted).
  const [sel, setSel] = useState<ReadId>(() => readHeadline(initial)[0]?.id ?? READ_DEFAULT_ID)
  const [range, setRange] = useState<ReadRange>(READ_DEFAULT_RANGE)
  const [series, setSeries] = useState<Record<string, ReadPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  // Clock words are the browser's: null on the server and the first paint.
  const [now, setNow] = useState<Date | null>(null)
  const gradId = useId()
  const tilesRef = useRef<HTMLDivElement>(null)
  const tradable = useTradable()

  // ── The clock + the refresh (only while the tab is in view) ──
  useEffect(() => {
    setNow(new Date())
    let stopped = false
    const pull = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/markets/read', { cache: 'no-store' })
        if (!res.ok) return
        const next = (await res.json()) as ReadSnapshot
        if (!stopped && next && next.asOf && Object.keys(next.quotes ?? {}).length > 0) setSnap((prev) => (next.asOf >= prev.asOf ? next : prev))
      } catch {
        /* the tiles keep the last read */
      }
    }
    // A snapshot the server could not fill, or one a cache held for a while, is re-read at once.
    if (Object.keys(initial.quotes).length === 0 || Date.now() - initial.asOf > READ_REFRESH_MS) void pull()
    const id = setInterval(() => {
      setNow(new Date())
      void pull()
    }, READ_REFRESH_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void pull()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [initial])

  // ── A longer range: one cached read per market + range ──
  const inst = readInstrument(sel)
  const q = snap.quotes[sel]
  const seriesKey = `${sel}:${range}`
  useEffect(() => {
    if (range === '1d' || series[seriesKey]) return
    let alive = true
    setLoading(true)
    fetch(`/api/markets/read?id=${sel}&range=${range}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { points?: ReadPoint[] }) : null))
      .then((body) => {
        if (alive && body?.points && body.points.length >= 2) setSeries((prev) => ({ ...prev, [seriesKey]: body.points as ReadPoint[] }))
      })
      .catch(() => {
        /* the chart says the range did not answer */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [sel, range, seriesKey, series])

  const points: readonly ReadPoint[] = range === '1d' ? (q?.points ?? []) : (series[seriesKey] ?? [])
  const base = range === '1d' ? (q?.prev ?? null) : (points[0]?.[1] ?? null)
  const chart = useMemo(() => readChart(points, base), [points, base])
  const change = range === '1d' ? (q?.chg ?? null) : readSeriesChange(inst, points)
  const tone = readTone(change, inst.unit)
  const at = hover != null && hover < points.length ? points[hover] : null

  const pick = useCallback((id: ReadId) => {
    setSel(id)
    setHover(null)
  }, [])
  // The picked tile stays in view on a phone's scrolling row (never the page).
  useEffect(() => {
    const el = tilesRef.current?.querySelector<HTMLElement>(`[data-read-tile="${sel}"]`)
    const row = tilesRef.current
    if (!el || !row || row.scrollWidth <= row.clientWidth) return
    const left = el.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' })
  }, [sel])
  const onTilesKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = READ_INSTRUMENTS.findIndex((x) => x.id === sel)
    const next = READ_INSTRUMENTS[(i + (e.key === 'ArrowRight' ? 1 : READ_INSTRUMENTS.length - 1)) % READ_INSTRUMENTS.length]
    e.preventDefault()
    pick(next.id)
    tilesRef.current?.querySelector<HTMLElement>(`[data-read-tile="${next.id}"]`)?.focus()
  }

  const onPlotMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    setHover(readPointAt(points, (e.clientX - rect.left) / rect.width))
  }

  // ── What can be done about it here ──
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })
  // The server's own quote for the pick: the venue lists it right now.
  const hasQuote = !!snap.quotes[inst.id]
  const { chips, charts } = useMemo(() => {
    const outChips: ReadActChip[] = []
    const outCharts: { symbol: string; as: string }[] = []
    // Its OWN market first when orders build on it (a coin, or a builder-dex perp the order layer builds on —
    // the S&P 500, gold and oil), then the nearest listed thing: one chip each, and a door to its chart.
    const targets = inst.direct ? [{ symbol: inst.symbol, as: '' }, ...inst.near] : inst.near
    for (const n of targets) {
      const own = inst.direct && n.symbol === inst.symbol
      // A Hyperliquid builder-dex instrument states its own market (lib/read readOwnPair): the browser on `/` holds no
      // live perp table, so chartPairFor would know `SP500` on the server and not here — and the chips the server
      // rendered would vanish at hydration. It is offered only while the server holds a live quote for it.
      const stated = own ? readOwnPair(inst) : null
      const pair = stated ? (hasQuote ? stated : null) : chartPairFor(n.symbol)
      // A builder-dex perp the order layer does not build on (lib/charts isChartOnlyPair) is a chart to open; one it
      // does build on (`xyz:SP500`, `xyz:GOLD`, `xyz:CL` — the macro line) wears its own Long / Short.
      const acts = pair && !isChartOnlyPair(pair) ? quickActs(n.symbol, pair).filter((a) => canTradeAsk(a.ask, tradable)) : []
      if (acts.length === 0) {
        if (!own) outCharts.push(n)
        continue
      }
      for (const a of own ? acts : acts.slice(0, 1)) outChips.push({ label: own ? a.label : `${a.label} of ${n.symbol}`, ask: a.ask, tone: a.tone })
      if (!own) outCharts.push(n)
    }
    return { chips: outChips, charts: outCharts }
  }, [inst, tradable, hasQuote])
  const page = readPageHref(inst)

  const session = now ? sessionStripFor(now) : null
  const headline = readHeadlineText(clauses)
  const have = Object.keys(snap.quotes).length > 0

  return (
    <section className="read" data-read data-sel={sel} data-range={range} data-tone={tone} data-quotes={Object.keys(snap.quotes).length} aria-label="The read: the market in a sentence">
      <header className="read__eyebrow mono">
        <span className="read__kicker">The read</span>
        <span className="read__date" suppressHydrationWarning>
          {now ? now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
        </span>
        <span className="read__session" data-nyse={session ? (session.nyse.open ? 'open' : 'closed') : undefined} suppressHydrationWarning>
          {session && (
            <>
              <i className={`mk-dot ${session.nyse.open ? 'mk-dot--open' : 'mk-dot--closed'}`} aria-hidden />
              {session.nyse.label} · {session.nyse.bell === 'closes' ? 'closes in' : 'opens in'} {fmtCountdown(session.nyse.minsToBell)}
            </>
          )}
        </span>
        <span className="read__always">
          <i className="mk-dot mk-dot--always" aria-hidden />
          tokens and perps here trade 24/7
        </span>
        {/* The line is a post: today's read, as composed, with the link (the app's own share door). */}
        {clauses.length > 0 && <ShareActions post={readPost(headline)} variant="pill" label="Post the read" surface="read" className="read__share" />}
      </header>

      {/* The line. One h2 a crawler and a screen reader read whole; each clause is a button onto its chart. */}
      <h2 className="read__line" aria-label={headline}>
        {clauses.length === 0 ? (
          <span className="read__waiting">{READ_WAITING}…</span>
        ) : (
          clauses.map((c, i) => (
            <Fragment key={c.id}>
              {/* The space lives BETWEEN the units, in the heading's own flow: that is where a line may break. */}
              {i > 0 && ' '}
              <span className="read__clausewrap">
                <button type="button" className={`read__clause is-${c.tone}${c.id === sel ? ' is-on' : ''}`} aria-pressed={c.id === sel} onClick={() => pick(c.id)} data-read-clause={c.id} data-journey={`Read: ${readInstrument(c.id).label}`}>
                  <span className="read__subject">{c.subject}</span> <span className="read__verb">{c.verb}</span>
                  {c.amount && <span className="read__amount"> {c.amount}</span>}
                </button>
                <span aria-hidden>{i < clauses.length - 1 ? ',' : '.'}</span>
              </span>
            </Fragment>
          ))
        )}
      </h2>

      {snap.movers.length > 0 && (
        <p className="read__movers">
          <span className="read__moverslab mono">Biggest stock moves here</span>
          {snap.movers.map((m) => (
            <SpineLink key={m.symbol} href={`/t/${m.symbol}`} className={`read__mover mono is-${m.chgPct > 0 ? 'up' : 'down'}`} prefetch={false} data-journey={`Read mover ${m.symbol}`}>
              <b>{m.symbol}</b> {fmtReadPct(m.chgPct)}
            </SpineLink>
          ))}
        </p>
      )}

      {/* The macro line: nine tiles, one picked. */}
      <div className="read__tiles" role="tablist" aria-label="Markets on the read" ref={tilesRef} onKeyDown={onTilesKey}>
        {READ_INSTRUMENTS.map((i) => {
          const tq = snap.quotes[i.id]
          const t = readTone(tq?.chg, i.unit)
          const tag = readTileTag(i, tq)
          const spark = tq ? readSpark(tq.points) : ''
          const on = i.id === sel
          return (
            <button key={i.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} className={`read__tile is-${t}${on ? ' is-on' : ''}`} onClick={() => pick(i.id)} data-read-tile={i.id} data-source={i.source} data-journey={`Read: ${i.label}`}>
              <span className="read__tilehead">
                {tag && <i className={`read__tag read__tag--${tag === '24/7' ? 'always' : 'closed'}`} title={tag === '24/7' ? 'Trades around the clock' : 'Closed: the last session\u2019s close'} aria-hidden />}
                <span className="read__tilelabel">{i.label}</span>
                {tag === 'closed' && <span className="sr-only"> (closed)</span>}
              </span>
              <span className="read__tilelast mono">{fmtReadValue(i, tq?.last)}</span>
              <span className="read__tilefoot">
                <span className="read__tilechg mono">{fmtReadChange(i, tq?.chg)}</span>
                <svg className="read__spark" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden>
                  {spark && <path d={spark} vectorEffect="non-scaling-stroke" />}
                </svg>
              </span>
            </button>
          )
        })}
      </div>

      {/* The chart of the pick, and what can be done about it here. */}
      <div className="read__stage" role="tabpanel" aria-label={inst.name}>
        <div className="read__chart">
          <div className="read__charthead">
            <div className="read__id">
              <span className="read__name mono">{inst.name}</span>
              <span className="read__last">{fmtReadValueFull(inst, at ? at[1] : q?.last)}</span>
              {at ? (
                <span className="read__when mono">{fmtPointTime(at[0], range)}</span>
              ) : (
                <span className={`read__chg mono is-${tone}`}>
                  {fmtReadChange(inst, change)} <span className="read__basis">{readBasisWords(inst, range, q?.live ?? true)}</span>
                </span>
              )}
            </div>
            <div className="read__ranges" role="group" aria-label="Range">
              {READ_RANGES.map((r) => (
                <button key={r.id} type="button" className={`read__range mono${r.id === range ? ' is-on' : ''}`} aria-pressed={r.id === range} onClick={() => { setRange(r.id); setHover(null) }} data-journey={`Read range ${r.label}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`read__plot is-${tone}`} onPointerMove={onPlotMove} onPointerDown={onPlotMove} onPointerLeave={() => setHover(null)} data-points={points.length} data-loading={loading || undefined}>
            {chart ? (
              <>
                <svg className="read__svg" viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label={`${inst.name}, ${readBasisWords(inst, range, q?.live ?? true)}: ${fmtReadChange(inst, change)}`}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" className="read__stop" stopOpacity="0.28" />
                      <stop offset="1" className="read__stop" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={chart.area} fill={`url(#${gradId})`} />
                  {chart.baseY !== null && <line x1="0" x2="1000" y1={chart.baseY} y2={chart.baseY} className="read__base" vectorEffect="non-scaling-stroke" />}
                  <path d={chart.line} className="read__path" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="read__axis read__axis--max mono">{fmtReadValue(inst, chart.max)}</span>
                <span className="read__axis read__axis--min mono">{fmtReadValue(inst, chart.min)}</span>
                {hover != null && hover < chart.xs.length && (
                  <>
                    <span className="read__cursor" style={{ left: `${chart.xs[hover] / 10}%` }} aria-hidden />
                    <span className="read__dot" style={{ left: `${chart.xs[hover] / 10}%`, top: `${chart.ys[hover] / 3}%` }} aria-hidden />
                  </>
                )}
              </>
            ) : (
              <p className="read__empty mono">{loading ? 'Reading that range…' : have ? 'This range did not answer. Try another.' : 'Waiting for the first quotes.'}</p>
            )}
          </div>
        </div>

        <aside className="read__act" aria-label={`What you can do about ${inst.label} here`}>
          <p className="read__venue">{readVenueLine(inst)}</p>
          {chips.length > 0 ? (
            <>
              <p className="read__actlab mono">{inst.direct ? 'Act on it' : 'The closest thing listed here'}</p>
              <div className="read__chips">
                {chips.map((c) => (
                  <button key={c.ask} type="button" className={`read__chip read__chip--${c.tone}`} onClick={() => act(c.ask)} title={c.ask} data-ask={c.ask} data-journey={`Read act: ${c.ask}`}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="read__sentence mono">
                The sentence your wallet signs: <q>{chips[0].ask}</q>
              </p>
            </>
          ) : (
            <p className="read__noact">{readNoActLine(inst)}</p>
          )}
          <div className="read__doors">
            {/* Every tile has a full chart now: an app market's symbol page, or an index's look-only page (/t/US10Y, /t/VIX… lib/read readPageHref). */}
            {page && (
              <SpineLink href={page} className="read__door" prefetch={false} data-journey={`Read open ${page.slice(3)}`}>
                Open the full chart <span aria-hidden>→</span>
              </SpineLink>
            )}
            {charts.map((n) => (
              <SpineLink key={n.symbol} href={`/t/${n.symbol}`} className="read__door read__door--near" prefetch={false} data-journey={`Read open ${n.symbol}`}>
                {n.symbol}, {n.as} <span aria-hidden>→</span>
              </SpineLink>
            ))}
          </div>
        </aside>
      </div>

      <footer className="read__foot mono">{READ_SOURCES_LINE}</footer>
      {door}
    </section>
  )
}
