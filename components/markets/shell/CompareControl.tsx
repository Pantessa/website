'use client'

// Compare mode (MK2/MARKETS, 2026-09-15): `/t/<sym>?vs=<sym2>`. The header
// pill names the second symbol and its 24h beside this one's; the chart
// overlay is VIZ's engine hook (ROUNDS.md request) — until it lands, the
// pill and the delta row are the whole feature, honestly labelled. The
// input resolves the way the search does ("bitcoin", "$BTC", "eth"); a
// symbol that doesn't chart, or this page's own, is refused in place.

import { useEffect, useMemo, useRef, useState } from 'react'
import { GitCompareArrows, X } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { resolveTickerQuery, symbolName } from '@/lib/markets'
import { chgClass, fmtPct, useQuotes } from '@/lib/markets-quotes'

export default function CompareControl({ symbol, vs, onChange }: { symbol: string; vs: string | null; onChange: (vs: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resolved = useMemo(() => {
    const p = resolveTickerQuery(q)
    return p && p.symbol !== symbol ? p : null
  }, [q, symbol])
  const { quotes } = useQuotes(vs ? [symbol, vs] : [])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (vs) {
    const a = quotes[symbol]
    const b = quotes[vs]
    return (
      <div className="mk-vs" data-vs={vs}>
        <span className="mk-vs__k mono">VS</span>
        <TokenIcon symbol={vs} size={18} />
        <span className="mk-vs__sym mono">{vs}</span>
        <span className="mk-vs__delta mono">
          <span className={`mkt-chg ${chgClass(a?.chgPct)}`}>{a ? fmtPct(a.chgPct) : '—'}</span>
          <span className="mk-vs__sep">·</span>
          <span className={`mkt-chg ${chgClass(b?.chgPct)}`}>{b ? fmtPct(b.chgPct) : '—'}</span>
          <span className="mk-vs__note">24h {symbol} · {vs}</span>
        </span>
        <button type="button" className="mk-vs__x" onClick={() => onChange(null)} aria-label={`Stop comparing with ${symbolName(vs)}`} title="Stop comparing">
          <X className="mk-vs__icon" aria-hidden />
        </button>
      </div>
    )
  }
  if (!open) {
    return (
      <button type="button" className="mk-vs__open mono" onClick={() => setOpen(true)} title="Overlay a second symbol">
        <GitCompareArrows className="mk-vs__icon" aria-hidden />
        COMPARE
      </button>
    )
  }
  return (
    <form
      className="mk-vs mk-vs--edit"
      onSubmit={(e) => {
        e.preventDefault()
        if (!resolved) return
        onChange(resolved.symbol)
        setQ('')
        setOpen(false)
      }}
    >
      <span className="mk-vs__k mono">VS</span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setQ('')
          }
        }}
        placeholder="BTC, ethereum, $NVDA…"
        aria-label="Symbol to compare with"
        autoComplete="off"
        spellCheck={false}
        className="mk-vs__input mono"
      />
      <button type="submit" className="mk-vs__go mono" disabled={!resolved}>
        {resolved ? `OVERLAY ${resolved.symbol}` : q.trim() ? 'NO CHART' : 'OVERLAY'}
      </button>
      <button type="button" className="mk-vs__x" onClick={() => setOpen(false)} aria-label="Cancel compare">
        <X className="mk-vs__icon" aria-hidden />
      </button>
    </form>
  )
}
