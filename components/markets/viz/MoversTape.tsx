'use client'

// MoversTape — the live movers ribbon: top gainers and losers across every
// section, a marquee that pauses on hover/focus, click opens the symbol.
// Reduced-motion viewers get a scrollable row instead of a marquee.

import { useMemo } from 'react'
import { marketSections } from '@/lib/markets'
import { useQuotes } from '@/lib/markets-quotes'
import { fmtPrice } from '@/lib/markets-look'
import Delta from './Delta'
import { rankMovers } from '@/lib/viz/movers'

export { rankMovers }

export interface MoversTapeProps {
  onOpen: (symbol: string) => void
  /** How many gainers and losers each (default 8). */
  count?: number
  className?: string
}

export default function MoversTape({ onOpen, count = 8, className = '' }: MoversTapeProps) {
  const sections = useMemo(() => marketSections(), [])
  const symbols = useMemo(() => sections.flatMap((s) => s.rows.map((r) => r.symbol)), [sections])
  const { quotes, live } = useQuotes(symbols)
  const rows = useMemo(() => symbols.map((s) => ({ symbol: s, last: quotes[s]?.last ?? null, chgPct: quotes[s]?.chgPct ?? null })), [symbols, quotes])
  const { gainers, losers } = useMemo(() => rankMovers(rows, count), [rows, count])
  const items = [...gainers, ...losers]
  if (!items.length) {
    return (
      <div className={`mk-tape ${className}`.trim()}>
        <div className="mk-tape__empty">{live ? 'No movers yet.' : 'Reading the tape…'}</div>
      </div>
    )
  }
  const dur = `${Math.max(30, items.length * 4)}s`
  // The track is doubled so the -50% translate loops seamlessly.
  const track = [...items, ...items]
  return (
    <div className={`mk-tape ${className}`.trim()} style={{ ['--mk-tape-dur' as string]: dur }} aria-label="Top movers">
      <div className="mk-tape__track">
        {track.map((r, i) => (
          <span key={`${r.symbol}-${i}`} style={{ display: 'contents' }}>
            <button type="button" className="mk-tape__item" onClick={() => onOpen(r.symbol)} aria-hidden={i >= items.length ? true : undefined} tabIndex={i >= items.length ? -1 : 0}>
              <span className="mk-tape__sym">{r.symbol}</span>
              <span className="mk-tape__px">{r.last != null ? fmtPrice(r.last) : '—'}</span>
              <Delta pct={r.chgPct} />
            </button>
            <span className="mk-tape__sep" aria-hidden="true" />
          </span>
        ))}
      </div>
    </div>
  )
}
