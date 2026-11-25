'use client'

// THE READ — the home's lead (2026-11-09; rules in lib/read, pinned).
// A DESK OF TOKENS since 2026-11-20 (rules in lib/read-desk, pinned): Nate,
// "a bit too heavy on traditional … lean more crypto … make this page up with
// tokens in the user's watch list if they have some and if not … a more
// powerful visual to show an overview of the system and its actions with
// charts".
//
// The market as one sentence, every clause a button; under it a wall of
// tiles, each a live day's chart: the visitor's OPEN WATCHLIST when it holds
// anything the app can chart (the line is then about the list), the crypto
// desk when it does not. The nine macro markets the read used to lead with
// ride one row under the tiles (the backdrop), each still a button onto the
// chart. Then the chart of the pick, drawn as the order form it is: every
// act the app can build on that market is a row beside it naming the venue
// it routes through, and an act that rests at a price is a line ON the chart
// with its button on the price rail (the resting limit, the alert's band).
//
// It opens no stream: the tiles re-read cached routes every 30s while the tab
// is in view, and nothing here fires a turn.
//
// The server renders the whole first frame from the snapshot the page read
// (the line, the crypto desk's tiles, the chart's paths — lib/read readChart
// draws in a stretched viewBox, so nothing is measured). Whose list it is,
// the clock words, the hover readout and a longer range are the browser's and
// land after mount; a returning visitor's tiles open on what this browser
// last drew for them while the lists load.
//
// Acting: every act is gated by the measured venue verdicts
// (lib/trade-venue-gate) and goes through the connect-to-act door into the
// ask door's sheet on this page. A market the app cannot build on names the
// nearest thing listed here and offers THAT sentence. Every link out of the
// card is a SpineLink (the app's own door).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import SpineLink from '@/components/SpineLink'
import ShareActions from '@/components/ShareActions'
import TokenIcon from '@/components/TokenIcon'
import ArmAlert from '@/components/live/ArmAlert'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { readPost } from '@/lib/share-posts'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { chartPairFor } from '@/lib/charts'
import { fmtCountdown, sessionStripFor } from '@/lib/markets'
import { alertSymbolFor } from '@/lib/pick-alerts'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useTradable } from '@/lib/use-tradable'
import { DEFAULT_LIST_NAME } from '@/lib/watchlists'
import {
  READ_CHART_H,
  READ_CHART_PAD,
  READ_CHART_W,
  READ_DEFAULT_RANGE,
  READ_RANGES,
  READ_REFRESH_MS,
  READ_WAITING,
  fmtReadChange,
  fmtReadPct,
  readChart,
  readNoActLine,
  readPointAt,
  readTone,
  type ReadPoint,
  type ReadQuote,
  type ReadRange,
  type ReadSnapshot,
} from '@/lib/read'
import {
  DESK_MACRO_ITEMS,
  DESK_MEMORY_KEY,
  DESK_SOURCES_LINE,
  DESK_VIEW_KEY,
  deskActs,
  deskBackdrop,
  deskBasisWords,
  deskFetchSymbols,
  deskHeadline,
  deskHeadlineText,
  deskItemFor,
  deskLevelSpecs,
  deskMovers,
  deskPageHref,
  deskPlan,
  deskQuote,
  deskScaleAlso,
  deskSeriesChange,
  deskTileTag,
  deskVenueLine,
  fmtDeskValue,
  fmtDeskValueFull,
  parseDeskMemory,
  placeDeskLevels,
  type DeskItem,
} from '@/lib/read-desk'
import './read.css'

/** A point's time as the readout prints it: the clock for a day, the date past it. */
function fmtPointTime(t: number, range: ReadRange): string {
  const d = new Date(t * 1000)
  if (range === '1d') return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  if (range === '6m') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** A tile's day as two paths in a stretched box: the line, and the same line closed to the floor. */
function tileSpark(points: readonly ReadPoint[]): { line: string; area: string } | null {
  if (points.length < 2) return null
  const step = Math.max(1, Math.ceil(points.length / 48))
  const thin = points.filter((_, i) => i % step === 0 || i === points.length - 1)
  const c = readChart(thin, null, 120, 36, 0.14)
  return c ? { line: c.line, area: c.area } : null
}

/** Columns the tile wall is laid on: one row to eight tiles, two rows past that (every row once "show all" is on). */
function wallCols(cells: number, all: boolean): number {
  if (all) return 8
  return cells <= 8 ? Math.max(cells, 4) : Math.ceil(cells / 2)
}

export default function TheRead({ initial }: { initial: ReadSnapshot }) {
  const [snap, setSnap] = useState<ReadSnapshot>(initial)
  const [range, setRange] = useState<ReadRange>(READ_DEFAULT_RANGE)
  const [series, setSeries] = useState<Record<string, ReadPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  // Clock words are the browser's: null on the server and the first paint.
  const [now, setNow] = useState<Date | null>(null)
  const tilesRef = useRef<HTMLDivElement>(null)
  const tradable = useTradable()

  // ── Whose desk: the open watchlist, or the crypto desk ──
  // A second instance of the rail's hook (it reads no holdings; the rail's
  // writes reach it, components/markets/watchlist/useWatchlists announceLists).
  const wl = useWatchlists({ holdings: false })
  // What this browser last drew as YOURS, read after mount (the server has no memory).
  const [memory, setMemory] = useState<string[]>([])
  // 'desk': the visitor chose the crypto desk over their own list (remembered).
  const [view, setView] = useState<'auto' | 'desk'>('auto')
  const [all, setAll] = useState(false)
  // Loaded for this visitor AND the open list chosen (one render sits between the two).
  const listReady = wl.ready && (wl.lists.length === 0 || wl.active !== null)
  const listSymbols = listReady ? (wl.active?.symbols ?? null) : memory
  const mine = useMemo(() => deskPlan(listSymbols, { all }), [listSymbols, all])
  const hasList = mine.mode === 'yours'
  const plan = useMemo(() => (view === 'desk' && hasList ? deskPlan(null) : mine), [view, hasList, mine])
  const inList = useMemo(() => new Set(mine.owned.map((i) => i.key)), [mine])
  const backdrop = useMemo(() => deskBackdrop(plan), [plan])

  useEffect(() => {
    try {
      setMemory(parseDeskMemory(window.localStorage.getItem(DESK_MEMORY_KEY)))
      if (window.localStorage.getItem(DESK_VIEW_KEY) === 'desk') setView('desk')
    } catch {
      /* a per-browser convenience only */
    }
  }, [])
  const listKey = listReady ? (wl.active?.symbols ?? []).join(',') : null
  useEffect(() => {
    if (listKey === null) return
    try {
      window.localStorage.setItem(DESK_MEMORY_KEY, JSON.stringify(listKey ? listKey.split(',') : []))
    } catch {
      /* a per-browser convenience only */
    }
  }, [listKey])
  const chooseView = useCallback((next: 'auto' | 'desk') => {
    setView(next)
    setHover(null)
    try {
      if (next === 'desk') window.localStorage.setItem(DESK_VIEW_KEY, 'desk')
      else window.localStorage.removeItem(DESK_VIEW_KEY)
    } catch {
      /* a per-browser convenience only */
    }
  }, [])
  // A suggested token joins the open list (the first one makes the list).
  const watch = useCallback(
    (symbol: string) => {
      if (!listReady) return
      if (wl.active) void wl.addSymbols(wl.active.id, [symbol])
      else void wl.createList(DEFAULT_LIST_NAME, [symbol])
    },
    [listReady, wl],
  )

  // ── The pick ──
  const [picked, setPicked] = useState<string | null>(null)
  const [extra, setExtra] = useState<Record<string, ReadQuote>>({})
  const quoteOf = useCallback((item: DeskItem) => deskQuote(item, snap, extra), [snap, extra])
  const head = useMemo(() => deskHeadline(plan, quoteOf), [plan, quoteOf])
  const clauses = head.clauses
  // The pick stays while it is on the desk; otherwise the line's first market, then the first tile.
  const onDesk = useMemo(() => new Set([...plan.tiles.map((t) => t.item.key), ...backdrop.map((i) => i.key)]), [plan, backdrop])
  const sel = picked && onDesk.has(picked) ? picked : (clauses.find((c) => onDesk.has(c.key))?.key ?? plan.tiles[0]?.item.key ?? 'BTC')
  const item = useMemo<DeskItem>(() => plan.tiles.find((t) => t.item.key === sel)?.item ?? backdrop.find((i) => i.key === sel) ?? deskItemFor(sel) ?? DESK_MACRO_ITEMS[DESK_MACRO_ITEMS.length - 2], [plan, backdrop, sel])

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

  // ── The list's own quotes: one cached read for every tile the snapshot does not carry ──
  const fetchKey = useMemo(() => deskFetchSymbols(plan, snap).join(','), [plan, snap])
  useEffect(() => {
    if (!fetchKey) return
    let stopped = false
    const pull = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch(`/api/markets/read?symbols=${encodeURIComponent(fetchKey)}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { quotes?: Record<string, ReadQuote> }
        if (!stopped && body.quotes) setExtra((prev) => ({ ...prev, ...body.quotes }))
      } catch {
        /* the tiles keep the last read */
      }
    }
    void pull()
    const id = setInterval(() => void pull(), READ_REFRESH_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void pull()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetchKey])

  // ── A longer range: one cached read per market + range ──
  const q = quoteOf(item)
  const seriesKey = `${sel}:${range}`
  const seriesHref = item.inst ? `/api/markets/read?id=${item.inst.id}&range=${range}` : `/api/markets/read?symbol=${encodeURIComponent(item.key)}&range=${range}`
  useEffect(() => {
    if (range === '1d' || series[seriesKey]) return
    let alive = true
    setLoading(true)
    fetch(seriesHref, { cache: 'no-store' })
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
  }, [range, seriesKey, seriesHref, series])

  const points: readonly ReadPoint[] = range === '1d' ? (q?.points ?? []) : (series[seriesKey] ?? [])
  const base = range === '1d' ? (q?.prev ?? null) : (points[0]?.[1] ?? null)
  const change = range === '1d' ? (q?.chg ?? null) : deskSeriesChange(item, points)
  const tone = readTone(change, item.unit)
  const at = hover != null && hover < points.length ? points[hover] : null

  const pick = useCallback(
    (key: string) => {
      // A clause can name a list symbol that sits behind "show all": picking it opens the whole wall.
      if (!onDesk.has(key)) setAll(true)
      setPicked(key)
      setHover(null)
    },
    [onDesk],
  )
  // The picked tile stays in view on a phone's scrolling row (never the page).
  useEffect(() => {
    const el = tilesRef.current?.querySelector<HTMLElement>(`[data-read-tile="${sel}"]`)?.parentElement
    const row = tilesRef.current
    if (!el || !row || row.scrollWidth <= row.clientWidth) return
    const left = el.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' })
  }, [sel])
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
  const canAct = useCallback((ask: string) => canTradeAsk(ask, tradable), [tradable])
  // The server's own quote for the pick: the venue lists it right now.
  const hasQuote = !!q
  const last = q?.last ?? null
  const { acts, charts } = useMemo(() => deskActs(item, last, hasQuote, canAct), [item, last, hasQuote, canAct])
  const ownActs = item.inst ? item.inst.direct : true
  // An alert can be armed on a market the sweep can price (lib/pick-alerts alertSymbolFor), once it is quoted.
  const alertable = hasQuote && item.unit === 'usd' && alertSymbolFor(item.key) !== null
  // The act a pointer is on: its sentence is the one shown, its level the one lit.
  const [hot, setHot] = useState<string | null>(null)
  const hotAct = acts.find((a) => a.id === hot) ?? null

  // ── The chart, with its levels ──
  const specs = useMemo(() => deskLevelSpecs(item, last, acts, alertable), [item, last, acts, alertable])
  const chart = useMemo(() => readChart(points, base, READ_CHART_W, READ_CHART_H, READ_CHART_PAD, deskScaleAlso(points, base, specs)), [points, base, specs])
  const levels = useMemo(() => (chart ? placeDeskLevels(specs, chart.lo, chart.hi) : []), [chart, specs])

  const page = deskPageHref(item)
  const session = now ? sessionStripFor(now) : null
  const headline = deskHeadlineText(head)
  const have = Object.keys(snap.quotes).length > 0
  const movers = useMemo(() => deskMovers(snap, plan), [snap, plan])
  const moverRows = [...movers.tokens, ...movers.stocks]
  const cells = plan.tiles.length + (plan.hidden > 0 ? 1 : 0)
  const basis = deskBasisWords(item, range, q?.live ?? true)

  return (
    <section className="read" data-read data-mode={plan.mode} data-sel={sel} data-range={range} data-tone={tone} data-quotes={Object.keys(snap.quotes).length} aria-label={plan.mode === 'yours' ? 'Your read: your watchlist in a sentence' : 'The read: the market in a sentence'}>
      <header className="read__eyebrow mono">
        <span className="read__kicker">{plan.mode === 'yours' ? 'Your read' : 'The read'}</span>
        {plan.mode === 'yours' && wl.active && (
          <span className="read__list">
            {wl.active.name} · {plan.owned.length}
          </span>
        )}
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
        {/* Whose read: a visitor with a list can flip to the crypto desk and back (remembered per browser). */}
        {hasList && (
          <span className="read__views" role="group" aria-label="Whose read">
            <button type="button" className={`read__view${view === 'auto' ? ' is-on' : ''}`} aria-pressed={view === 'auto'} onClick={() => chooseView('auto')} data-journey="Read view: yours">
              Yours
            </button>
            <button type="button" className={`read__view${view === 'desk' ? ' is-on' : ''}`} aria-pressed={view === 'desk'} onClick={() => chooseView('desk')} data-journey="Read view: crypto desk">
              Crypto desk
            </button>
          </span>
        )}
        {/* The market's line is a post: today's read, as composed, with the link (the app's own share door). A list's line is its owner's. */}
        {plan.mode === 'desk' && clauses.length > 0 && <ShareActions post={readPost(headline)} variant="pill" label="Post the read" surface="read" className="read__share" />}
      </header>

      {/* The line. One h2 a crawler and a screen reader read whole; each clause is a button onto its chart. */}
      <h2 className="read__line" aria-label={headline}>
        {clauses.length === 0 ? (
          <span className="read__waiting">{head.lead || `${READ_WAITING}…`}</span>
        ) : (
          <>
            {head.lead && <span className="read__lead">{head.lead} </span>}
            {clauses.map((c, i) => (
              <Fragment key={c.key}>
                {/* The space lives BETWEEN the units, in the heading's own flow: that is where a line may break. */}
                {i > 0 && ' '}
                <span className="read__clausewrap">
                  <button type="button" className={`read__clause is-${c.tone}${c.key === sel ? ' is-on' : ''}`} aria-pressed={c.key === sel} onClick={() => pick(c.key)} data-read-clause={c.key} data-journey={`Read: ${c.key}`}>
                    <span className="read__subject">{c.subject}</span> <span className="read__verb">{c.verb}</span>
                    {c.amount && <span className="read__amount"> {c.amount}</span>}
                  </button>
                  <span aria-hidden>{i < clauses.length - 1 ? ',' : '.'}</span>
                </span>
              </Fragment>
            ))}
          </>
        )}
      </h2>

      {moverRows.length > 0 && (
        <p className="read__movers">
          <span className="read__moverslab mono">{plan.mode === 'yours' ? 'Moving outside your list' : 'Biggest moves here'}</span>
          {moverRows.map((m) => (
            <SpineLink key={m.symbol} href={`/t/${m.symbol}`} className={`read__mover mono is-${m.chgPct > 0 ? 'up' : 'down'}`} prefetch={false} data-journey={`Read mover ${m.symbol}`}>
              <b>{m.symbol}</b> {fmtReadPct(m.chgPct)}
            </SpineLink>
          ))}
        </p>
      )}

      {/* The wall: one tile a token, each a live day's chart; one is picked. */}
      <div className="read__tiles" role="group" aria-label={plan.mode === 'yours' ? 'Your watchlist on the read' : 'The crypto desk'} ref={tilesRef} data-cells={cells} style={{ '--read-cols': wallCols(cells, all) } as CSSProperties}>
        {plan.tiles.map(({ item: i, own }) => {
          const tq = quoteOf(i)
          const t = readTone(tq?.chg, i.unit)
          const tag = deskTileTag(i, tq)
          const spark = tq ? tileSpark(tq.points) : null
          const on = i.key === sel
          return (
            <div key={i.key} className={`read__cell${own || plan.mode === 'desk' ? '' : ' is-suggested'}`}>
              {(() => {
                // A tile is the way onto its market's own page (Nate, 2026-11-25); one with no page still picks the chart below.
                const href = deskPageHref(i)
                const cls = `read__tile is-${t}${on ? ' is-on' : ''}`
                return href ? (
                  <SpineLink href={href} prefetch={false} className={cls} data-read-tile={i.key} data-kind={i.kind} data-journey={`Read tile ${i.key}`}>
                <span className="read__tilehead">
                  {i.icon && (
                    <span className="read__tileicon" aria-hidden>
                      <TokenIcon symbol={i.icon} size={18} />
                    </span>
                  )}
                  <span className="read__tilelabel">{i.label}</span>
                  {tag && <i className={`read__tag read__tag--${tag === '24/7' ? 'always' : 'closed'}`} title={tag === '24/7' ? 'Trades around the clock' : 'Closed: the last session’s close'} aria-hidden />}
                  {tag === 'closed' && <span className="sr-only"> (closed)</span>}
                </span>
                <span className="read__tilelast mono">{fmtDeskValue(i, tq?.last)}</span>
                <span className="read__tilechg mono">{fmtReadChange(i, tq?.chg)}</span>
                <svg className="read__spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden>
                  {spark && (
                    <>
                      <path className="read__sparkarea" d={spark.area} />
                      <path className="read__sparkline" d={spark.line} vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </svg>
                  </SpineLink>
                ) : (
                  <button type="button" aria-pressed={on} className={cls} onClick={() => pick(i.key)} data-read-tile={i.key} data-kind={i.kind} data-journey={`Read: ${i.key}`}>
                <span className="read__tilehead">
                  {i.icon && (
                    <span className="read__tileicon" aria-hidden>
                      <TokenIcon symbol={i.icon} size={18} />
                    </span>
                  )}
                  <span className="read__tilelabel">{i.label}</span>
                  {tag && <i className={`read__tag read__tag--${tag === '24/7' ? 'always' : 'closed'}`} title={tag === '24/7' ? 'Trades around the clock' : 'Closed: the last session’s close'} aria-hidden />}
                  {tag === 'closed' && <span className="sr-only"> (closed)</span>}
                </span>
                <span className="read__tilelast mono">{fmtDeskValue(i, tq?.last)}</span>
                <span className="read__tilechg mono">{fmtReadChange(i, tq?.chg)}</span>
                <svg className="read__spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden>
                  {spark && (
                    <>
                      <path className="read__sparkarea" d={spark.area} />
                      <path className="read__sparkline" d={spark.line} vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </svg>
                  </button>
                )
              })()}
              {/* A token the desk suggests is one press from the visitor's list (the first press makes the list). */}
              {!inList.has(i.key) && listReady && (
                <button type="button" className="read__watch" onClick={() => watch(i.key)} aria-label={`Add ${i.key} to your watchlist`} title={`Add ${i.key} to your watchlist`} data-read-watch={i.key} data-journey={`Read watch ${i.key}`}>
                  +
                </button>
              )}
            </div>
          )
        })}
        {plan.hidden > 0 && (
          <button type="button" className="read__more mono" onClick={() => setAll(true)} data-journey="Read: show all">
            +{plan.hidden} more
            <span className="read__morehint">on your list</span>
          </button>
        )}
      </div>

      {/* The backdrop: the macro markets that are not a tile, one row, each a button onto the chart. */}
      {backdrop.length > 0 && (
        <div className="read__backdrop" role="group" aria-label="The backdrop: stocks, rates, the dollar and commodities">
          <span className="read__backlab mono">Backdrop</span>
          {backdrop.map((i) => {
            const bq = quoteOf(i)
            const on = i.key === sel
            return (
              <button key={i.key} type="button" className={`read__back is-${readTone(bq?.chg, i.unit)}${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => pick(i.key)} data-read-back={i.key} data-journey={`Read: ${i.label}`}>
                <span className="read__backname">{i.label}</span>
                <span className="read__backlast mono">{fmtDeskValue(i, bq?.last)}</span>
                <span className="read__backchg mono">{fmtReadChange(i, bq?.chg)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* The chart of the pick, drawn as the order form: its acts beside it, the ones with a price on it. */}
      <div className="read__stage" role="tabpanel" aria-label={item.name}>
        <div className="read__chart">
          <div className="read__charthead">
            <div className="read__id">
              <span className="read__name mono">{item.name}</span>
              <span className="read__last">{fmtDeskValueFull(item, at ? at[1] : q?.last)}</span>
              {at ? (
                <span className="read__when mono">{fmtPointTime(at[0], range)}</span>
              ) : (
                <span className={`read__chg mono is-${tone}`}>
                  {fmtReadChange(item, change)} <span className="read__basis">{basis}</span>
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
          <div className={`read__plot is-${tone}`} data-points={points.length} data-levels={levels.length} data-loading={loading || undefined}>
            {chart ? (
              <>
                <div className="read__canvas" onPointerMove={onPlotMove} onPointerDown={onPlotMove} onPointerLeave={() => setHover(null)}>
                  <svg className="read__svg" viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label={`${item.name}, ${basis}: ${fmtReadChange(item, change)}`}>
                    <path d={chart.area} className="read__area" />
                    {chart.baseY !== null && <line x1="0" x2="1000" y1={chart.baseY} y2={chart.baseY} className="read__base" vectorEffect="non-scaling-stroke" />}
                    <path d={chart.line} className="read__path" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <span className="read__axis read__axis--max mono">{fmtDeskValue(item, chart.max)}</span>
                  <span className="read__axis read__axis--min mono">{fmtDeskValue(item, chart.min)}</span>
                  {hover != null && hover < chart.xs.length && (
                    <>
                      <span className="read__cursor" style={{ left: `${chart.xs[hover] / 10}%` }} aria-hidden />
                      <span className="read__dot" style={{ left: `${chart.xs[hover] / 10}%`, top: `${chart.ys[hover] / 3}%` }} aria-hidden />
                    </>
                  )}
                </div>
                {/* THE LEVELS: the price now, the resting limit, the alert's band. A level in view is a line across the
                    plot; every level is a tag on the price rail, and a tag that carries an act is its button. */}
                {levels.map((l) => {
                  const lit = l.kind === 'alert' ? hot === 'alert' : hot === l.id
                  const edge = l.off === -1 ? '▲ ' : l.off === 1 ? '▼ ' : ''
                  return (
                    <Fragment key={l.id}>
                      {l.off === 0 && <span className={`read__lvline read__lvline--${l.kind}${lit ? ' is-hot' : ''}`} style={{ top: `${l.y}%` }} aria-hidden />}
                      {l.act ? (
                        <button
                          type="button"
                          className={`read__lvtag read__lvtag--${l.kind} mono${lit ? ' is-hot' : ''}`}
                          style={{ top: `${l.tagY}%` }}
                          onClick={() => act(l.act!.ask)}
                          onPointerEnter={() => setHot(l.id)}
                          onPointerLeave={() => setHot(null)}
                          onFocus={() => setHot(l.id)}
                          onBlur={() => setHot(null)}
                          title={l.act.ask}
                          data-ask={l.act.ask}
                          data-read-level={l.kind}
                          data-journey={`Read level: ${l.act.ask}`}
                        >
                          {edge}
                          {l.label}
                        </button>
                      ) : (
                        <span className={`read__lvtag read__lvtag--${l.kind} mono${lit ? ' is-hot' : ''}`} style={{ top: `${l.tagY}%` }} data-read-level={l.kind} aria-hidden={l.kind === 'now' || undefined}>
                          {edge}
                          {l.label}
                        </span>
                      )}
                    </Fragment>
                  )
                })}
              </>
            ) : (
              <p className="read__empty mono">{loading ? 'Reading that range…' : have ? 'This range did not answer. Try another.' : 'Waiting for the first quotes.'}</p>
            )}
          </div>
        </div>

        <aside className="read__act" aria-label={`What you can do about ${item.label} here`}>
          <p className="read__venue">{deskVenueLine(item, chartPairFor(item.key))}</p>
          {acts.length > 0 ? (
            <>
              <p className="read__actlab mono">{ownActs ? 'Act on it' : 'The closest thing listed here'}</p>
              <ul className="read__acts">
                {acts.map((a) => (
                  <li key={a.id} className={`read__actrow${hot === a.id ? ' is-hot' : ''}`}>
                    <button
                      type="button"
                      className={`read__chip read__chip--${a.tone}`}
                      onClick={() => act(a.ask)}
                      onPointerEnter={() => setHot(a.id)}
                      onPointerLeave={() => setHot(null)}
                      onFocus={() => setHot(a.id)}
                      onBlur={() => setHot(null)}
                      title={a.ask}
                      data-ask={a.ask}
                      data-journey={`Read act: ${a.ask}`}
                    >
                      {a.label}
                    </button>
                    <span className="read__where mono">{a.where}</span>
                  </li>
                ))}
              </ul>
              <p className="read__sentence mono">
                The sentence your wallet signs: <q>{(hotAct ?? acts[0]).ask}</q>
              </p>
            </>
          ) : (
            <p className="read__noact">{item.inst ? readNoActLine(item.inst) : 'No venue here builds an order on it yet. It is here to read.'}</p>
          )}
          {/* The alert: the same one-tap control the live page arms (components/live/ArmAlert); its band is on the chart. */}
          {alertable && (
            <div className="read__alert" onPointerEnter={() => setHot('alert')} onPointerLeave={() => setHot(null)}>
              <ArmAlert market={item.key} seat="deck" />
            </div>
          )}
          <div className="read__doors">
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

      {/* What the picture is, for someone who has never pressed it. */}
      <p className="read__how">
        <b>The chart is the order form.</b> Each act names the venue Pantessa builds it on, an act with a price is a line on the chart, and your wallet signs it.
        {!hasList && (
          <>
            {' '}
            Press <span className="read__howplus mono">+</span> on a token and this read becomes yours.
          </>
        )}
      </p>

      <footer className="read__foot mono">{DESK_SOURCES_LINE}</footer>
      {door}
    </section>
  )
}
