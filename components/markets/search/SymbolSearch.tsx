'use client'

// SYMBOL SEARCH — the door to any chart, from any markets page (2026-11-17,
// Nate on /t/UNI: "I should be able to search for a new asset on the asset
// page … small like on TradingView that then expands bigger when clicked …
// make sure it works on mobile too").
//
// Two small triggers (the lens in the strip above the watchlist, which is a
// phone's top bar; the pill beside the symbol's name on /t) and the `/` key
// open ONE panel: a wide palette on a desktop, a full-screen sheet on a
// phone. Before a word is typed it lists what you opened last, what your
// wallet holds and the charts a desk opens first; typing ranks the whole
// chart universe (lib/symbol-search). Every row carries its live quote and a
// week of closes; the row under the cursor is drawn large beside the list.
// Enter opens the chart. A search only navigates: it never fires a turn.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowUpRight, Clock, CornerDownLeft, Search, Sparkles, TrendingUp, Wallet, X } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { HyperliquidMark, RobinhoodMark } from '@/components/protocol-marks'
import { useAskDoor } from '@/lib/ask-door'
import { hlPerpsWarm, warmHlPerps } from '@/lib/charts'
import { fmtIndexValue } from '@/lib/macro'
import { venueLabel } from '@/lib/markets'
import { fmtLivePrice, type Quote } from '@/lib/markets-quotes'
import {
  SEARCH_FILTERS,
  SEARCH_KIND_LABEL,
  SEARCH_POPULAR,
  hitsFor,
  isSearchKey,
  matchRange,
  readRecent,
  searchSymbols,
  useSymbolSearch,
  writeRecent,
  type SearchFilter,
  type SearchHit,
} from '@/lib/symbol-search'
import { useHeld } from '@/lib/use-held'
import { useHydrated } from '@/lib/use-hydrated'
import './search.css'

// ── Triggers ─────────────────────────────────────────────────────────────────

/** `strip`: the round lens beside Ask (a phone's top bar); on the stranger's
 *  landing, where the strip is the bar across the top of the hero, it opens
 *  out into a field with its word and key (search.css). `head`: the small
 *  pill beside a symbol's name. `bar`: the field at the left of the markets
 *  tool strip (2026-11-19, Nate: "same functionality as when on an asset
 *  page … only show the style where it pops up"): it looks like a box and is
 *  a button. All three open the same panel; nothing searches in place. */
export function SymbolSearchTrigger({ variant }: { variant: 'strip' | 'head' | 'bar' }) {
  const openSearch = useSymbolSearch((s) => s.openSearch)
  if (variant === 'strip') {
    return (
      <button type="button" className="ssx-lens" onClick={() => openSearch()} aria-label="Search markets" title="Search any stock, coin, perp or index ( / )" data-symbol-search="strip">
        <Search aria-hidden />
        <span className="ssx-lens__word">Search markets</span>
        <kbd className="ssx-lens__kbd mono" aria-hidden>
          /
        </kbd>
      </button>
    )
  }
  if (variant === 'bar') {
    return (
      <div className="mkt-search" role="search">
        <button type="button" className="ssx-field" onClick={() => openSearch()} aria-label="Search markets" aria-haspopup="dialog" title="Search any stock, coin, perp or index ( / )" data-symbol-search="bar">
          <Search aria-hidden />
          <span className="ssx-field__word">Search a ticker or a company</span>
          <kbd className="ssx-field__kbd mono" aria-hidden>
            /
          </kbd>
        </button>
      </div>
    )
  }
  return (
    <button type="button" className="ssx-pill" onClick={() => openSearch()} aria-label="Search for another market" title="Search any stock, coin, perp or index ( / )" data-symbol-search="head">
      <Search aria-hidden />
      <span className="ssx-pill__word">Search</span>
      <kbd className="ssx-pill__kbd mono" aria-hidden>
        /
      </kbd>
    </button>
  )
}

// ── Quotes + a week of closes, read once per symbol per minute ───────────────

interface Tape {
  quote?: Quote
  spark?: number[]
  at: number
}
const tapes = new Map<string, Tape>()
const TAPE_TTL_MS = 60_000

function useTapes(symbols: readonly string[], on: boolean): Record<string, Tape | undefined> {
  const key = symbols.join(',')
  const [, bump] = useState(0)
  useEffect(() => {
    if (!on || !key) return
    const now = Date.now()
    const want = key.split(',').filter((s) => (tapes.get(s)?.at ?? 0) < now - TAPE_TTL_MS)
    if (want.length === 0) return
    let stopped = false
    // A short wait: a fast typist asks once, for the list they stopped on.
    const t = window.setTimeout(() => {
      const list = encodeURIComponent(want.join(','))
      const land = (fill: (s: string, tape: Tape) => void) => {
        for (const s of want) {
          const tape = tapes.get(s) ?? { at: Date.now() }
          tape.at = Date.now()
          fill(s, tape)
          tapes.set(s, tape)
        }
        if (!stopped) bump((n) => n + 1)
      }
      fetch(`/api/quotes?symbols=${list}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { quotes?: Record<string, Quote | undefined> } | null) => {
          if (body?.quotes) land((s, tape) => (tape.quote = body.quotes?.[s] ?? tape.quote))
        })
        .catch(() => {})
      fetch(`/api/markets/viz/sparks?symbols=${list}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { sparks?: Record<string, number[]> } | null) => {
          if (body?.sparks) land((s, tape) => (tape.spark = body.sparks?.[s] ?? tape.spark))
        })
        .catch(() => {})
    }, 140)
    return () => {
      stopped = true
      window.clearTimeout(t)
    }
  }, [key, on])
  const out: Record<string, Tape | undefined> = {}
  for (const s of symbols) out[s] = tapes.get(s)
  return out
}

// The venue a row's trade runs on, as its mark: Robinhood Chain for stocks,
// Hyperliquid for perps (and the builder macro markets). A row with no single
// venue mark (spot crypto routes across DEXs; a look-only index) keeps its word.
const VENUE_MARK = {
  robinhood: { Mark: RobinhoodMark, name: 'Robinhood Chain' },
  hyperliquid: { Mark: HyperliquidMark, name: 'Hyperliquid' },
} as const

function KindTag({ hit }: { hit: SearchHit }) {
  const venue = VENUE_MARK[hit.pair.source as keyof typeof VENUE_MARK]
  if (venue) {
    return (
      <span className="ssx__venue" data-kind={hit.kind} data-venue={hit.pair.source} title={`Trades on ${venue.name}`} aria-label={`${SEARCH_KIND_LABEL[hit.kind]} on ${venue.name}`} role="img">
        <venue.Mark size={14} />
      </span>
    )
  }
  return (
    <span className="ssx__kind mono" data-kind={hit.kind}>
      {SEARCH_KIND_LABEL[hit.kind]}
    </span>
  )
}

function priceOf(hit: SearchHit, q: Quote | undefined): string {
  if (!q) return ''
  return hit.kind === 'macro' ? fmtIndexValue(hit.pair, q.last) : `$${fmtLivePrice(q.last)}`
}

function changeOf(q: Quote | undefined): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (!q || !Number.isFinite(q.chgPct)) return null
  const tone = q.chgPct > 0.005 ? 'up' : q.chgPct < -0.005 ? 'down' : 'flat'
  return { text: `${q.chgPct > 0 ? '+' : ''}${q.chgPct.toFixed(2)}%`, tone }
}

/** A week of closes as one line (and its area, when `fill`). Nothing when the feed has none. */
function Spark({ data, w, h, fill = false }: { data: number[] | undefined; w: number; h: number; fill?: boolean }) {
  if (!data || data.length < 2) return <span className="ssx-spark ssx-spark--none" style={{ width: w, height: h }} aria-hidden />
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const span = hi - lo || 1
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - lo) / span) * (h - 4)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const tone = data[data.length - 1] >= data[0] ? 'up' : 'down'
  return (
    <svg className={`ssx-spark ssx-spark--${tone}`} viewBox={`0 0 ${w} ${h}`} width={fill ? '100%' : w} height={h} preserveAspectRatio="none" aria-hidden>
      {fill && <path className="ssx-spark__area" d={`${line} L${w} ${h} L0 ${h} Z`} />}
      <path className="ssx-spark__line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Hi({ text, q }: { text: string; q: string }) {
  const r = matchRange(text, q)
  if (!r) return <>{text}</>
  return (
    <>
      {text.slice(0, r[0])}
      <mark>{text.slice(r[0], r[1])}</mark>
      {text.slice(r[1])}
    </>
  )
}

// ── The panel ────────────────────────────────────────────────────────────────

interface Group {
  id: string
  label: string
  icon: React.ReactNode
  hits: SearchHit[]
}

function SearchPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const seed = useSymbolSearch((s) => s.seed)
  const closeSearch = useSymbolSearch((s) => s.closeSearch)
  const openDoor = useAskDoor((s) => s.openDoor)
  const held = useHeld()
  const [q, setQ] = useState(seed)
  const [filter, setFilter] = useState<SearchFilter>('all')
  const [cursor, setCursor] = useState(0)
  const [recent] = useState(() => readRecent())
  const input = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  // The venue's live listing (every perp, the builder markets: gold, the S&P
  // 500, oil): a page that was not handed it reads it once, when the panel opens.
  const [warm, setWarm] = useState(() => hlPerpsWarm())
  useEffect(() => {
    if (warm) return
    let stopped = false
    void warmHlPerps().then((ok) => {
      if (ok && !stopped) setWarm(true)
    })
    return () => {
      stopped = true
    }
  }, [warm])
  const viewing = /^\/t\/([^/?#]+)/.exec(pathname ?? '')?.[1]?.toUpperCase() ?? null
  const typed = q.trim()

  const groups = useMemo<Group[]>(() => {
    if (typed) {
      const hits = searchSymbols(typed, { filter, limit: 30 })
      return hits.length ? [{ id: 'results', label: `${hits.length === 30 ? 'Top 30' : hits.length} ${hits.length === 1 ? 'match' : 'matches'}`, icon: <Search aria-hidden />, hits }] : []
    }
    const seen = new Set<string>()
    const take = (id: string, label: string, icon: React.ReactNode, symbols: readonly string[], max: number): Group | null => {
      const hits = hitsFor(symbols, filter, seen).slice(0, max)
      for (const h of hits) seen.add(h.symbol)
      return hits.length ? { id, label, icon, hits } : null
    }
    const heldSyms = (held ?? []).filter((h) => (h.valueUsd ?? 0) >= 1).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)).map((h) => h.symbol)
    return [
      take('recent', 'Recent', <Clock aria-hidden />, recent.filter((s) => s !== viewing), 5),
      take('held', 'In your wallet', <Wallet aria-hidden />, heldSyms, 6),
      take('popular', 'Opened most', <TrendingUp aria-hidden />, SEARCH_POPULAR, 10),
    ].filter((g): g is Group => g !== null)
    // `warm`: the live listing landing re-ranks what is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, filter, held, recent, viewing, warm])

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])
  const tapeMap = useTapes(useMemo(() => flat.slice(0, 30).map((h) => h.symbol), [flat]), true)
  const at = Math.min(cursor, Math.max(flat.length - 1, 0))
  const current = flat[at] ?? null

  useEffect(() => setCursor(0), [typed, filter])
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const open = useCallback(
    (hit: SearchHit, newTab = false) => {
      writeRecent(hit.symbol)
      if (newTab) {
        window.open(`/t/${hit.symbol}`, '_blank', 'noopener')
        return
      }
      closeSearch()
      if (hit.symbol !== viewing) router.push(`/t/${hit.symbol}`)
    },
    [closeSearch, router, viewing],
  )

  const ask = useCallback(() => {
    closeSearch()
    openDoor(typed)
  }, [closeSearch, openDoor, typed])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (q) setQ('')
      else closeSearch()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(Math.min(at + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(Math.max(at - 1, 0))
    } else if (e.key === 'Tab') {
      // Tab walks the classes; the box keeps the keyboard.
      e.preventDefault()
      const i = SEARCH_FILTERS.findIndex((f) => f.id === filter)
      setFilter(SEARCH_FILTERS[(i + (e.shiftKey ? SEARCH_FILTERS.length - 1 : 1)) % SEARCH_FILTERS.length].id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (current) open(current, e.metaKey || e.ctrlKey)
      else if (typed) ask()
    }
  }

  let i = -1
  const currentTape = current ? tapeMap[current.symbol] : undefined
  const currentChange = changeOf(currentTape?.quote)

  return (
    <div className="ssx" role="dialog" aria-modal="true" aria-label="Search markets" onKeyDown={onKeyDown} data-symbol-search="panel">
      <button type="button" className="ssx__scrim" aria-label="Close search" tabIndex={-1} onClick={closeSearch} />
      <div className="ssx__panel" data-preview={current ? '' : undefined}>
        <div className="ssx__top">
          <label className="ssx__box">
            <Search className="ssx__boxIcon" aria-hidden />
            <input
              ref={input}
              className="ssx__input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a ticker, a company or a market"
              aria-label="Search markets"
              role="combobox"
              aria-expanded
              aria-controls="ssx-list"
              aria-activedescendant={current ? `ssx-opt-${current.symbol}` : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="search"
            />
            {q && (
              <button type="button" className="ssx__clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}>
                <X aria-hidden />
              </button>
            )}
            <kbd className="ssx__esc mono" aria-hidden>
              esc
            </kbd>
          </label>
          <button type="button" className="ssx__cancel" onClick={closeSearch}>
            Cancel
          </button>
        </div>

        <div className="ssx__filters" role="tablist" aria-label="Market class">
          {SEARCH_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="ssx__filter" tabIndex={-1} onClick={() => { setFilter(f.id); input.current?.focus() }}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="ssx__body">
          <div className="ssx__list" id="ssx-list" role="listbox" aria-label="Markets" ref={list}>
            {groups.map((g) => (
              <section key={g.id} className="ssx__group">
                <h3 className="ssx__label mono">
                  {g.icon}
                  {g.label}
                </h3>
                {g.hits.map((h) => {
                  i += 1
                  const idx = i
                  const tape = tapeMap[h.symbol]
                  const chg = changeOf(tape?.quote)
                  return (
                    <a
                      key={h.symbol}
                      id={`ssx-opt-${h.symbol}`}
                      href={`/t/${h.symbol}`}
                      role="option"
                      aria-selected={idx === at}
                      data-i={idx}
                      className="ssx__row"
                      onMouseMove={() => idx !== at && setCursor(idx)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                          writeRecent(h.symbol)
                          return
                        }
                        e.preventDefault()
                        open(h)
                      }}
                    >
                      <TokenIcon symbol={h.ticker} size={30} {...(h.kind === 'stock' ? { chain: 'Robinhood Chain' } : {})} />
                      <span className="ssx__id">
                        <span className="ssx__sym mono">
                          <Hi text={h.ticker} q={typed} />
                          <KindTag hit={h} />
                          {h.symbol === viewing && <span className="ssx__here mono">viewing</span>}
                        </span>
                        <span className="ssx__name">
                          <Hi text={h.name} q={typed} />
                        </span>
                      </span>
                      <Spark data={tape?.spark} w={64} h={22} />
                      <span className="ssx__quote">
                        <span className="ssx__last mono">{priceOf(h, tape?.quote) || <span className="ssx__dash">·</span>}</span>
                        {chg && <span className={`ssx__chg mono ssx__chg--${chg.tone}`}>{chg.text}</span>}
                      </span>
                    </a>
                  )
                })}
              </section>
            ))}

            {typed && flat.length === 0 && (
              <p className="ssx__none">
                No chart for &ldquo;{typed}&rdquo;{filter !== 'all' ? ` in ${SEARCH_FILTERS.find((f) => f.id === filter)?.label}` : ''}. Try a ticker (AAPL, ETH) or a company name.
              </p>
            )}
            {!typed && flat.length === 0 && <p className="ssx__none">Nothing listed here yet. Type a ticker or a company name.</p>}

            {typed.length >= 2 && (
              <button type="button" className="ssx__ask" onClick={ask} tabIndex={-1}>
                <Sparkles aria-hidden />
                <span className="ssx__askText">
                  Ask Pantessa about <strong>&ldquo;{typed}&rdquo;</strong>
                </span>
                <span className="ssx__askHint mono">⌘K</span>
              </button>
            )}
          </div>

          {current && (
            <aside className="ssx__preview" aria-hidden>
              <div className="ssx__pvHead">
                <TokenIcon symbol={current.ticker} size={44} {...(current.kind === 'stock' ? { chain: 'Robinhood Chain' } : {})} />
                <div className="ssx__pvId">
                  <span className="ssx__pvName">{current.name}</span>
                  <span className="ssx__pvSym mono">
                    {current.ticker} · {venueLabel(current.pair)}
                  </span>
                </div>
              </div>
              <div className="ssx__pvQuote">
                <span className="ssx__pvLast mono">{priceOf(current, currentTape?.quote) || ' '}</span>
                {currentChange && <span className={`ssx__pvChg mono ssx__chg--${currentChange.tone}`}>{currentChange.text} 24h</span>}
              </div>
              <div className="ssx__pvChart">
                <Spark data={currentTape?.spark} w={320} h={132} fill />
                <span className="ssx__pvSpan mono">{currentTape?.spark ? 'Past 7 days' : currentTape ? 'No week of closes for this market' : ''}</span>
              </div>
              <div className="ssx__pvActs">
                <button type="button" className="ssx__go" tabIndex={-1} onClick={() => open(current)}>
                  {current.symbol === viewing ? 'Back to the chart' : `Open ${current.ticker}${current.ticker !== current.symbol ? ' perp' : ''}`}
                  <CornerDownLeft aria-hidden />
                </button>
                <button type="button" className="ssx__alt" tabIndex={-1} onClick={() => open(current, true)}>
                  New tab
                  <ArrowUpRight aria-hidden />
                </button>
              </div>
            </aside>
          )}
        </div>

        <div className="ssx__foot mono" aria-hidden>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘↵</kbd> new tab</span>
          <span><kbd>tab</kbd> class</span>
          <span className="ssx__footEnd">Looking is free. A search never trades.</span>
        </div>
      </div>
    </div>
  )
}

/** Mounted once per markets page (MarketsSide): owns the `/` key and the panel. */
export default function SymbolSearch() {
  const open = useSymbolSearch((s) => s.open)
  const openSearch = useSymbolSearch((s) => s.openSearch)
  const closeSearch = useSymbolSearch((s) => s.closeSearch)
  const hydrated = useHydrated()
  const pathname = usePathname()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useSymbolSearch.getState().open) return
      if (!isSearchKey(e, e.target as HTMLElement | null)) return
      e.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  // A navigation (the picked chart, the back button) closes the panel.
  useEffect(() => {
    closeSearch()
  }, [pathname, closeSearch])

  if (!hydrated || !open) return null
  return createPortal(<SearchPanel />, document.body)
}
