'use client'

// The on-plot readout: O · H · L · C, the move against the previous close and
// the bar's volume, for the bar under the crosshair (the newest bar when
// nothing is hovered). It reads the hovered bar from the shared hover store
// (lib/markets-ai-hover), so a crosshair move re-renders these few spans and
// never the chart around them. The numbers are lib/chart-legend's (pinned).
//
// A second line reads the lit moving averages at the same bar, each wearing
// its line's color (desktop only: a phone keeps one line over the plot).
//
// Pointer-transparent: the chart keeps every gesture.

import { useMemo } from 'react'
import { fmtPrice } from '@/components/CandleChart'
import type { Candle, ChartTf } from '@/lib/charts'
import { fmtLegendPct, fmtLegendTime, fmtLegendVol, legendOf } from '@/lib/chart-legend'
import { useChartHover } from '@/lib/markets-ai-hover'

export interface LegendLine {
  key: string
  label: string
  /** The CSS color the line draws with (OVERLAYS.swatch). */
  swatch: string
  at: Map<number, number | null>
}

export default function ChartLegend({ symbol, tf, bars, lines, hint }: { symbol: string; tf: ChartTf; bars: readonly Candle[]; lines?: LegendLine[]; hint?: string | null }) {
  const hoverT = useChartHover((s) => (s.symbol === symbol && s.bar ? s.bar.t : null))
  const read = useMemo(() => legendOf(bars, hoverT), [bars, hoverT])
  if (!read) return null
  const cell = (k: string, v: number) => (
    <span className="mkt-legend__cell">
      <span className="mkt-legend__k">{k}</span>
      {fmtPrice(v)}
    </span>
  )
  return (
    <div className={`mkt-legend mono mkt-legend--${read.dir}`} aria-hidden="true" data-legend-t={read.t}>
      <div className="mkt-legend__row">
        <span className="mkt-legend__when">{hoverT === null ? (read.live ? 'now' : '') : fmtLegendTime(read.t, tf)}</span>
        {cell('O', read.o)}
        {cell('H', read.h)}
        {cell('L', read.l)}
        {cell('C', read.c)}
        <span className="mkt-legend__chg">{fmtLegendPct(read.chgPct)}</span>
        {read.vol !== null && (
          <span className="mkt-legend__cell mkt-legend__vol">
            <span className="mkt-legend__k">Vol</span>
            {fmtLegendVol(read.vol)}
          </span>
        )}
      </div>
      {lines && lines.length > 0 && (
        <div className="mkt-legend__row mkt-legend__lines">
          {lines.map((ln) => {
            const v = ln.at.get(read.t)
            return (
              <span key={ln.key} className="mkt-legend__line">
                <i style={{ background: ln.swatch }} />
                <span className="mkt-legend__k">{ln.label}</span>
                {v === null || v === undefined ? '—' : fmtPrice(v)}
              </span>
            )
          })}
        </div>
      )}
      {hint && hoverT === null ? <div className="mkt-legend__hint">{hint}</div> : null}
    </div>
  )
}
