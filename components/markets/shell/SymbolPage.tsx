'use client'

// The /t/<symbol> page FRAME (SHELL) — THE COCKPIT (2026-10-13, Nate: "the
// header area feels unprofessional and a bit claustrophobic… I want that
// chart to have a nice prominent spot… the Overview, News bar can be on top,
// one of the nav sections can be the chart just like on TradingView… I like
// B with the buy side on the right").
//
//   the strip  — ONE line: mark · name · symbol · venue (with the session
//                dot) · last · change · 24h high / low / vol / range · YOU
//                HOLD. The stats fold from the right as the column narrows
//                (markets.css, a container query on the strip's seat).
//   the tabs   — Overview · Chart · News · Community · Technicals · Trade,
//                right under the strip (`?tab=` mirrored, the #705 idiom).
//   the chart  — on Overview and on the Chart tab (the full tool set, taller);
//                the other tabs dive straight into their content. The chart
//                stays MOUNTED and parks (display: none) off those tabs, so
//                drawings, zoom and the Ask-the-chart thread survive a switch.
//   the ticket — the right column's lead on every tab (RailTicket, beside the
//                watchlist and the About card). The header's act chips and
//                their inline ticket are the phone's (hidden by CSS from the
//                rail-docking width); both are in the HTML.
//
// The chart engine lives behind components/markets/chart/ChartMount (CHART
// lane swaps the internals); the expand toggle is the same CSS takeover +
// Fullscreen API the old full-bleed page had; Compare rides beside it in the
// chart's own toolbar now (it is a chart control).

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { SymbolSearchTrigger } from '@/components/markets/search/SymbolSearch'
import ChartMount, { type ChartStats } from '@/components/markets/chart/ChartMount'
import type { ChartState } from '@/lib/chart-state'
import { CHART_FEED_LABELS, chartPairFor, chartUnitOf, isChartOnlyPair, isLookOnlyPair, type ChartFeed, type ChartTf } from '@/lib/charts'
import { fmtIndexStat, fmtIndexValue, lookOnlyBasis, lookOnlySessionLine, macroChangeOf } from '@/lib/macro'
import { fmtReadChange } from '@/lib/read'
import {
  DEFAULT_MARKET_TAB,
  MARKET_TABS,
  MARKETS_HREF,
  parseMarketTab,
  parseVsParam,
  rangePosition,
  sessionState,
  symbolName,
  symbolStanding,
  syncMarketTab,
  syncVsParam,
  venueLabel,
  type MarketTab,
} from '@/lib/markets'
import { fmtLivePrice, fmtQuotePrice, isLiveTabTitle, liveTabTitle, liveTabTitleOf, useQuotes } from '@/lib/markets-quotes'
import LookOnlyCard from '@/components/markets/shell/LookOnlyCard'
import { useDayStats } from '@/components/markets/shell/useDayStats'
import HeldPill from '@/components/markets/shell/HeldPill'
import CompareControl from '@/components/markets/shell/CompareControl'
import CallsPanel, { CalledHead } from '@/components/called/CallsPanel'
import { PlotHandleButton } from '@/components/called/HandleDoor'
import ExecStrip from '@/components/markets/slots/ExecStrip'
import AskChart from '@/components/markets/slots/AskChart'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import RailTicket from '@/components/markets/trade/RailTicket'
import OverviewTab from '@/components/markets/tabs/OverviewTab'
import NewsTab from '@/components/markets/tabs/NewsTab'
import CommunityTab from '@/components/markets/tabs/CommunityTab'
import TechnicalsTab from '@/components/markets/tabs/TechnicalsTab'
import TradeTab from '@/components/markets/tabs/TradeTab'
import { composeAsk, sideOf, type TradeAsk } from '@/lib/trade-asks'
import { ARRIVAL_APP_HREF, writeArrivalIntent } from '@/lib/arrival-intent'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useSession } from '@/lib/session'
import { useSymbolFills } from '@/lib/chart-fills'
import { askDoorNav, useAskDoor } from '@/lib/ask-door'
import { symbolAskApps, symbolAskNeedsWallet, symbolAskText } from '@/lib/symbol-ask'
import { useOrderAim } from '@/lib/order-size'
import GuideSeat from '@/components/guide/GuideSeat'
import { appScrollTop, scrollAppTo } from '@/lib/app-scroller'
import { canSellAsk } from '@/lib/sell-gate'
import { useHeld } from '@/lib/use-held'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { seedTradable } from '@/lib/tradable-read'
import type { TradabilityMap } from '@/lib/tradability'
import { useTradable } from '@/lib/use-tradable'
import type { TicketSide } from '@/lib/order-ticket'

/** Where an unknown /t/<symbol> points: one of each family. */
const UNKNOWN_SYMBOL_PICKS = ['AAPL', 'ETH', 'HYPE'] as const
const promptHref = (prompt: string) => `/chat?prompt=${encodeURIComponent(prompt)}`
/** The tabs the chart shows on; everywhere else it parks (mounted, hidden). */
export const CHART_TABS: readonly MarketTab[] = ['overview']
export const chartShowsOn = (tab: MarketTab): boolean => CHART_TABS.includes(tab)
/** The rail docks (and the ticket moves into it) from this viewport width — markets.css's breakpoint. */
const RAIL_DOCK_MIN_PX = 1024
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

type FsDoc = Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element | null }
type FsEl = HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }

export default function SymbolPage({
  symbol,
  initialTab,
  initialTf,
  initialVs = null,
  tradable: seeded,
}: {
  symbol: string
  initialTab?: MarketTab
  initialTf?: ChartTf
  initialVs?: string | null
  /** The measured venue verdicts from the server render (lib/tradability-store),
   *  so the act strip is right on the first paint. */
  tradable?: TradabilityMap
}) {
  // Idempotent, and deliberately during render — the chips below read the
  // shared store synchronously (lib/tradable-read).
  seedTradable(seeded)
  const pair = useMemo(() => chartPairFor(symbol), [symbol])
  const sym = pair?.symbol ?? symbol
  const name = symbolName(sym)
  // A LOOK-ONLY index (lib/charts isLookOnlyPair — US10Y, VIX, DXY, NDX, DJI,
  // RUT; 2026-11-09): the full chart, its frames, tools and alerts, and NO
  // order anywhere — no strip, no ticket, no Trade tab, no suggested order.
  // Its header is a QUOTE (the last against the previous session's close, in
  // the index's own unit — a yield in percent, moved in basis points), read
  // from the quotes route: the chart's own "24h" number would compare an
  // index with yesterday's same minute, which is not how one is quoted.
  const lookOnly = isLookOnlyPair(pair)
  const unit = chartUnitOf(pair)
  const { quotes: ixQuotes, failed: ixFailed, live: ixRead } = useQuotes(lookOnly ? [sym] : [])
  const ix = lookOnly ? (ixQuotes[sym] ?? null) : null
  // The chart's header numbers, keyed to the symbol they were read for: a
  // new symbol starts with none, so the strip and the tab never wear the
  // last symbol's price while its chart fetches (2026-10-20).
  const [statsFor, setStatsFor] = useState<{ sym: string; stats: ChartStats } | null>(null)
  const stats = statsFor?.sym === sym ? statsFor.stats : null
  const setStats = useCallback((s: ChartStats) => setStatsFor({ sym, stats: s }), [sym])
  // The header's "loading … candles" never ended when the feed failed (pre-gtm
  // POLISH r3): after 12s with no stats it says the feed didn't answer.
  const [statsLate, setStatsLate] = useState(false)
  useEffect(() => {
    setStatsLate(false)
    if (stats) return
    const t = setTimeout(() => setStatsLate(true), 12_000)
    return () => clearTimeout(t)
  }, [sym, stats])
  // THE PRICE IN THE TAB (2026-10-20, Nate: "add the price into the title
  // bar like Coinbase does"): once the chart has a last, the tab reads
  // `$7.1329 · UNI · Pantessa` and follows every print the header shows
  // (same formatter, same decimals). The server's SEO title stays what
  // crawlers and the first paint get; leaving the page hands the title back.
  const liveLast = stats?.last ?? null
  // An index or a level (the S&P 500 in points, an FX rate) is not a dollar
  // price: its tab reads the value as its header prints it (`4.837% · US10Y`).
  const unitTitle = !pair || unit === 'usd' ? null : lookOnly ? (ix ? fmtIndexValue(pair, ix.last) : liveLast != null && liveLast > 0 ? fmtIndexValue(pair, liveLast) : null) : liveLast != null && liveLast > 0 ? fmtLivePrice(liveLast) : null
  // The page's own (SEO) title, whatever React's metadata last wrote: on a
  // soft navigation that write can land AFTER the first live price, so the
  // head is watched and a live title re-asserted over it (React writes its
  // title only when the route's metadata changes — no loop).
  const baseTitleRef = useRef<string | null>(null)
  useEffect(() => {
    const title = unit === 'usd' ? liveTabTitle(sym, liveLast) : liveTabTitleOf(sym, unitTitle)
    if (!title) return
    const assert = () => {
      if (!isLiveTabTitle(document.title)) baseTitleRef.current = document.title
      if (document.title !== title) document.title = title
    }
    assert()
    const mo = new MutationObserver(assert)
    mo.observe(document.head, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [sym, liveLast, unit, unitTitle])
  useEffect(() => () => {
    if (isLiveTabTitle(document.title) && baseTitleRef.current) document.title = baseTitleRef.current
  }, [])
  const [expanded, setExpanded] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)

  // ── Tabs: URL → state on arrival + back/forward; state → URL on change ──
  // A look-only index has no Trade tab (nothing to route, compose or hold):
  // an address that names it opens on Overview, like any tab the page lacks.
  const tabFor = useCallback((t: MarketTab): MarketTab => (lookOnly && t === 'trade' ? DEFAULT_MARKET_TAB : t), [lookOnly])
  const [tab, setTab] = useState<MarketTab>(tabFor(initialTab ?? DEFAULT_MARKET_TAB))
  const mirroredRef = useRef(false)
  useEffect(() => {
    setTab(tabFor(parseMarketTab(window.location.search)))
    const onPop = () => setTab(tabFor(parseMarketTab(window.location.search)))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [tabFor])
  useEffect(() => {
    // First run: the URL is already the truth (we just read it).
    if (!mirroredRef.current) {
      mirroredRef.current = true
      return
    }
    syncMarketTab(tab)
  }, [tab])
  const showChart = chartShowsOn(tab)
  // Lines loaded onto the chart (a post's, Ask the chart's) bring a chart tab
  // back first: the chart parks off Overview.
  const showAChartTab = useCallback(() => setTab((t) => (chartShowsOn(t) ? t : 'overview')), [])

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
  const hasPair = !!pair
  // No chart AND no token by that name (a typo, a ticker we don't carry):
  // the page offers search, never a Buy chip that would end in a refusal.
  const unknown = symbolStanding(sym) === 'unknown'
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
  // The floating ask pill steps aside while this cockpit is on screen: the
  // right column carries the ⌘K trigger and the ticket's own ask row
  // (markets.css hides the pill from the rail-docking width on this flag).
  useEffect(() => {
    if (!hasPair) return
    document.documentElement.setAttribute('data-sym-cockpit', '')
    return () => document.documentElement.removeAttribute('data-sym-cockpit')
  }, [hasPair])

  // ── The send door: every ask on the page runs in the app ──
  // (2026-09-16, Nate: "Buy AMAT goes nowhere… should it open the app page
  // with the prompt fire?") The build used to land in a panel at the foot
  // of the Trade tab, below the order form, the composer and the position
  // panel, so a chip click scrolled to the tab strip and looked dead. Now
  // the tap is the SEND the /markets chips already are: the ask travels out
  // of band (lib/arrival-intent: same tab, 60s, one shot) and /chat fires it
  // on arrival with the apps it needs. A fenced ask or no storage falls back
  // to the `?prompt=` prefill, and a URL still never fires a turn.
  // (2026-11-16, Nate on /t/AAPL: "let's not direct AI chat buys or questions
  // to an embed, let's send them to the app page and make sure to add the
  // correct MCPs".) The order ticket, the rail's say row and the ⌘K door had
  // been building in a chat runtime docked under the chart since 09-24; they
  // take this door too now, and the handoff NAMES its apps: the sentence's
  // own plus the venue that trades this symbol (lib/symbol-ask), with any a
  // caller asked for (a wallet flag's bridge leg).
  const router = useRouter()
  const pathname = usePathname()
  const tabsRef = useRef<HTMLElement | null>(null)
  const callerAppsRef = useRef<Map<string, string[]>>(new Map())
  const runAsk = useCallback(
    (ask: string) => {
      const extra = callerAppsRef.current.get(ask) ?? []
      callerAppsRef.current.delete(ask)
      const handed = writeArrivalIntent({ text: ask, from: pathname ?? '', mcps: symbolAskApps(ask, pair, extra) })
      router.push(handed ? ARRIVAL_APP_HREF : promptHref(ask))
    },
    [pathname, router, pair],
  )
  // Looking needs no wallet; acting does (2026-09-14, Nate: "only on an
  // action item 'buy $10 of APPLE'"). Every ask on the page comes through
  // here: the header chips, the Trade panel's Send, a chart level, a verdict
  // chip, a post, the watchlist. A connected wallet runs it now; a visitor
  // with none gets the connect door, and the ask runs once a wallet lands
  // (lib/use-connect-to-act).
  const { act, door } = useConnectToAct({ run: runAsk, redirectFor: promptHref })
  const onAsk = useCallback((a: TradeAsk) => act(a.ask), [act])
  // The order ticket's send: a SIZED sentence runs in the app like every chip
  // (it built in a runtime docked under the chart from 10-06 to 11-16).
  const orderToApp = act
  // Anything SAID on the page (the rail's ask row, the ⌘K door's composer and
  // chips, a surface that hands the door an ask to run): a chart or markets
  // ask is a navigation; a question travels without a wallet (looking needs
  // none) and names its symbol; a trade goes through the connect door.
  const sayToApp = useCallback(
    (text: string, opts?: { mcps?: string[] }) => {
      const said = text.trim()
      if (!said) return
      const nav = askDoorNav(said)
      if (nav) {
        router.push(nav)
        return
      }
      const ask = symbolAskText(said, pair)
      if (opts?.mcps?.length) callerAppsRef.current.set(ask, opts.mcps)
      if (symbolAskNeedsWallet(ask)) act(ask)
      else runAsk(ask)
    },
    [act, runAsk, router, pair],
  )
  // The page takes the ⌘K door's sends (lib/ask-door `handoff`): the sheet
  // still opens here as a composer with this symbol's chips, and what it
  // sends runs in the app, never in a chat runtime over the chart.
  useEffect(() => {
    useAskDoor.getState().setHandoff(sayToApp)
    return () => useAskDoor.getState().setHandoff(null)
  }, [sayToApp])
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
  // The Depth chart's act (2026-10-13): a level clicked aims the page's
  // ticket — the rail's on a desktop, the header strip's on a phone — at a
  // limit order resting at that price (lib/order-size useOrderAim).
  const onLimit = useCallback((side: 'buy' | 'sell', price: number) => useOrderAim.getState().setAim({ symbol: sym, side, limitPrice: price, at: Date.now() }), [sym])
  // The live drawings (for "attach my current chart" on a post) and a post's
  // lines loaded back onto the chart ("copy these lines to my chart").
  const [chartState, setChartState] = useState<ChartState | null>(null)
  const [loadedState, setLoadedState] = useState<ChartState | null>(null)
  // A post's lines loaded back onto the chart show the chart.
  const loadChart = useCallback(
    (s: ChartState) => {
      setLoadedState(s)
      showAChartTab()
    },
    [showAChartTab],
  )
  // The connected wallet's own fills on this symbol (VIZ's glyphs + receipt
  // legend under the chart). Public by address; no wallet → no read.
  const { walletAddress } = useSession()
  const serverFills = useSymbolFills(sym, walletAddress)
  // (Until 2026-11-16 a trade signed in Ask the chart's inline ticket was
  // merged in here at once; trades run in the app now, and the fills read
  // lists them when the visitor comes back.)
  const fills = serverFills
  // A chartless token's Sell chip waits on the same rule as every other Sell
  // (lib/sell-gate): the wallet has to hold it.
  const held = useHeld()
  const tradable = useTradable()
  const fallbackSell = `Sell $50 of ${sym}`
  // What's on screen (VIZ's onViewport, bar open times) — AskChart's context.
  const [viewport, setViewport] = useState<{ from: number; to: number; tf: ChartTf } | null>(null)
  // The right column's ticket: the side the page wants shown (YOU HOLD aims
  // Sell); null = the lead side. Resets per symbol.
  const [railSide, setRailSide] = useState<TicketSide | null>(null)
  useEffect(() => setRailSide(null), [sym])
  const onHeld = useCallback(() => {
    setRailSide('sell')
    // No rail on a phone: the Trade tab carries the position and its Sell.
    if (window.innerWidth < RAIL_DOCK_MIN_PX) setTab('trade')
  }, [])

  // ── Session line ticks (a stock page left open crosses the bell) ──
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const session = sessionState(pair, now)
  // 24h stats (hourly series) for the strip: high · low · vol · the range bar.
  // Not for an index: its strip states the SESSION (the previous close and
  // the day's range, from its quote) — "the last 24 hours" is mostly closed.
  const day = useDayStats(pair && !lookOnly ? pair.symbol : null)
  const rangeAt = rangePosition(day?.low, day?.high, stats?.last)
  // The index's own header numbers, each in its unit.
  const ixChange = lookOnly ? macroChangeOf({ unit }, ix) : null
  const ixTone = ixChange === null ? 'mkt-chg--flat' : ixChange > 0 ? 'mkt-chg--up' : ixChange < 0 ? 'mkt-chg--down' : 'mkt-chg--flat'
  const ixRangeAt = ix ? rangePosition(ix.dayLow, ix.dayHigh, ix.last) : null
  const ixSessionLine = lookOnlySessionLine(ix?.session ?? null)

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
  // An index's dot follows its own last print (the quote's session); with no quote yet it shows none.
  const tapeState = lookOnly ? (ix?.session === 'open' ? 'open' : ix?.session === 'closed' ? 'closed' : 'none') : session.tape ? (session.tape.open ? 'open' : 'closed') : 'none'
  // The dollar sign a price wears: none for a level (the S&P 500 in points, an FX rate).
  const px = unit === 'usd' ? '$' : ''

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
  // Compare is a chart control: it rides the chart's own bar, beside the
  // expand toggle (it used to be a header pill).
  // So is CALLED IT's door ("Plot a handle"): an X handle's calls pinned on this chart.
  const chartControls = (
    <>
      {pair && <PlotHandleButton symbol={sym} />}
      {pair && <CompareControl symbol={sym} vs={vs} onChange={setVs} />}
      {expandButton}
    </>
  )

  // Two grid items for the page's .mkt-frame (the /markets frame): the symbol
  // column and the right column (ticket · watchlist · About), docked right
  // from the nav down.
  return (
    <>
      <main className="sym sym--cockpit" data-symbol={sym} data-vs={vs ?? undefined} data-tab={tab} data-chart={showChart ? 'shown' : 'parked'}>
        {/* ── The strip ── (its seat is the size container the folds read,
            markets.css: an element can't query itself, and .sym must stay a
            plain block for the full-screen chart) */}
        <div className="sym__headseat sym__stripseat">
          <header className="sym__head sym__strip" data-seat="strip">
            <div className="sym__id">
              <TokenIcon symbol={sym} size={32} {...markWhere} />
              <div className="sym__idtext min-w-0">
                <div className="sym__titlerow">
                  <h1 className="sym__name truncate">{name}</h1>
                  <span className="sym__sym mono">{sym}</span>
                  <SymbolSearchTrigger variant="head" />
                </div>
                <div className="sym__meta">
                  {lookOnly ? (
                    // An index: the dot and the tail follow its own last print (trading, delayed — or closed on its last session).
                    <span className="sym__venue mono" data-tape={tapeState} data-look-only="" title={ixSessionLine}>
                      <span className={`mk-dot${tapeState === 'open' ? ' mk-dot--open' : tapeState === 'closed' ? ' mk-dot--closed' : ''}`} aria-hidden />
                      {venueLabel(pair)}
                      <span className="sym__venue-tail">{tapeState === 'closed' ? ' · closed' : ' · delayed'}</span>
                    </span>
                  ) : (
                  <span className="sym__venue mono" data-tape={tapeState} title={unknown ? undefined : session.line}>
                    <span className={`mk-dot${session.tape ? (session.tape.open ? ' mk-dot--open' : ' mk-dot--closed') : ' mk-dot--always'}`} aria-hidden />
                    {unknown ? 'Not listed' : venueLabel(pair)}
                    {pair && !unknown && <span className="sym__venue-tail">{session.tape ? (session.tape.open ? ' · open' : ' · closed') : ' · 24/7'}</span>}
                  </span>
                  )}
                  {/* The session line in full — the words a reader and the harness get; the strip shows the dot + venue. */}
                  <p className="sym__session mono sr-only" data-tape={tapeState}>
                    {unknown ? 'Not a ticker we carry' : lookOnly ? ixSessionLine : session.line}
                  </p>
                </div>
              </div>
            </div>
            <span className="sym__sep" aria-hidden />
            <div className="sym__quote">
              {lookOnly && pair ? (
                // An index: the quote, in its own unit, against the previous session's close.
                ix ? (
                  <>
                    <span className="sym__last mono" data-unit={unit}>{fmtIndexValue(pair, ix.last)}</span>
                    <span className={`sym__chg mono mkt-chg ${ixTone}`}>
                      {fmtReadChange({ unit }, ixChange)} {lookOnlyBasis(ix.session)}
                    </span>
                    <span className="sym__feed mono">delayed</span>
                  </>
                ) : (ixRead || ixFailed) && stats?.last != null ? (
                  // The quote did not come (the host stated no previous close, or did not answer) but the
                  // chart has bars: the last bar's value alone — a change that cannot be stated is not shown.
                  <>
                    <span className="sym__last mono" data-unit={unit}>{fmtIndexValue(pair, stats.last)}</span>
                    <span className="sym__feed mono">delayed</span>
                  </>
                ) : (
                  <span className="sym__feed mono">{ixFailed || statsLate ? 'Index data didn’t answer · retrying' : 'loading index data…'}</span>
                )
              ) : pair && stats?.last != null ? (
                <>
                  {unit === 'level' ? <span className="sym__last mono" data-unit="level">{fmtLivePrice(stats.last)}</span> : <span className="sym__last mono">${fmtLivePrice(stats.last)}</span>}
                  <span className={`sym__chg mono mkt-chg ${chgClass}`}>{chgLabel}</span>
                  <span className="sym__feed mono">{feedLabel}</span>
                </>
              ) : pair ? (
                <span className="sym__feed mono">{statsLate ? `${feedLabel} didn’t answer · retrying` : `loading ${feedLabel} candles…`}</span>
              ) : unknown ? null : (
                // An unknown ticker already wears "Not listed" in the title row;
                // a second copy in the quote slot read as a stutter (POLISH, pre-gtm r1).
                <span className="sym__feed mono">No live chart yet</span>
              )}
            </div>
            {pair && day && (
              <div className="sym__stats" aria-label="Last 24 hours">
                <span className="sym__sep" aria-hidden />
                <div className="sym__st sym__st--hi">
                  <span className="sym__st-k mono">24H HIGH</span>
                  <span className="sym__st-v mono">{px}{fmtQuotePrice(day.high)}</span>
                </div>
                <div className="sym__st sym__st--lo">
                  <span className="sym__st-k mono">24H LOW</span>
                  <span className="sym__st-v mono">{px}{fmtQuotePrice(day.low)}</span>
                </div>
                {day.volume > 0 && (
                  <div className="sym__st sym__st--vol">
                    <span className="sym__st-k mono">24H VOL</span>
                    <span className="sym__st-v mono">
                      {compactNumber.format(day.volume)} {sym}
                    </span>
                  </div>
                )}
                {rangeAt !== null && (
                  <div className="sym__st sym__st--range">
                    <div className="mk-range" data-range-at={rangeAt.toFixed(3)} title={`24h range: ${px}${fmtQuotePrice(day.low)} – ${px}${fmtQuotePrice(day.high)}`}>
                      <span className="mk-range__lo mono">{px}{fmtQuotePrice(day.low)}</span>
                      <span className="mk-range__bar" aria-hidden>
                        <span className="mk-range__fill" style={{ width: `${(rangeAt * 100).toFixed(1)}%` }} />
                        <span className="mk-range__tick" style={{ left: `${(rangeAt * 100).toFixed(1)}%` }} />
                      </span>
                      <span className="mk-range__hi mono">{px}{fmtQuotePrice(day.high)}</span>
                      <span className="mk-range__k mono">24H RANGE</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* An index's strip: the previous close and the session's own range (its quote's numbers). No volume: an index has none to state. */}
            {lookOnly && pair && ix && (
              <div className="sym__stats" aria-label="This session" data-look-only="">
                <span className="sym__sep" aria-hidden />
                {ix.prevClose != null && (
                  <div className="sym__st sym__st--hi">
                    <span className="sym__st-k mono">PREV CLOSE</span>
                    <span className="sym__st-v mono">{fmtIndexStat(pair, ix.prevClose)}</span>
                  </div>
                )}
                {ix.dayHigh != null && ix.dayLow != null && (
                  <>
                    <div className="sym__st sym__st--hi">
                      <span className="sym__st-k mono">DAY HIGH</span>
                      <span className="sym__st-v mono">{fmtIndexStat(pair, ix.dayHigh)}</span>
                    </div>
                    <div className="sym__st sym__st--lo">
                      <span className="sym__st-k mono">DAY LOW</span>
                      <span className="sym__st-v mono">{fmtIndexStat(pair, ix.dayLow)}</span>
                    </div>
                    {ixRangeAt !== null && (
                      <div className="sym__st sym__st--range">
                        <div className="mk-range" data-range-at={ixRangeAt.toFixed(3)} title={`Day range: ${fmtIndexStat(pair, ix.dayLow)} – ${fmtIndexStat(pair, ix.dayHigh)}`}>
                          <span className="mk-range__lo mono">{fmtIndexStat(pair, ix.dayLow)}</span>
                          <span className="mk-range__bar" aria-hidden>
                            <span className="mk-range__fill" style={{ width: `${(ixRangeAt * 100).toFixed(1)}%` }} />
                            <span className="mk-range__tick" style={{ left: `${(ixRangeAt * 100).toFixed(1)}%` }} />
                          </span>
                          <span className="mk-range__hi mono">{fmtIndexStat(pair, ix.dayHigh)}</span>
                          <span className="mk-range__k mono">DAY RANGE</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <span className="sym__grow" aria-hidden />
            {pair && <HeldPill symbol={sym} last={stats?.last ?? null} onClick={onHeld} />}
          </header>
        </div>

        {/* ── Tabs, right under the strip. The nav is a direct child of .sym so
            its phone-side sticky range is the whole column; the zero-height
            sentinel before it marks where it sits when unstuck. ── */}
        <span className="sym__navtop" aria-hidden />
        <nav ref={tabsRef} className="sym__tabs" role="tablist" aria-label="Symbol sections" style={unknown ? { display: 'none' } : undefined}>
            {MARKET_TABS.filter((t) => !(lookOnly && t.tab === 'trade')).map((t) => (
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
                  // On a phone the strip sticks under the top bar (markets.css):
                  // a switch made while it's stuck lands the new tab at its own
                  // top, the way a native tab strip does, instead of mid-body.
                  // scrollIntoView on a STUCK sticky is a no-op (its box already
                  // sits at the line), so scroll by where the strip would be
                  // unstuck: the sentinel right before it (.sym__navtop).
                  requestAnimationFrame(() => {
                    const el = tabsRef.current
                    const mark = el?.previousElementSibling
                    if (!el || !mark) return
                    const cs = getComputedStyle(el)
                    if (cs.position !== 'sticky') return
                    const stuckAt = parseFloat(cs.top) || 0
                    const natural = mark.getBoundingClientRect().top
                    if (natural < stuckAt - 1) scrollAppTo(appScrollTop() + natural - stuckAt)
                  })
                }}
                data-tab={t.tab}
              >
                {t.label}
              </a>
            ))}
          </nav>

        {/* The act row: EXEC's ExecStrip in a MARKETS-owned seat (the seat is
            what the harness pins; the slot's body is theirs). THE PHONE's chips
            + ticket: hidden by markets.css from the rail-docking width, where
            the right column's ticket takes over. */}
        {pair && (
          <div className="sym__exec" data-seat="ExecStrip">
            <ExecStrip symbol={sym} pair={pair} onAsk={act} onBuild={orderToApp} last={stats?.last ?? null} autoOpen={false} />
          </div>
        )}
        {/* The guide's one hint card: under the chips on a phone, right under
            the tabs on a desktop (where the chips hide). */}
        {pair && <GuideSeat surface="symbol" symbol={sym} ask={isChartOnlyPair(pair) || lookOnly ? null : composeAsk(pair, 'buy', { usd: 25 })} chartOnly={isChartOnlyPair(pair)} lookOnly={lookOnly} />}

        {/* ── CALLED IT: who is plotted and their tally, as a band joined to the top of the chart card (nothing until a handle is plotted); parks with it ── */}
        {pair && <CalledHead symbol={sym} parked={!showChart} />}

        {/* ── Chart: always mounted; shown on Overview + Chart, parked elsewhere ── */}
        <div ref={shellRef} className={`tchart sym__chart${expanded ? ' tchart--expanded' : ''}${showChart ? '' : ' is-parked'}`} data-chart-tab={tab} aria-hidden={showChart ? undefined : true}>
          <div className="tchart__canvas">
            {pair ? (
              <ChartMount symbol={sym} height="fill" defaultTf={initialTf} urlTf onStats={setStats} controlsRight={chartControls} resizeKey={`${expanded}:${showChart}`} onAsk={onChartAsk} state={loadedState} onStateChange={setChartState} onViewport={setViewport} compare={vs} fills={fills} battlefield onLimit={onLimit} advanced />
            ) : unknown ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="mkt-card max-w-md text-center" data-standing="unknown">
                  <p className="mkt-card__title">We don&rsquo;t list {sym || 'that symbol'}.</p>
                  <p className="mkt-card__note">
                    Nothing here trades under that ticker. Check the spelling, or search by company or coin name: stocks, coins and perps are all on
                    the markets page.
                  </p>
                  <div className="mkt-chips mt-3 justify-center">
                    <Link href={MARKETS_HREF} className="mkt-chip mkt-chip--buy">
                      Search markets
                    </Link>
                    {UNKNOWN_SYMBOL_PICKS.map((s) => (
                      <Link key={s} href={`/t/${s}`} className="mkt-chip">
                        {s}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="mkt-card max-w-md text-center">
                  <p className="mkt-card__title">No live chart for {sym || 'this token'} yet.</p>
                  <p className="mkt-card__note">
                    Stablecoins chart flat by design, and a listing without a candle feed stays honest here. You can still act on it in chat — one
                    sentence, guarded, signed only by your wallet.
                  </p>
                  <div className="mkt-chips mt-3 justify-center">
                    {canTradeAsk(`Buy $50 of ${sym}`, tradable) && (
                      <Link href={promptHref(`Buy $50 of ${sym}`)} className="mkt-chip mkt-chip--buy" onClick={sendOnClick(`Buy $50 of ${sym}`)}>
                        Buy {sym}
                      </Link>
                    )}
                    {canSellAsk(fallbackSell, held) && canTradeAsk(fallbackSell, tradable) && (
                      <Link href={promptHref(fallbackSell)} className="mkt-chip" onClick={sendOnClick(fallbackSell)}>
                        Sell {sym}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── CALLED IT: the plotted handle's calls, right under the chart they are pinned on (nothing until a handle is plotted); parks with it ── */}
        {pair && <CallsPanel symbol={sym} parked={!showChart} />}

        {/* A look-only index, on a PHONE: the chart leads, and right under it the page says it is here to read
            and names the closest thing listed (a desktop carries the same card in the rail, where the ticket
            would be — markets' look-only.css shows one per posture). It parks with the chart. */}
        {pair && lookOnly && showChart && <LookOnlyCard pair={pair} seat="page" onAsk={orderToApp} />}

        {/* ── Ask the chart (AI's AskChart slot), docked under the chart; parks with it ── */}
        {pair && (
          <section className={`mk-askdock${askOpen ? ' is-open' : ''}${showChart ? '' : ' is-parked'}`} data-askchart={askOpen ? 'open' : 'closed'} aria-label="Ask about this chart" aria-hidden={showChart ? undefined : true}>
            <button type="button" className="mk-askdock__bar" onClick={toggleAsk} aria-expanded={askOpen}>
              <span className="mk-askdock__k mono">ASK THE CHART</span>
              <span className="mk-askdock__hint">
                {lookOnly
                  ? askOpen
                    ? 'What is on screen is the context. An index is here to read: the answer draws on the chart.'
                    : `Ask about ${sym}: the answer draws on the chart. Nothing here places an order on an index.`
                  : askOpen
                    ? 'What is on screen is the context. A trade you say opens in the app.'
                    : `Ask about the ${sym} chart: draw a line, set an alert, read a bar. A trade opens in the app.`}
              </span>
              {askOpen ? <ChevronUp className="mk-askdock__icon" aria-hidden /> : <ChevronDown className="mk-askdock__icon" aria-hidden />}
            </button>
            {askOpen && (
              <div className="mk-askdock__body">
                <AskChart symbol={sym} pair={pair} chartState={chartState ?? undefined} visible={viewport ? { from: viewport.from, to: viewport.to } : undefined} onAsk={act} onChartState={loadChart} />
              </div>
            )}
          </section>
        )}

        {/* ── The tab's body ── */}
        <div className="sym__main">
          <div className="sym__body" data-tab={tab}>
            {pair ? (
              tab === 'overview' ? (
                <OverviewTab symbol={sym} pair={pair} onAsk={onAsk} onAskText={act} last={stats?.last ?? null} />
              ) : tab === 'news' ? (
                <NewsTab symbol={sym} pair={pair} onShowChart={showAChartTab} />
              ) : tab === 'community' ? (
                <CommunityTab symbol={sym} pair={pair} chartState={chartState} onAsk={onChartAsk} onLoadChart={loadChart} />
              ) : tab === 'technicals' ? (
                <TechnicalsTab symbol={sym} pair={pair} initialTf={initialTf} onAsk={onChartAsk} />
              ) : (
                <TradeTab symbol={sym} pair={pair} onAsk={onAsk} onAskText={act} last={stats?.last ?? null} />
              )
            ) : unknown ? null : (
              <section className="mkt-card">
                <p className="mkt-card__title">Not charted yet.</p>
                <p className="mkt-card__note">The tabs light up once {sym} has a candle feed. Trading it in chat works today.</p>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* ── The right column: the ticket leads, the watchlist follows. The About card that used to sit under
          the watchlist is gone (2026-10-13, Nate: "takes up too much room"); alerts live behind the strip's bell. ── */}
      <MarketsSide label="Order ticket and watchlist">
        {pair && !unknown && <RailTicket symbol={sym} pair={pair} last={stats?.last ?? null} side={railSide} onSide={setRailSide} onBuild={orderToApp} onSay={sayToApp} />}
        <WatchlistSlot current={unknown ? undefined : sym} onAsk={onChartAsk} />
      </MarketsSide>
      {door}
    </>
  )
}
