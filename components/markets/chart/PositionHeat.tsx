'use client'

// PositionHeat — a year of positioning under the candles, the contribution-
// graph way (Nate, 2026-10-06: "I love the heatmap, let's put that under the
// main candle chart"). One cell per UTC day of the long/short account share
// (lib/derivs heatCells), inked against the coin's own typical day: a coin's
// crowd is structurally one-sided, so 50/50 would paint the whole year one
// colour. The Battlefield's Heatmap board renders the same grid.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Candle, ChartPair } from '@/lib/charts'
import { fieldDate } from '@/lib/battlefield'
import { DAY_SEC, fmtUsdShort, heatCells, heatMedian, heatSummary, heatTone, type DerivsBody, type HeatCell } from '@/lib/derivs'
import './battlefield.css'

const OPEN_KEY = 'pantessa.heat.open.v1'

/** The daily series for a symbol: positioning (the derivs route on 1D) and
 *  the daily bars for each day's price move. Fetched while `enabled`. */
export function useHeatYear(symbol: string, enabled: boolean) {
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  const [bars, setBars] = useState<Candle[]>([])
  useEffect(() => {
    setDerivs(null)
    setBars([])
    if (!enabled) return
    let alive = true
    const load = async () => {
      try {
        const [d, c] = await Promise.all([
          fetch(`/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=1d`, { cache: 'no-store' }).then((r) => r.json() as Promise<DerivsBody>),
          fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1d&warmup=1`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ candles?: Candle[]; warmup?: Candle[] }>),
        ])
        if (!alive) return
        if (Array.isArray(d.oi)) setDerivs(d)
        if (Array.isArray(c.candles)) setBars([...(c.warmup ?? []), ...c.candles])
      } catch {
        /* the strip says it is still reading */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 300_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [symbol, enabled])
  const cells = useMemo(() => (derivs ? heatCells(derivs.ratio, derivs.oi, bars, Date.now() / 1000) : []), [derivs, bars])
  const summary = useMemo(() => (cells.length ? heatSummary(cells) : null), [cells])
  return { derivs, cells, summary }
}

export interface PositionHeatProps {
  symbol: string
  pair: ChartPair
  /** The last price, to put a dollar figure on a day's open interest. */
  mark: number | null
}

/** The strip under the candles: a header line, the grid, a day's report on hover. */
export default function PositionHeat({ symbol, pair, mark }: PositionHeatProps) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY)
      if (v === '0' || v === '1') setOpen(v === '1')
    } catch {
      /* default open */
    }
  }, [])
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        /* this visit only */
      }
      return !o
    })
  }
  const noMarket = pair.source === 'robinhood'
  const { derivs, cells, summary } = useHeatYear(symbol, open && !noMarket)
  const [hover, setHover] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)
  if (noMarket) return null
  const lean = summary?.streak && summary.streak.days >= 3 ? summary.streak.side : null
  return (
    <section className={`poshet${open ? ' is-open' : ''}`} aria-label="Positioning by day">
      <button type="button" className="poshet__head" onClick={toggle} aria-expanded={open}>
        <span className="poshet__k mono">Positioning by day{derivs?.source ? ` · ${derivs.source} accounts` : ''}</span>
        <span className={`poshet__v${lean === 'long' ? ' is-up' : lean === 'short' ? ' is-down' : ''}`}>{summary ? summary.headline : open ? (derivs ? 'No daily read for this coin' : 'Reading the year…') : 'A year of longs vs shorts, one cell a day'}</span>
        <span className="poshet__key mono">
          short <i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 100%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 55%, var(--surf-1))' }} /><i style={{ background: 'var(--surf-1)' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 55%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 100%, var(--surf-1))' }} /> long
          {summary?.median != null ? ` · usual ${Math.round(summary.median * 100)}% long` : ''}
        </span>
        <ChevronDown className={`poshet__chev h-3.5 w-3.5${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="poshet__body">
          <HeatGrid cells={cells} source={derivs?.source ?? null} onHover={setHover} />
          {hover && (
            <div className={`bf__tip bf__tip--${(hover.cell.long ?? 0.5) >= (summary?.median ?? 0.5) ? 'bulls' : 'bears'}`} style={{ left: Math.max(8, hover.x - 130), top: hover.y - 118 }} role="status">
              <span className="bf__tip-k mono">{fieldDate(hover.cell.day, '1d').month} {fieldDate(hover.cell.day, '1d').day}, {fieldDate(hover.cell.day, '1d').year}</span>
              <strong>{hover.cell.long === null ? 'No reading that day' : `${Math.round(hover.cell.long * 100)}% long · ${100 - Math.round(hover.cell.long * 100)}% short${summary?.median != null ? ` · ${hover.cell.long - summary.median >= 0 ? '+' : '\u2212'}${Math.abs((hover.cell.long - summary.median) * 100).toFixed(0)} pts vs usual` : ''}`}</strong>
              {hover.cell.pricePct !== null ? <span>price {hover.cell.pricePct >= 0 ? '+' : '\u2212'}{Math.abs(hover.cell.pricePct).toFixed(1)}% that day</span> : null}
              {hover.cell.oi !== null && derivs && mark ? <span>open interest {fmtUsdShort(derivs.oiUnit === 'coin' ? hover.cell.oi * mark : hover.cell.oi)}</span> : null}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The year as a contribution graph: columns are weeks (Sunday first),
 *  rows the days, each cell inked by that day's long/short share. */
export function HeatGrid({ cells, source, onHover }: { cells: HeatCell[]; source: string | null; onHover: (h: { cell: HeatCell; x: number; y: number } | null) => void }) {
  const center = heatMedian(cells) ?? 0.5
  const weeks: HeatCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const months: { col: number; label: string }[] = []
  weeks.forEach((w, col) => {
    const first = w.find((c) => new Date(c.day * 1000).getUTCDate() <= 7)
    if (first && (months.length === 0 || months[months.length - 1].label !== fieldDate(first.day, '1d').month)) months.push({ col, label: fieldDate(first.day, '1d').month })
  })
  const ink = (c: HeatCell) => {
    const tone = heatTone(c.long, center)
    if (tone === null) return 'var(--surf-1)'
    const side = tone >= 0 ? 'var(--mk-up, var(--accent))' : 'var(--mk-down, var(--sell))'
    return `color-mix(in oklch, ${side} ${Math.round(12 + 88 * Math.abs(tone))}%, var(--surf-1))`
  }
  const today = Math.floor(Date.now() / 1000 / DAY_SEC) * DAY_SEC
  return (
    <div className="bf__heat" onPointerLeave={() => onHover(null)}>
      {!cells.length ? (
        <p className="bf__empty mono">{source === null ? 'Reading the year…' : 'No daily positioning for this coin'}</p>
      ) : (
        <div className="bf__heat-scroll">
          <div className="bf__heat-months mono" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--hc))` }}>
            {months.map((m) => (
              <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="bf__heat-body">
            <div className="bf__heat-days mono">
              <span style={{ gridRowStart: 2 }}>Mon</span>
              <span style={{ gridRowStart: 4 }}>Wed</span>
              <span style={{ gridRowStart: 6 }}>Fri</span>
            </div>
            <div className="bf__heat-grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--hc))` }} role="img" aria-label="A year of daily long/short share, one cell a day">
              {weeks.map((w, col) =>
                w.map((c, row) => (
                  <i
                    key={c.day}
                    className={`bf__cell${c.day > today ? ' is-future' : ''}`}
                    style={{ gridColumnStart: col + 1, gridRowStart: row + 1, background: c.day > today ? 'transparent' : ink(c) }}
                    onPointerEnter={(e) => {
                      const host = (e.currentTarget as HTMLElement).closest('.bf, .poshet') as HTMLElement | null
                      const r = host?.getBoundingClientRect()
                      onHover(r ? { cell: c, x: e.clientX - r.left, y: e.clientY - r.top } : null)
                    }}
                  />
                )),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
