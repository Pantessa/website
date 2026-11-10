'use client'

// The Heatmap — a year of positioning, the contribution-graph way: one cell
// per UTC day of the long/short account share (lib/derivs heatCells), inked
// against the coin's own typical day (a coin's crowd is structurally
// one-sided, so 50/50 would paint the whole year one colour).
//
// 2026-11-10 (Nate: "remove the dune tape and make the graph higher … replace
// the Tape bar with heatmap"): it was a strip under the candles beside Dune's
// executions table; the table is gone and the year is a chart VIEW now
// (`?view=heat`, the Tape's seat on the switch), so the candles keep the whole
// card. The Battlefield's Heatmap board renders the same grid.

import { useEffect, useMemo, useState } from 'react'
import type { Candle } from '@/lib/charts'
import { fieldDate } from '@/lib/battlefield'
import { DAY_SEC, fmtUsdShort, heatCells, heatMedian, heatSummary, heatTone, type DerivsBody, type HeatCell } from '@/lib/derivs'
import './battlefield.css'

/** The daily series for a symbol: positioning (the derivs route on 1D) and
 *  the daily bars for each day's price move. Fetched while `enabled`. */
export function useHeatYear(symbol: string, enabled: boolean) {
  const [derivs, setDerivs] = useState<DerivsBody | null>(null)
  const [bars, setBars] = useState<Candle[]>([])
  // A failed read is named and retried in 30s, not left on "Reading the year…"
  // until the 5-minute lap (pre-gtm POLISH r2).
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setDerivs(null)
    setBars([])
    setFailed(false)
    if (!enabled) return
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const [d, c] = await Promise.all([
          fetch(`/api/markets/derivs?symbol=${encodeURIComponent(symbol)}&tf=1d`, { cache: 'no-store' }).then((r) => r.json() as Promise<DerivsBody>),
          fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1d&warmup=1`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ candles?: Candle[]; warmup?: Candle[] }>),
        ])
        if (!alive) return
        if (Array.isArray(d.oi)) setDerivs(d)
        if (Array.isArray(c.candles)) setBars([...(c.warmup ?? []), ...c.candles])
        setFailed(false)
      } catch {
        if (!alive) return
        setFailed(true)
        clearTimeout(retry)
        retry = setTimeout(() => void load(), 30_000)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 300_000)
    return () => {
      alive = false
      clearInterval(timer)
      clearTimeout(retry)
    }
  }, [symbol, enabled])
  const cells = useMemo(() => (derivs ? heatCells(derivs.ratio, derivs.oi, bars, Date.now() / 1000) : []), [derivs, bars])
  const summary = useMemo(() => (cells.length ? heatSummary(cells) : null), [cells])
  return { derivs, cells, summary, failed }
}

export type HeatYear = ReturnType<typeof useHeatYear>

export interface HeatViewProps {
  /** The year the chart already read (it decides whether the view is offered). */
  year: HeatYear
  /** The last price, to put a dollar figure on a day's open interest. */
  mark: number | null
}

/** The view: a headline, the key, the grid, a day's report on hover. */
export default function HeatView({ year, mark }: HeatViewProps) {
  const { derivs, cells, summary, failed } = year
  const [hover, setHover] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)
  const lean = summary?.streak && summary.streak.days >= 3 ? summary.streak.side : null
  return (
    <section className="poshet heatview" aria-label="Positioning by day">
      <header className="poshet__head">
        <span className="poshet__k mono">Positioning by day{derivs?.source ? ` · ${derivs.source} accounts` : ''}</span>
        <span className={`poshet__v${lean === 'long' ? ' is-up' : lean === 'short' ? ' is-down' : ''}`}>{summary ? summary.headline : derivs ? 'No daily read for this coin' : failed ? 'Couldn’t read the year · retrying' : 'Reading the year…'}</span>
        <span className="poshet__key mono">
          short <i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 100%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-down, var(--sell)) 55%, var(--surf-1))' }} /><i style={{ background: 'var(--surf-1)' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 55%, var(--surf-1))' }} /><i style={{ background: 'color-mix(in oklch, var(--mk-up, var(--accent)) 100%, var(--surf-1))' }} /> long
          {summary?.median != null ? ` · usual ${Math.round(summary.median * 100)}% long` : ''}
        </span>
      </header>
      <div className="poshet__body">
        <HeatGrid cells={cells} source={derivs?.source ?? null} onHover={setHover} />
        {hover && (
          <div className={`bf__tip bf__tip--${(hover.cell.long ?? 0.5) >= (summary?.median ?? 0.5) ? 'bulls' : 'bears'}`} style={{ left: Math.max(8, hover.x - 130), top: Math.max(4, hover.y - 118) }} role="status">
            <span className="bf__tip-k mono">{fieldDate(hover.cell.day, '1d').month} {fieldDate(hover.cell.day, '1d').day}, {fieldDate(hover.cell.day, '1d').year}</span>
            <strong>{hover.cell.long === null ? 'No reading that day' : `${Math.round(hover.cell.long * 100)}% long · ${100 - Math.round(hover.cell.long * 100)}% short${summary?.median != null ? ` · ${hover.cell.long - summary.median >= 0 ? '+' : '\u2212'}${Math.abs((hover.cell.long - summary.median) * 100).toFixed(0)} pts vs usual` : ''}`}</strong>
            {hover.cell.pricePct !== null ? <span>price {hover.cell.pricePct >= 0 ? '+' : '\u2212'}{Math.abs(hover.cell.pricePct).toFixed(1)}% that day</span> : null}
            {hover.cell.oi !== null && derivs && mark ? <span>open interest {fmtUsdShort(derivs.oiUnit === 'coin' ? hover.cell.oi * mark : hover.cell.oi)}</span> : null}
          </div>
        )}
      </div>
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
              // A label spans three weeks from the month's first; one that begins in the
              // year's last weeks ends at the grid's edge instead, so it never runs past it.
              <span key={`${m.col}-${m.label}`} style={m.col + 3 > weeks.length ? { gridColumn: `${Math.max(1, weeks.length - 2)} / ${weeks.length + 1}`, justifySelf: 'end' } : { gridColumnStart: m.col + 1 }}>
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
                      const host = (e.currentTarget as HTMLElement).closest('.bf, .poshet__body') as HTMLElement | null
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
