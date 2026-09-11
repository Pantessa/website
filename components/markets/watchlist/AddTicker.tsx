'use client'

// The add-ticker search box (MARKETS/WATCH). Company names resolve through
// the chart-ask resolver ("apple" → AAPL, "bitcoin" → BTC — lib/watchlists
// searchTickers), tickers by prefix. Enter adds the first hit; every hit is
// chartable by construction, so an added row always quotes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { searchTickers, type TickerHit } from '@/lib/watchlists'

const KIND_LABEL: Record<TickerHit['kind'], string> = { stock: 'Robinhood Chain · 24/7', coin: 'Coinbase spot', perp: 'HL perp' }

export default function AddTicker({
  onAdd,
  held,
  placeholder = 'Add a ticker or company…',
  autoFocus = false,
}: {
  onAdd: (symbol: string) => void
  held: ReadonlySet<string>
  placeholder?: string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const box = useRef<HTMLDivElement | null>(null)
  const hits = useMemo(() => searchTickers(q, 8), [q])

  useEffect(() => {
    setCursor(0)
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (hit: TickerHit) => {
    onAdd(hit.symbol)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="wl__add" ref={box}>
      <Search className="wl__addIcon" aria-hidden />
      <input
        className="wl__addInput"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Add a ticker"
        aria-expanded={open && hits.length > 0}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(c + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(c - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (hits[cursor]) pick(hits[cursor])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && q.trim() && (
        <ul className="wl__hits" role="listbox">
          {hits.length === 0 && <li className="wl__hit wl__hit--none">No chart for “{q.trim()}” yet</li>}
          {hits.map((h, i) => {
            const already = held.has(h.symbol)
            return (
              <li
                key={h.symbol}
                role="option"
                aria-selected={i === cursor}
                className={`wl__hit${i === cursor ? ' wl__hit--cur' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(h)
                }}
              >
                <TokenIcon symbol={h.symbol} size={18} {...(h.kind === 'stock' ? { chain: 'Robinhood Chain' } : {})} />
                <span className="wl__hitSym">{h.symbol}</span>
                <span className="wl__hitName">{h.name}</span>
                <span className="wl__hitKind mono">{already ? 'on list' : KIND_LABEL[h.kind]}</span>
                {!already && <Plus className="wl__hitPlus" aria-hidden />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
