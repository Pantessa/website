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

const HEADS: { key: MarketSortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'last', label: 'Last', align: 'right' },
  { key: 'chg', label: '24h', align: 'right' },
]

export default function MarketTable({ rows, quotes, section }: { rows: readonly MarketRow[]; quotes: QuoteMap; section: string }) {
  const [sort, setSort] = useState<{ key: MarketSortKey; dir: MarketSortDir } | null>(null)
  const sorted = useMemo(() => (sort ? sortMarketRows(rows, quotes, sort.key, sort.dir) : [...rows]), [rows, quotes, sort])

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
    <table className="mk-table" data-section={section} data-sort={sort ? `${sort.key}:${sort.dir}` : 'none'}>
      <thead>
        <tr>
          {HEADS.map((h) => {
            const on = sort?.key === h.key
            const aria = on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
            return (
              <th key={h.key} scope="col" aria-sort={aria} className={`mk-table__th mk-table__th--${h.align}${on ? ' is-on' : ''}`}>
                <button type="button" className="mk-table__sort mono" onClick={() => toggle(h.key)} title={`Sort by ${h.label.toLowerCase()}`}>
                  {h.label}
                  {on ? sort!.dir === 'asc' ? <ArrowUp className="mk-table__arrow" aria-hidden /> : <ArrowDown className="mk-table__arrow" aria-hidden /> : <ArrowUpDown className="mk-table__arrow mk-table__arrow--idle" aria-hidden />}
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
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
              <td className="mk-table__num mono">{q ? `$${fmtQuotePrice(q.last)}` : <span className="mk-table__dash">—</span>}</td>
              <td className={`mk-table__num mono mkt-chg ${chgClass(q?.chgPct)}`}>{q ? fmtPct(q.chgPct) : <span className="mk-table__dash">—</span>}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
