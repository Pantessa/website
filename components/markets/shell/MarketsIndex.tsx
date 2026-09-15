'use client'

// /markets — the index (SHELL), laid out like a trading terminal in full
// screen (2026-09-11, Nate: "similar to trading view full screen mode, no
// need for a header or tag"). No hero: the market data scrolls in the main
// column under a sticky tool strip (search + board tabs) while the watchlist
// stays docked on the right at full viewport height (≥1024px; below that it
// drops into the flow under the boards).
//
// MK2 (2026-09-15): the boards are terminal TABLES (sortable, j/k/Enter),
// the movers tape rides under the tool strip, the whole index can flip to
// VIZ's MarketMap (Map · List, remembered per browser), and "Trending on
// Pantessa" leads with what strangers actually asked about this week
// (fenced server read, app/markets/trending.ts). Every row is a link to the
// symbol page; numbers come from the quotes hook and read as dashes until a
// feed answers. Long boards fold behind "show all".

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LayoutGrid, Rows3 } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import {
  DEFAULT_MARKETS_VIEW,
  MARKETS_VIEW_KEY,
  marketSections,
  parseMarketsView,
  symbolName,
  type MarketSection,
  type MarketSectionId,
  type MarketsView,
} from '@/lib/markets'
import { chgClass, fmtPct, fmtQuotePrice, useQuotes } from '@/lib/markets-quotes'
import MarketTable from '@/components/markets/shell/MarketTable'
import TickerSearch from '@/components/markets/shell/TickerSearch'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'
import MarketsSide from '@/components/markets/shell/MarketsSide'
import SessionStrip from '@/components/markets/shell/SessionStrip'
import MoversTape from '@/components/markets/slots/MoversTape'
import MarketMap from '@/components/markets/slots/MarketMap'
import type { TrendingRow } from '@/app/markets/trending'

// Rows before "show all" — a folded board leads with the household names.
const FOLD_AT = 24

const TAB_LABELS: Readonly<Record<MarketSectionId, string>> = {
  equities: 'Equities',
  crypto: 'Crypto',
  perps: 'Perps',
}

function Board({ section }: { section: MarketSection }) {
  const [open, setOpen] = useState(false)
  const rows = open ? section.rows : section.rows.slice(0, FOLD_AT)
  const { quotes } = useQuotes(rows.map((r) => r.symbol))
  return (
    <section className="mkt-sec" id={section.id} aria-label={section.title}>
      <header className="mkt-sec__head">
        <div>
          <h2 className="mkt-sec__title">{section.title}</h2>
          <p className="mkt-sec__blurb">{section.blurb}</p>
        </div>
        <span className="mkt-sec__count mono">{section.rows.length} LISTED</span>
      </header>
      <div className="mk-board">
        <MarketTable rows={rows} quotes={quotes} section={section.id} />
      </div>
      {section.rows.length > FOLD_AT && (
        <button type="button" className="mkt-sec__more mono" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'SHOW FEWER' : `SHOW ALL ${section.rows.length}`}
        </button>
      )}
    </section>
  )
}

/** "Trending on Pantessa" — most-asked symbols this week, fenced upstream. */
function Trending({ rows }: { rows: TrendingRow[] }) {
  const { quotes } = useQuotes(rows.map((r) => r.symbol))
  if (rows.length === 0) return null
  return (
    <section className="mk-trend" aria-label="Trending on Pantessa" data-trending={rows.length}>
      <header className="mk-trend__head">
        <h2 className="mk-trend__title">Trending on Pantessa</h2>
        <span className="mk-trend__eyebrow mono">MOST ASKED · 7 DAYS · STRANGERS ONLY</span>
      </header>
      <ol className="mk-trend__list">
        {rows.map((r, i) => {
          const q = quotes[r.symbol]
          return (
            <li key={r.symbol}>
              <Link href={`/t/${r.symbol}`} className="mk-trend__row" data-symbol={r.symbol} data-mk-row>
                <span className="mk-trend__rank mono">{String(i + 1).padStart(2, '0')}</span>
                <TokenIcon symbol={r.symbol} size={22} />
                <span className="mk-trend__id">
                  <span className="mono mk-trend__sym">{r.symbol}</span>
                  <span className="mk-trend__name">{symbolName(r.symbol)}</span>
                </span>
                <span className={`mk-trend__chg mono mkt-chg ${chgClass(q?.chgPct)}`}>{q ? fmtPct(q.chgPct) : '—'}</span>
                <span className="mk-trend__last mono">{q ? `$${fmtQuotePrice(q.last)}` : '—'}</span>
                <span className="mk-trend__asks mono">
                  {r.asks} {r.asks === 1 ? 'ASK' : 'ASKS'}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** The board under the tool strip — its tab lights as the data scrolls. */
function useActiveBoard(ids: readonly MarketSectionId[]) {
  const [active, setActive] = useState<MarketSectionId | null>(ids[0] ?? null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id)
          else visible.delete(e.target.id)
        }
        const top = ids.find((id) => visible.has(id))
        if (top) setActive(top)
      },
      // The band just under the tool strip (the brochure nav is gone on the
      // markets surface), down to mid-screen.
      { rootMargin: '-100px 0px -50% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [ids])
  return [active, setActive] as const
}

/** Map · List, remembered per browser (localStorage; SSR = the list, so the
 *  server HTML always carries every row for crawlers and no-JS). */
function useMarketsView(): [MarketsView, (v: MarketsView) => void] {
  const [view, setViewState] = useState<MarketsView>(DEFAULT_MARKETS_VIEW)
  useEffect(() => {
    try {
      setViewState(parseMarketsView(window.localStorage.getItem(MARKETS_VIEW_KEY)))
    } catch {
      /* the default view */
    }
  }, [])
  const setView = useCallback((v: MarketsView) => {
    setViewState(v)
    try {
      window.localStorage.setItem(MARKETS_VIEW_KEY, v)
    } catch {
      /* not remembered, still shown */
    }
  }, [])
  return [view, setView]
}

/** Under 640px the map view keeps the map AND renders the ledger under it
 *  (the phone's fallback: the map is the summary, the rows are the data).
 *  SSR = not a phone. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

/** j/k (↓/↑) walk every row link on the page; Enter follows the focused one
 *  (it IS a link, so Enter is the browser's own). Typing in a field never
 *  triggers the keys. */
function useRowKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const down = e.key === 'j' || e.key === 'ArrowDown'
      const up = e.key === 'k' || e.key === 'ArrowUp'
      if (!down && !up) return
      const rows = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-mk-row]'))
      if (rows.length === 0) return
      const at = rows.findIndex((r) => r === document.activeElement)
      const next = at < 0 ? (down ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + (down ? 1 : -1)))
      e.preventDefault()
      rows[next].focus()
      rows[next].scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function MarketsIndex({ trending = [] }: { trending?: TrendingRow[] }) {
  const router = useRouter()
  const sections = useMemo(() => marketSections(), [])
  const ids = useMemo(() => sections.map((s) => s.id), [sections])
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const [active, setActive] = useActiveBoard(ids)
  const [view, setView] = useMarketsView()
  const phone = usePhone()
  const showMap = view === 'map'
  const showList = view === 'list' || phone
  const open = useCallback((symbol: string) => router.push(`/t/${symbol}`), [router])
  useRowKeys()

  // Two grid items for the page's .mkt-frame: the data column and the side
  // column — the ask + account strip, then the docked watchlist rail
  // (app/markets/page.tsx adds the footer slot under the data).
  return (
    <>
      <main className="mkt-frame__main" data-view={view} data-map-fallback={view === 'map' && phone ? 'list' : undefined}>
        <h1 className="sr-only">Markets</h1>

        {/* ── Tool strip: search + view toggle + board tabs, sticky at the top ── */}
        <div className="mkt-frame__bar">
          <TickerSearch rows={allRows} />
          <div className="mk-view" role="group" aria-label="Board view">
            <button type="button" className={`mk-view__btn${view === 'map' ? ' is-on' : ''}`} aria-pressed={view === 'map'} onClick={() => setView('map')} title="Heat map">
              <LayoutGrid className="mk-view__icon" aria-hidden />
              <span>Map</span>
            </button>
            <button type="button" className={`mk-view__btn${view === 'list' ? ' is-on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')} title="Terminal list">
              <Rows3 className="mk-view__icon" aria-hidden />
              <span>List</span>
            </button>
          </div>
          <nav className="mkt-frame__tabs" aria-label="Boards">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`mkt-frame__tab${active === s.id ? ' is-on' : ''}`}
                aria-current={active === s.id ? 'location' : undefined}
                onClick={() => setActive(s.id)}
              >
                {TAB_LABELS[s.id]}
                <span className="mkt-frame__tabcount mono">{s.rows.length}</span>
              </a>
            ))}
          </nav>
        </div>

        {/* ── The clocks: NYSE bell countdown · tokens 24/7 · HL funding tick ── */}
        <SessionStrip />

        {/* ── The movers tape (VIZ) in a MARKETS seat ── */}
        <div className="mk-tape-seat" data-seat="MoversTape">
          <MoversTape onOpen={open} />
        </div>

        {/* ── The market data ── */}
        <div className="mkt-frame__data">
          <Trending rows={trending} />
          {showMap && (
            <section className="mk-map-seat" data-seat="MarketMap" aria-label="Market map">
              <MarketMap section="all" onOpen={open} />
              <p className="mk-map-seat__hint mono">
                MAP · size by liquidity, colour by move · <button type="button" className="mk-map-seat__flip" onClick={() => setView('list')}>show the list</button>
              </p>
            </section>
          )}
          {showList && sections.map((s) => <Board key={s.id} section={s} />)}
          <section className="mkt-card mkt-frame__how" aria-labelledby="mkt-how">
            <h2 id="mkt-how" className="mkt-card__title">
              How a chart executes
            </h2>
            <ol className="mkt-frame__steps">
              <li>Pick a symbol. The candles are live and keyless.</li>
              <li>Tap a chip or write the sentence — “Buy $10 of AAPL”.</li>
              <li>Pantessa builds the guarded transaction. No model writes calldata.</li>
              <li>Your wallet signs. That signature is the only gate.</li>
            </ol>
            <p className="mkt-card__note">
              Non-custodial. No broker account, no KYC to look. <Link href="/docs" className="mkt-link">How it works →</Link>
            </p>
            <p className="mk-keys mono" aria-label="Keyboard">
              <kbd>j</kbd>
              <kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>⌘K</kbd> ask
            </p>
          </section>
        </div>
      </main>

      {/* ── The side column: ask + account on top, the watchlist docked
          under it at full height ── */}
      <MarketsSide label="Your watchlist">
        <WatchlistSlot />
      </MarketsSide>
    </>
  )
}
