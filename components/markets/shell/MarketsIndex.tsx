'use client'

// /markets — the index (SHELL). Hero strip (search), the watchlist rail
// slot, and three boards: digital equities (the curated 4663 list), crypto
// (Coinbase majors the resolver charts), perps (HL). Every row is a link to
// the symbol page; numbers come from the quotes hook and read as dashes
// until a feed answers. Long boards fold behind "show all" so the page
// leads with the household names.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FEATURED, marketSections, type MarketSection } from '@/lib/markets'
import { useQuotes } from '@/lib/markets-quotes'
import MarketRow from '@/components/markets/shell/MarketRow'
import TickerSearch from '@/components/markets/shell/TickerSearch'
import WatchlistSlot from '@/components/markets/shell/WatchlistSlot'

const FOLD_AT = 12

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

export default function MarketsIndex() {
  const sections = useMemo(() => marketSections(), [])
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const featured = useMemo(
    () => FEATURED.equities.slice(0, 4).map((s) => allRows.find((r) => r.symbol === s)).filter((r): r is NonNullable<typeof r> => !!r),
    [allRows],
  )

  return (
    <div className="mkt">
      {/* ── Hero strip ── */}
      <section className="mkt__hero">
        <p className="mkt__eyebrow mono">MARKETS · STOCKS 24/7 · SPOT · PERPS</p>
        <h1 className="mkt__title">The chart that executes.</h1>
        <p className="mkt__sub">
          A window to digital equities. Stocks 24/7, perps, spot and yield in one wallet. You keep the pen.
        </p>
        <TickerSearch rows={allRows} />
        <div className="mkt__quick">
          {featured.map((r) => (
            <Link key={r.symbol} href={`/t/${r.symbol}`} className="mkt-chip">
              {r.symbol}
            </Link>
          ))}
          <span className="mkt__quicknote mono">UNLIMITED WATCHLISTS · UNLIMITED ALERTS · FREE</span>
        </div>
      </section>

      {/* ── Boards + rail ── */}
      <div className="mkt__grid">
        <div className="mkt__main">
          {sections.map((s) => (
            <Board key={s.id} section={s} />
          ))}
        </div>
        <aside className="mkt__rail" aria-label="Your watchlist">
          <WatchlistSlot />
          <section className="mkt-card">
            <header className="mkt-card__head">
              <h2 className="mkt-card__title">How a chart executes</h2>
            </header>
            <ol className="mkt-steps">
              <li>Pick a symbol. The candles are live and keyless.</li>
              <li>Tap a chip or write the sentence — “Buy $10 of AAPL”.</li>
              <li>Pantessa builds the guarded transaction. No model writes calldata.</li>
              <li>Your wallet signs. That signature is the only gate.</li>
            </ol>
            <p className="mkt-card__note">
              Non-custodial. No broker account, no KYC to look. <Link href="/docs" className="mkt-link">How it works →</Link>
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
