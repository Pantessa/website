'use client'

// MarketMap — the whole index as a treemap: cell = a symbol, size = an honest
// basis (volume where the feed gives it, else equal), color = 24h % change
// on the up/down diverging scale, hover = a glass stat card, click =
// onOpen(symbol). Shaping is pure in lib/viz/market-map.ts (pinned).

import { useEffect, useMemo, useRef, useState } from 'react'
import { marketSections } from '@/lib/markets'
import { useQuotes } from '@/lib/markets-quotes'
import { cellFill, labelTier, marketMapLayout, type MapCell, type MapSection, CLAMP_PCT } from '@/lib/viz/market-map'
import { fmtPct, fmtPrice } from '@/lib/markets-look'
import Delta from './Delta'

export interface MarketMapProps {
  section?: MapSection
  onOpen: (symbol: string) => void
  /** Show the section filter tabs (default true). */
  tabs?: boolean
  /** Aspect ratio of the map (width / height); default 2.2 desktop, 1.1 phone. */
  aspect?: number
  className?: string
}

const TABS: { id: MapSection; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'perps', label: 'Perps' },
]

const W = 1000

export default function MarketMap({ section = 'all', onOpen, tabs = true, aspect, className = '' }: MarketMapProps) {
  const [filter, setFilter] = useState<MapSection>(section)
  useEffect(() => setFilter(section), [section])
  const sections = useMemo(() => marketSections(), [])
  const symbols = useMemo(() => sections.flatMap((s) => s.rows.map((r) => r.symbol)), [sections])
  const { quotes, live } = useQuotes(symbols)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const H = Math.round(W / (aspect ?? (narrow ? 1.1 : 2.2)))
  const layout = useMemo(() => marketMapLayout(sections, quotes, filter, W, H), [sections, quotes, filter, H])
  const [hover, setHover] = useState<{ cell: MapCell; px: number; py: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`mk-map ${className}`.trim()} ref={wrapRef}>
      <div className="mk-map__head">
        {tabs ? (
          <div className="mk-map__tabs" role="tablist" aria-label="Market map section">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="mk-map__tab" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <span className="mk-map__scale" aria-label={`Color scale: -${CLAMP_PCT}% to +${CLAMP_PCT}%`}>
          <span>-{CLAMP_PCT}%</span>
          <i style={{ background: cellFill(-CLAMP_PCT) }} />
          <i style={{ background: cellFill(-CLAMP_PCT / 2) }} />
          <i style={{ background: cellFill(0) }} />
          <i style={{ background: cellFill(CLAMP_PCT / 2) }} />
          <i style={{ background: cellFill(CLAMP_PCT) }} />
          <span>+{CLAMP_PCT}%</span>
        </span>
      </div>
      {layout.cells.length === 0 ? (
        <div className="mk-map__empty">Nothing charted in this section.</div>
      ) : (
        <svg
          className="mk-map__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="group"
          aria-label="Market map"
          onMouseLeave={() => setHover(null)}
        >
          {layout.cells.map((c) => {
            const tier = labelTier(c.w, c.h)
            const fs1 = Math.max(9, Math.min(18, Math.min(c.w / 4.2, c.h / 2.6)))
            return (
              <g
                key={c.symbol}
                className="mk-map__cell"
                tabIndex={0}
                role="button"
                aria-label={`${c.symbol} ${c.name} ${c.last != null ? fmtPrice(c.last) : ''} ${fmtPct(c.chgPct)}`}
                onClick={() => onOpen(c.symbol)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(c.symbol)
                  }
                }}
                onMouseMove={(e) => {
                  const r = wrapRef.current?.getBoundingClientRect()
                  if (!r) return
                  setHover({ cell: c, px: e.clientX - r.left, py: e.clientY - r.top })
                }}
                onFocus={() => setHover({ cell: c, px: 0, py: 0 })}
                onBlur={() => setHover(null)}
              >
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={3} fill={cellFill(c.chgPct)} />
                {tier >= 1 ? (
                  <text className="mk-map__sym" x={c.x + 6} y={c.y + 6 + fs1 * 0.9} fontSize={fs1} fill="var(--fg)">
                    {c.symbol}
                  </text>
                ) : null}
                {tier >= 2 ? (
                  <text className="mk-map__pct" x={c.x + 6} y={c.y + 6 + fs1 * 0.9 + fs1 * 0.95} fontSize={fs1 * 0.75} fill="var(--fg)" opacity={0.8}>
                    {fmtPct(c.chgPct)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      )}
      {hover ? (
        <div className="mk-map__hover" style={hoverPos(hover.px, hover.py, wrapRef.current)}>
          <div className="mk-label">{hover.cell.section === 'equities' ? 'Robinhood Chain · 24/7' : hover.cell.section === 'perps' ? 'Hyperliquid perp' : 'Coinbase spot'}</div>
          <strong>{hover.cell.symbol}</strong> <span style={{ color: 'var(--muted)' }}>{hover.cell.name}</span>
          <div className="mk-num" style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span>{hover.cell.last != null ? fmtPrice(hover.cell.last) : '—'}</span>
            <Delta pct={hover.cell.chgPct} />
          </div>
        </div>
      ) : null}
      <div className="mk-map__foot">
        Cell size: {layout.sizing === 'volume' ? '24h dollar volume' : 'equal (the feeds carry no volume for this set)'} · color: 24h change, clamped at ±{CLAMP_PCT}% ·{' '}
        {live ? `${symbols.length - layout.unquoted.length}/${symbols.length} quoted` : 'quotes loading'}
        {layout.unquoted.length ? ` · unquoted: ${layout.unquoted.slice(0, 6).join(', ')}${layout.unquoted.length > 6 ? '…' : ''}` : ''}
      </div>
    </div>
  )
}

function hoverPos(px: number, py: number, wrap: HTMLDivElement | null): { left: number; top: number } {
  const w = wrap?.clientWidth ?? 600
  const left = px + 170 > w ? Math.max(0, px - 170) : px + 14
  return { left, top: Math.max(0, py + 14) }
}
