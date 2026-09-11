'use client'

// /markets — the index (SHELL), laid out like a trading terminal in full
// screen (2026-09-11, Nate: "similar to trading view full screen mode, no
// need for a header or tag"). No hero: the market data scrolls in the main
// column under a sticky tool strip (search + board tabs) while the watchlist
// stays docked on the right at full viewport height (≥1024px; below that it
// drops into the flow under the boards). Three boards: digital equities (the
// curated 4663 list), crypto (Coinbase majors the resolver charts), perps
// (HL). Every row is a link to the symbol page; numbers come from the quotes
// hook and read as dashes until a feed answers. Long boards fold behind
// "show all" so the page leads with the household names.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { marketSections, type MarketSection, type MarketSectionId } from '@/lib/markets'
import { useQuotes } from '@/lib/markets-quotes'
import MarketRow from '@/components/markets/shell/MarketRow'
import TickerSearch from '@/components/markets/shell/TickerSearch'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'

// Rows before "show all". Divides by every column count the board grid takes
// (1–4, container-queried in x402-design.css), so a folded board always ends
// on a full row.
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
      <div className="mkt-sec__rows">
        {rows.map((r) => (
          <MarketRow key={r.symbol} row={r} quote={quotes[r.symbol]} />
        ))}
      </div>
      {section.rows.length > FOLD_AT && (
        <button type="button" className="mkt-sec__more mono" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'SHOW FEWER' : `SHOW ALL ${section.rows.length}`}
        </button>
      )}
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
      // The band just under the nav + tool strip, down to mid-screen.
      { rootMargin: '-150px 0px -50% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [ids])
  return [active, setActive] as const
}

export default function MarketsIndex() {
  const sections = useMemo(() => marketSections(), [])
  const ids = useMemo(() => sections.map((s) => s.id), [sections])
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const [active, setActive] = useActiveBoard(ids)

  // Two grid items for the page's .mkt-frame: the data column and the rail
  // (app/markets/page.tsx adds the footer slot under the data).
  return (
    <>
      <main className="mkt-frame__main">
        <h1 className="sr-only">Markets</h1>

        {/* ── Tool strip: search + board tabs, sticky under the nav ── */}
        <div className="mkt-frame__bar">
          <TickerSearch rows={allRows} />
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

        {/* ── The market data ── */}
        <div className="mkt-frame__data">
          {sections.map((s) => (
            <Board key={s.id} section={s} />
          ))}
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
          </section>
        </div>
      </main>

      {/* ── The watchlist, docked right at full height ── */}
      <aside className="mkt-frame__rail" aria-label="Your watchlist">
        <WatchlistSlot />
      </aside>
    </>
  )
}
