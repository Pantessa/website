'use client'

// The /t/<symbol> page FRAME (SHELL): header (mark · name · symbol · venue
// chip · last · change · session line) → the chart (always mounted, above
// the tabs — the chart is the order form, so it never disappears while you
// trade) → the tab strip Overview · News · Community · Technicals · Trade
// (`?tab=` mirrored via replaceState, the #705 idiom) → the tab's body. The
// right rail (watchlist slot + symbol card) is the /markets frame's rail:
// docked right from the nav down on ≥1024px, stacked below at 375px.
//
// The chart engine lives behind components/markets/chart/ChartMount (CHART
// lane swaps the internals); the expand toggle is the same CSS takeover +
// Fullscreen API the old full-bleed page had.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import ChartMount, { type ChartStats } from '@/components/markets/chart/ChartMount'
import type { ChartState } from '@/lib/chart-state'
import { fmtPrice } from '@/components/CandleChart'
import { CHART_FEED_LABELS, chartPairFor, type ChartFeed, type ChartTf } from '@/lib/charts'
import {
  DEFAULT_MARKET_TAB,
  MARKET_TABS,
  marketTabUrl,
  parseMarketTab,
  parseVsParam,
  rangePosition,
  sessionState,
  symbolName,
  syncMarketTab,
  syncVsParam,
  venueLabel,
  type MarketTab,
} from '@/lib/markets'
import { fmtQuotePrice } from '@/lib/markets-quotes'
import { useDayStats } from '@/components/markets/shell/useDayStats'
import HeldPill from '@/components/markets/shell/HeldPill'
import CompareControl from '@/components/markets/shell/CompareControl'
import ExecStrip from '@/components/markets/slots/ExecStrip'
import AskChart from '@/components/markets/slots/AskChart'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'
import SymbolCardSlot from '@/components/markets/shell/SymbolCardSlot'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import OverviewTab from '@/components/markets/tabs/OverviewTab'
import NewsTab from '@/components/markets/tabs/NewsTab'
import CommunityTab from '@/components/markets/tabs/CommunityTab'
import TechnicalsTab from '@/components/markets/tabs/TechnicalsTab'
import TradeTab from '@/components/markets/tabs/TradeTab'
import { sideOf, type InjectedPrompt, type TradeAsk } from '@/lib/trade-asks'
import { useConnectToAct } from '@/lib/use-connect-to-act'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

type FsDoc = Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element | null }
type FsEl = HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }

export default function SymbolPage({ symbol, initialTab, initialTf, initialVs = null }: { symbol: string; initialTab?: MarketTab; initialTf?: ChartTf; initialVs?: string | null }) {
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const sym = pair?.symbol ?? symbol
  const name = symbolName(sym)
  const [stats, setStats] = useState<ChartStats | null>(null)
  const [expanded, setExpanded] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)

  // ── Tabs: URL → state on arrival + back/forward; state → URL on change ──
  const [tab, setTab] = useState<MarketTab>(initialTab ?? DEFAULT_MARKET_TAB)
  const mirroredRef = useRef(false)
  useEffect(() => {
    setTab(parseMarketTab(window.location.search))
    const onPop = () => setTab(parseMarketTab(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    // First run: the URL is already the truth (we just read it).
    if (!mirroredRef.current) {
      mirroredRef.current = true
      return
    }
    syncMarketTab(tab)
  }, [tab])

  // ── Compare: ?vs=<symbol> (MK2) — same URL discipline as ?tab= ──
  const [vs, setVs] = useState<string | null>(initialVs)
  useEffect(() => {
    setVs(parseVsParam(window.location.search, symbol))
    const onPop = () => setVs(parseVsParam(window.location.search, symbol))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [symbol])
  const vsMirroredRef = useRef(false)
  useEffect(() => {
    if (!vsMirroredRef.current) {
      vsMirroredRef.current = true
      return
    }
    syncVsParam(vs)
  }, [vs])
  // The chart-aware ask box docked under the chart (AI's AskChart slot):
  // open by default on desktop, folded on a phone (remembered per browser).
  const [askOpen, setAskOpen] = useState(true)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('pantessa.markets.askchart')
      if (raw === '0' || raw === '1') setAskOpen(raw === '1')
      else if (window.innerWidth < 640) setAskOpen(false)
    } catch {
      /* default open */
    }
  }, [])
  const toggleAsk = useCallback(() => {
    setAskOpen((o) => {
      try {
        window.localStorage.setItem('pantessa.markets.askchart', o ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !o
    })
  }, [])

  // ── The send door: a chip anywhere on the page lands on Trade and fires ──
  const router = useRouter()
  const [prompt, setPrompt] = useState<InjectedPrompt | null>(null)
  const tabsRef = useRef<HTMLElement | null>(null)
  const runAsk = useCallback(
    (ask: string) => {
      // A symbol with no candle feed has no Trade panel: its asks go to chat.
      if (!pair) {
        router.push(promptHref(ask))
        return
      }
      setPrompt({ text: ask, send: true, at: Date.now() })
      setTab('trade')
      // The header chips sit above the chart; the build lands under it. Bring
      // the tab strip up under the nav so the order panel is on screen (the
      // chart stays one scroll away — it never unmounts).
      requestAnimationFrame(() => {
        const el = tabsRef.current
        if (!el) return
        const top = el.getBoundingClientRect().top + window.scrollY - 72
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      })
    },
    [pair, router],
  )
  // Looking needs no wallet; acting does (2026-09-14, Nate: "only on an
  // action item 'buy $10 of APPLE'"). Every ask on the page comes through
  // here: the header chips, the Trade panel's Send, a chart level, a verdict
  // chip, a post, the watchlist. A connected wallet runs it now; a visitor
  // with none gets the connect door, and the ask runs once a wallet lands
  // (lib/use-connect-to-act).
  const { act, door } = useConnectToAct({
    run: runAsk,
    redirectFor: (ask) => (pair ? marketTabUrl('trade', window.location.pathname, window.location.search) : promptHref(ask)),
    resumable: !!pair,
  })
  const onAsk = useCallback((a: TradeAsk) => act(a.ask), [act])
  // A chip is a real link (the /chat prefill: no-JS, a new tab); a plain
  // click sends through the act door instead.
  const sendOnClick = (ask: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    act(ask)
  }
  // The header's act row is EXEC's ExecStrip slot (the stub renders the
  // lib/trade-asks chips the header shipped with); every chip SENDS a bare
  // ask string through the act door.
  // A drawn level on the chart carries a bare ask string — same door.
  const onChartAsk = useCallback((ask: string) => onAsk({ side: sideOf(ask), label: ask, ask }), [onAsk])
  // The live drawings (for "attach my current chart" on a post) and a post's
  // lines loaded back onto the chart ("copy these lines to my chart").
  const [chartState, setChartState] = useState<ChartState | null>(null)
  const [loadedState, setLoadedState] = useState<ChartState | null>(null)
  // What's on screen (VIZ's onViewport, bar open times) — AskChart's context.
  const [viewport, setViewport] = useState<{ from: number; to: number; tf: ChartTf } | null>(null)

  // ── Session line ticks (a stock page left open crosses the bell) ──
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const session = sessionState(pair, now)
  // 24h range (hourly series) for the header's range bar.
  const day = useDayStats(pair ? pair.symbol : null)
  const rangeAt = rangePosition(day?.low, day?.high, stats?.last)

  // ── Expand: CSS takeover + best-effort native fullscreen (iOS refuses) ──
  const toggleExpand = useCallback(() => {
    const el = shellRef.current as FsEl | null
    const doc = document as FsDoc
    if (expanded) {
      setExpanded(false)
      if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
        void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => {})
      }
      return
    }
    setExpanded(true)
    if (el) void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => {})
  }, [expanded])
  useEffect(() => {
    const doc = document as FsDoc
    const onFsChange = () => {
      if (!(doc.fullscreenElement ?? doc.webkitFullscreenElement)) setExpanded(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const chg = stats?.changePct24h ?? null
  const chgClass = chg === null ? 'mkt-chg--flat' : chg > 0 ? 'mkt-chg--up' : chg < 0 ? 'mkt-chg--down' : 'mkt-chg--flat'
  const chgLabel = chg === null ? '—' : `${chg > 0 ? '+' : ''}${chg.toFixed(2)}% 24h`
  const markWhere = pair?.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {}
  const feed = (stats?.feed ?? pair?.source ?? null) as ChartFeed | null
  const feedLabel = feed ? (CHART_FEED_LABELS[feed] ?? feed) : ''

  const expandButton = (
    <button
      type="button"
      onClick={toggleExpand}
      className="tchart__fs"
      aria-pressed={expanded}
      aria-label={expanded ? 'Exit full screen' : 'Full screen chart'}
      title={expanded ? 'Exit full screen (Esc)' : 'Full screen chart'}
    >
      {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
    </button>
  )

  // Two grid items for the page's .mkt-frame (the /markets frame): the symbol
  // column and the watchlist rail, docked right from the nav down.
  return (
    <>
      <main className="sym" data-symbol={sym} data-vs={vs ?? undefined}>
        {/* ── Header ── */}
        <header className="sym__head sym__head--mk2">
          <div className="sym__id">
            <TokenIcon symbol={sym} size={40} {...markWhere} />
            <div className="min-w-0">
              <div className="sym__titlerow">
                <h1 className="sym__name truncate">{name}</h1>
                <span className="sym__sym mono">{sym}</span>
                <span className="sym__venue mono">{venueLabel(pair)}</span>
              </div>
              <div className="sym__meta">
                <p className="sym__session mono" data-tape={session.tape ? (session.tape.open ? 'open' : 'closed') : 'none'}>
                  <span className={`mk-dot${session.tape ? (session.tape.open ? ' mk-dot--open' : ' mk-dot--closed') : ' mk-dot--always'}`} aria-hidden />
                  {session.line}
                </p>
                {pair && <HeldPill symbol={sym} last={stats?.last ?? null} onClick={() => setTab('trade')} />}
                {pair && <CompareControl symbol={sym} vs={vs} onChange={setVs} />}
              </div>
            </div>
          </div>
          <div className="sym__quote">
            {pair && stats?.last != null ? (
              <>
                <span className="sym__last mono">${fmtPrice(stats.last)}</span>
                <span className={`sym__chg mono mkt-chg ${chgClass}`}>{chgLabel}</span>
                <span className="sym__feed mono">{feedLabel}</span>
              </>
            ) : pair ? (
              <span className="sym__feed mono">loading {feedLabel} candles…</span>
            ) : (
              <span className="sym__feed mono">No live chart yet</span>
            )}
            {pair && day && rangeAt !== null && (
              <div className="mk-range" data-range-at={rangeAt.toFixed(3)} title={`24h range: $${fmtQuotePrice(day.low)} – $${fmtQuotePrice(day.high)}`}>
                <span className="mk-range__lo mono">${fmtQuotePrice(day.low)}</span>
                <span className="mk-range__bar" aria-hidden>
                  <span className="mk-range__fill" style={{ width: `${(rangeAt * 100).toFixed(1)}%` }} />
                  <span className="mk-range__tick" style={{ left: `${(rangeAt * 100).toFixed(1)}%` }} />
                </span>
                <span className="mk-range__hi mono">${fmtQuotePrice(day.high)}</span>
                <span className="mk-range__k mono">24H RANGE</span>
              </div>
            )}
          </div>
          {/* The act row: EXEC's ExecStrip in a MARKETS-owned seat (the seat is
              what the harness pins; the slot's body is theirs). */}
          {pair && (
            <div className="sym__exec" data-seat="ExecStrip">
              <ExecStrip symbol={sym} pair={pair} onAsk={act} last={stats?.last ?? null} />
            </div>
          )}
        </header>

        {/* ── Chart (always mounted; the tabs never unmount it) ── */}
        <div ref={shellRef} className={expanded ? 'tchart sym__chart tchart--expanded' : 'tchart sym__chart'}>
          <div className="tchart__canvas">
            {pair ? (
              <ChartMount symbol={sym} height="fill" onStats={setStats} controlsRight={expandButton} resizeKey={expanded} onAsk={onChartAsk} state={loadedState} onStateChange={setChartState} onViewport={setViewport} />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="mkt-card max-w-md text-center">
                  <p className="mkt-card__title">No live chart for {sym || 'this token'} yet.</p>
                  <p className="mkt-card__note">
                    Stablecoins chart flat by design, and a listing without a candle feed stays honest here. You can still act on it in chat — one
                    sentence, guarded, signed only by your wallet.
                  </p>
                  <div className="mkt-chips mt-3 justify-center">
                    <Link href={promptHref(`Buy $50 of ${sym}`)} className="mkt-chip mkt-chip--buy" onClick={sendOnClick(`Buy $50 of ${sym}`)}>
                      Buy {sym}
                    </Link>
                    <Link href={promptHref(`Sell $50 of ${sym}`)} className="mkt-chip" onClick={sendOnClick(`Sell $50 of ${sym}`)}>
                      Sell {sym}
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Ask the chart (AI's AskChart slot), docked under the chart ── */}
        {pair && (
          <section className={`mk-askdock${askOpen ? ' is-open' : ''}`} data-askchart={askOpen ? 'open' : 'closed'} aria-label="Ask about this chart">
            <button type="button" className="mk-askdock__bar" onClick={toggleAsk} aria-expanded={askOpen}>
              <span className="mk-askdock__k mono">ASK THE CHART</span>
              <span className="mk-askdock__hint">{askOpen ? 'What is on screen is the context.' : `Ask about ${sym} — the visible bars, your lines, the venues.`}</span>
              {askOpen ? <ChevronUp className="mk-askdock__icon" aria-hidden /> : <ChevronDown className="mk-askdock__icon" aria-hidden />}
            </button>
            {askOpen && (
              <div className="mk-askdock__body">
                <AskChart symbol={sym} pair={pair} chartState={chartState ?? undefined} visible={viewport ? { from: viewport.from, to: viewport.to } : undefined} onAsk={act} onChartState={setLoadedState} />
              </div>
            )}
          </section>
        )}

        {/* ── Tabs ── */}
        <div className="sym__main">
          <nav ref={tabsRef} className="sym__tabs" role="tablist" aria-label="Symbol sections">
            {MARKET_TABS.map((t) => (
              <a
                key={t.tab}
                href={t.tab === DEFAULT_MARKET_TAB ? `/t/${sym}` : `/t/${sym}?tab=${t.tab}`}
                role="tab"
                aria-selected={tab === t.tab}
                className={`sym__tab ${tab === t.tab ? 'is-on' : ''}`}
                onClick={(e) => {
                  // A real link (crawlable, middle-clickable); a plain click switches in place.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                  e.preventDefault()
                  setTab(t.tab)
                }}
                data-tab={t.tab}
              >
                {t.label}
              </a>
            ))}
          </nav>
          <div className="sym__body" data-tab={tab}>
            {pair ? (
              tab === 'overview' ? (
                <OverviewTab symbol={sym} pair={pair} onAsk={onAsk} onAskText={act} last={stats?.last ?? null} />
              ) : tab === 'news' ? (
                <NewsTab symbol={sym} pair={pair} />
              ) : tab === 'community' ? (
                <CommunityTab symbol={sym} pair={pair} chartState={chartState} onAsk={onChartAsk} onLoadChart={setLoadedState} />
              ) : tab === 'technicals' ? (
                <TechnicalsTab symbol={sym} pair={pair} initialTf={initialTf} onAsk={onChartAsk} />
              ) : (
                <TradeTab symbol={sym} pair={pair} prompt={prompt} onAsk={onAsk} onAskText={act} last={stats?.last ?? null} />
              )
            ) : (
              <section className="mkt-card">
                <p className="mkt-card__title">Not charted yet.</p>
                <p className="mkt-card__note">The tabs light up once {sym} has a candle feed. Trading it in chat works today.</p>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* ── Rail: the /markets watchlist, then the symbol card pinned under it ── */}
      <MarketsSide label="Watchlist and symbol details">
        <WatchlistSlot current={sym} onAsk={onChartAsk} />
        <SymbolCardSlot symbol={sym} pair={pair} feed={feed} />
      </MarketsSide>
      {door}
    </>
  )
}
