'use client'

// The Markets search: type a ticker or a company ("apple", "$COIN", "eth"),
// the resolver in lib/charts decides what it is, Enter (or the chip) opens
// /t/<symbol>. Suggestions come from the section rows — client-side, no
// request. A URL never fires a turn; this only navigates.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import TokenIcon from '@/components/TokenIcon'
import { resolveTickerQuery, type MarketRow } from '@/lib/markets'

export default function TickerSearch({ rows, autoFocus = false }: { rows: MarketRow[]; autoFocus?: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const resolved = useMemo(() => resolveTickerQuery(q), [q])
  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return rows
      .filter((r) => r.symbol.toLowerCase().startsWith(needle) || r.name.toLowerCase().includes(needle))
      .slice(0, 6)
  }, [q, rows])

  const go = (symbol: string) => {
    setQ('')
    router.push(`/t/${symbol}`)
  }

  return (
    <form
      className="mkt-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const target = resolved?.symbol ?? suggestions[0]?.symbol
        if (target) go(target)
      }}
    >
      <label className="mkt-search__box">
        <Search className="mkt-search__icon" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a ticker or a company — apple, ETH, $COIN"
          aria-label="Search markets"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
        />
        <kbd className="mkt-search__kbd mono">↵</kbd>
      </label>
      {q.trim() && (
        <div className="mkt-search__menu" role="listbox">
          {resolved && !suggestions.some((s) => s.symbol === resolved.symbol) && (
            <button type="button" role="option" aria-selected className="mkt-search__opt" onClick={() => go(resolved.symbol)}>
              <TokenIcon symbol={resolved.symbol} size={20} {...(resolved.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {})} />
              <span className="mono">{resolved.symbol}</span>
              <span className="mkt-search__hint">open chart</span>
            </button>
          )}
          {suggestions.map((s) => (
            <button key={s.symbol} type="button" role="option" aria-selected={false} className="mkt-search__opt" onClick={() => go(s.symbol)}>
              <TokenIcon symbol={s.symbol} size={20} {...(s.source === 'robinhood' ? { chain: 'Robinhood Chain' } : {})} />
              <span className="mono">{s.symbol}</span>
              <span className="mkt-search__hint">{s.name}</span>
            </button>
          ))}
          {!resolved && suggestions.length === 0 && <p className="mkt-search__none">No chart for &ldquo;{q.trim()}&rdquo; yet.</p>}
        </div>
      )}
    </form>
  )
}
