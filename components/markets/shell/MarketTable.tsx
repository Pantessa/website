'use client'

// One board as a TERMINAL TABLE (MK2/MARKETS, 2026-09-15): mark · symbol ·
// name · last · 24h — sortable by the column heads (symbol A→Z, last, 24h;
// the section's own order, household names first, is the unsorted state),
// every row the link to its symbol page. Keyboard: j/k (or ↓/↑) walk the
// rows of the whole index, Enter opens the focused one — the roving focus
// lives on the row links themselves, so the browser's own focus ring and
// screen readers see exactly what the keys do. Numbers come from the quotes
// hook and read as dashes until a feed answers (never a crash).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { chgClass, fmtPct, fmtQuotePrice, type QuoteMap } from '@/lib/markets-quotes'
import { sortMarketRows, type MarketRow, type MarketSortDir, type MarketSortKey } from '@/lib/markets'
import Sparkline from '@/components/markets/viz/Sparkline'
import { useSparks } from '@/components/markets/shell/useSparks'

const HEADS: { key: MarketSortKey; label: string }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'last', label: 'Last' },
  { key: 'chg', label: '24h' },
]

export default function MarketTable({ rows, quotes, section }: { rows: readonly MarketRow[]; quotes: QuoteMap; section: string }) {
  const [sort, setSort] = useState<{ key: MarketSortKey; dir: MarketSortDir } | null>(null)
  const sorted = useMemo(() => (sort ? sortMarketRows(rows, quotes, sort.key, sort.dir) : [...rows]), [rows, quotes, sort])
  // 7d sparkline closes (VIZ's sparks route); empty until the read lands.
  const sparks = useSparks(rows.map((r) => r.symbol))

  const toggle = (key: MarketSortKey) => {
    setSort((cur) => {
      // symbol: A→Z first; numbers: biggest first. A third press clears.
      const first: MarketSortDir = key === 'symbol' ? 'asc' : 'desc'
      if (!cur || cur.key !== key) return { key, dir: first }
      if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
      return null
    })
  }

  return (
    <div className="mk-board__inner" data-sort={sort ? `${sort.key}:${sort.dir}` : 'none'}>
      {/* The sort bar stands above the ledger (a thead can't span the
          two-column split the wide layout draws). */}
      <div className="mk-table__sortbar" role="group" aria-label="Sort">
        {HEADS.map((h) => {
          const on = sort?.key === h.key
          return (
            <button
              key={h.key}
              type="button"
              className={`mk-table__sort mono${on ? ' is-on' : ''}`}
              aria-pressed={on}
              data-sort-key={h.key}
              onClick={() => toggle(h.key)}
              title={`Sort by ${h.label.toLowerCase()}`}
            >
              {h.label}
              {on ? sort!.dir === 'asc' ? <ArrowUp className="mk-table__arrow" aria-hidden /> : <ArrowDown className="mk-table__arrow" aria-hidden /> : <ArrowUpDown className="mk-table__arrow mk-table__arrow--idle" aria-hidden />}
            </button>
          )
        })}
      </div>
      <table className="mk-table" data-section={section} data-sort={sort ? `${sort.key}:${sort.dir}` : 'none'}>
      <tbody>
        {sorted.map((r) => {
          const q = quotes[r.symbol]
          const markWhere = r.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {}
          return (
            <tr key={r.symbol} className="mk-table__row" data-symbol={r.symbol}>
              <td className="mk-table__id">
                <Link href={`/t/${r.symbol}`} className="mk-table__link" data-mk-row>
                  <TokenIcon symbol={r.symbol} size={24} {...markWhere} />
                  <span className="mk-table__sym mono">{r.symbol}</span>
                  <span className="mk-table__name">{r.name}</span>
                </Link>
              </td>
              <td className="mk-table__spark" data-spark={sparks[r.symbol]?.length ?? 0}>
                {sparks[r.symbol] && sparks[r.symbol]!.length >= 2 ? <Sparkline values={sparks[r.symbol]!} width={64} height={20} title={`${r.symbol} · 7 days`} /> : null}
              </td>
              <td className="mk-table__num mono">{q ? `$${fmtQuotePrice(q.last)}` : <span className="mk-table__dash">—</span>}</td>
              <td className={`mk-table__num mono mkt-chg ${chgClass(q?.chgPct)}`}>{q ? fmtPct(q.chgPct) : <span className="mk-table__dash">—</span>}</td>
            </tr>
          )
        })}
      </tbody>
      </table>
    </div>
  )
}
