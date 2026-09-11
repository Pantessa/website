'use client'

// The /t/<symbol> page FRAME (SHELL): header (mark · name · symbol · venue
// chip · last · change · session line) → the chart (always mounted, above
// the tabs — the chart is the order form, so it never disappears while you
// trade) → the tab strip Overview · News · Community · Technicals · Trade
// (`?tab=` mirrored via replaceState, the #705 idiom) → the tab's body,
// beside a right rail (watchlist slot + symbol card) on ≥1024px, stacked
// below it at 375px.
//
// The chart engine lives behind components/markets/chart/ChartMount (CHART
// lane swaps the internals); the expand toggle is the same CSS takeover +
// Fullscreen API the old full-bleed page had.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Maximize2, Minimize2 } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import ChartMount, { type ChartStats } from '@/components/markets/chart/ChartMount'
import type { ChartState } from '@/lib/chart-state'
import { fmtPrice } from '@/components/CandleChart'
import { CHART_FEED_LABELS, chartPairFor, type ChartFeed, type ChartTf } from '@/lib/charts'
import {
  DEFAULT_MARKET_TAB,
  MARKET_TABS,
  parseMarketTab,
  sessionState,
  symbolName,
  syncMarketTab,
  venueLabel,
  type MarketTab,
} from '@/lib/markets'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'
import SymbolCardSlot from '@/components/markets/shell/SymbolCardSlot'
import OverviewTab from '@/components/markets/tabs/OverviewTab'
import NewsTab from '@/components/markets/tabs/NewsTab'
import CommunityTab from '@/components/markets/tabs/CommunityTab'
import TechnicalsTab from '@/components/markets/tabs/TechnicalsTab'
import TradeTab, { sideOf, type InjectedPrompt, type TradeAsk } from '@/components/markets/tabs/TradeTab'

const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`

type FsDoc = Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element | null }
type FsEl = HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }

export default function SymbolPage({ symbol, initialTab, initialTf }: { symbol: string; initialTab?: MarketTab; initialTf?: ChartTf }) {
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

  // ── The send door: a chip anywhere on the page lands on Trade and fires ──
  const [prompt, setPrompt] = useState<InjectedPrompt | null>(null)
  const onAsk = useCallback((a: TradeAsk) => {
    setPrompt({ text: a.ask, send: true, at: Date.now() })
    setTab('trade')
  }, [])
  // A drawn level on the chart carries a bare ask string — same door.
  const onChartAsk = useCallback((ask: string) => onAsk({ side: sideOf(ask), label: ask, ask }), [onAsk])
  // The live drawings (for "attach my current chart" on a post) and a post's
  // lines loaded back onto the chart ("copy these lines to my chart").
  const [chartState, setChartState] = useState<ChartState | null>(null)
  const [loadedState, setLoadedState] = useState<ChartState | null>(null)

  // ── Session line ticks (a stock page left open crosses the bell) ──
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const session = sessionState(pair, now)

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

  return (
    <div className="sym" data-symbol={sym}>
      {/* ── Header ── */}
      <header className="sym__head">
        <div className="sym__id">
          <TokenIcon symbol={sym} size={40} {...markWhere} />
          <div className="min-w-0">
            <div className="sym__titlerow">
              <h1 className="sym__name truncate">{name}</h1>
              <span className="sym__sym mono">{sym}</span>
              <span className="sym__venue mono">{venueLabel(pair)}</span>
            </div>
            <p className="sym__session mono">{session.line}</p>
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
        </div>
      </header>

      {/* ── Chart (always mounted; the tabs never unmount it) ── */}
      <div ref={shellRef} className={expanded ? 'tchart sym__chart tchart--expanded' : 'tchart sym__chart'}>
        <div className="tchart__canvas">
          {pair ? (
            <ChartMount symbol={sym} height="fill" onStats={setStats} controlsRight={expandButton} resizeKey={expanded} onAsk={onChartAsk} state={loadedState} onStateChange={setChartState} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="mkt-card max-w-md text-center">
                <p className="mkt-card__title">No live chart for {sym || 'this token'} yet.</p>
                <p className="mkt-card__note">
                  Stablecoins chart flat by design, and a listing without a candle feed stays honest here. You can still act on it in chat — one
                  sentence, guarded, signed only by your wallet.
                </p>
                <div className="mkt-chips mt-3 justify-center">
                  <Link href={promptHref(`Buy $50 of ${sym}`)} className="mkt-chip mkt-chip--buy">
                    Buy {sym}
                  </Link>
                  <Link href={promptHref(`Sell $50 of ${sym}`)} className="mkt-chip">
                    Sell {sym}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs + rail ── */}
      <div className="sym__grid">
        <div className="sym__main">
          <nav className="sym__tabs" role="tablist" aria-label="Symbol sections">
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
                <OverviewTab symbol={sym} pair={pair} onAsk={onAsk} />
              ) : tab === 'news' ? (
                <NewsTab symbol={sym} pair={pair} />
              ) : tab === 'community' ? (
                <CommunityTab symbol={sym} pair={pair} chartState={chartState} onAsk={onChartAsk} onLoadChart={setLoadedState} />
              ) : tab === 'technicals' ? (
                <TechnicalsTab symbol={sym} pair={pair} initialTf={initialTf} />
              ) : (
                <TradeTab symbol={sym} pair={pair} prompt={prompt} onAsk={onAsk} />
              )
            ) : (
              <section className="mkt-card">
                <p className="mkt-card__title">Not charted yet.</p>
                <p className="mkt-card__note">The tabs light up once {sym} has a candle feed. Trading it in chat works today.</p>
              </section>
            )}
          </div>
        </div>
        <aside className="sym__rail" aria-label="Watchlist and symbol details">
          <WatchlistSlot current={sym} onAsk={onChartAsk} />
          <SymbolCardSlot symbol={sym} pair={pair} feed={feed} />
        </aside>
      </div>
    </div>
  )
}
