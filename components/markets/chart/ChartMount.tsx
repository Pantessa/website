'use client'

// The ONE mount point for the symbol page's chart. SHELL owns the frame
// around it; the CHART lane replaces the internals (lightweight-charts,
// drawings → orders, news-on-bars) behind this same prop surface without
// touching the frame. Today it is a thin wrapper around CandleChart.

import type { ReactNode } from 'react'
import CandleChart, { type ChartStats } from '@/components/CandleChart'
import type { ChartTf } from '@/lib/charts'

export type { ChartStats }

export interface ChartMountProps {
  symbol: string
  /** Fixed pixel height, or 'fill' to take the flex parent's remaining space. */
  height?: number | 'fill'
  defaultTf?: ChartTf
  /** Fires whenever fresh candles land — the header reads last/chg off it. */
  onStats?: (s: ChartStats) => void
  /** Extra control beside the live badge (the frame's expand toggle). */
  controlsRight?: ReactNode
  /** Bump to force a re-measure (expand/collapse). */
  resizeKey?: string | number | boolean
}

export default function ChartMount({ symbol, height = 'fill', defaultTf, onStats, controlsRight, resizeKey }: ChartMountProps) {
  return (
    <CandleChart
      symbol={symbol}
      height={height}
      defaultTf={defaultTf}
      onStats={onStats}
      controlsRight={controlsRight}
      resizeKey={resizeKey}
    />
  )
}
