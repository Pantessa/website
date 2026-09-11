'use client'

// One row on the Markets index / rail: mark · symbol · name · last · change.
// The whole row is the link to the symbol page; the numbers come from the
// quotes hook and read as dashes until a feed answers (never a crash).

import Link from 'next/link'
import TokenIcon from '@/components/TokenIcon'
import { chgClass, fmtPct, fmtQuotePrice, type Quote } from '@/lib/markets-quotes'
import type { MarketRow as Row } from '@/lib/markets'

export default function MarketRow({ row, quote, compact = false }: { row: Row; quote?: Quote; compact?: boolean }) {
  const markWhere = row.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {}
  return (
    <Link href={`/t/${row.symbol}`} className={`mkt-row ${compact ? 'mkt-row--compact' : ''}`} data-symbol={row.symbol}>
      <TokenIcon symbol={row.symbol} size={compact ? 22 : 28} {...markWhere} />
      <span className="mkt-row__id">
        <span className="mkt-row__sym mono">{row.symbol}</span>
        <span className="mkt-row__name">{row.name}</span>
      </span>
      <span className="mkt-row__num mono">
        <span className="mkt-row__last">{quote ? `$${fmtQuotePrice(quote.last)}` : '—'}</span>
        <span className={`mkt-chg ${chgClass(quote?.chgPct)}`}>{quote ? fmtPct(quote.chgPct) : '—'}</span>
      </span>
    </Link>
  )
}
