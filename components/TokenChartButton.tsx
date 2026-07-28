'use client'

// The uniform "see the chart" affordance. One glyph, two shapes, every
// surface: a hover-revealed icon on display-only rows (the ⓘ contract) and a
// labeled chip inside expanded action bands. Both open ChartOverlay via the
// store; both render NOTHING when lib/charts has no candle source for the
// symbol, so a dead pair never grows a button. Tokenized stocks start
// appearing everywhere at once the day the resolver learns them.

import { ChartCandlestick } from 'lucide-react'
import { useYeetfulStore } from '@/lib/store'
import { chartPairFor } from '@/lib/charts'

/** Hover-revealed icon for display-only rows — sits next to the ⓘ. */
export function ChartHoverButton({ symbol, alwaysVisible = false }: { symbol: string; alwaysVisible?: boolean }) {
  const setChartDetail = useYeetfulStore((s) => s.setChartDetail)
  const pair = chartPairFor(symbol)
  if (!pair) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setChartDetail({ symbol: pair.symbol })
      }}
      aria-label={`${pair.label} live chart`}
      title={`${pair.label} live chart`}
      className={`grid h-6 w-6 place-items-center rounded-md text-[color:var(--muted-2)] transition-all hover:bg-white/5 hover:text-white focus-visible:opacity-100${
        alwaysVisible ? '' : ' opacity-0 group-hover:opacity-100'
      }`}
    >
      <ChartCandlestick className="h-3.5 w-3.5" />
    </button>
  )
}

/** Labeled chip for expanded action bands (splash rows) — same visual
 *  language as the prompt chips, but a client action: no chat turn burned. */
export function ChartChip({ symbol }: { symbol: string }) {
  const setChartDetail = useYeetfulStore((s) => s.setChartDetail)
  const pair = chartPairFor(symbol)
  if (!pair) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setChartDetail({ symbol: pair.symbol })
      }}
      title={`${pair.label} live chart`}
      className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[color:var(--muted-2)] transition-colors hover:border-[var(--line-2)] hover:bg-white/5 hover:text-white"
    >
      <ChartCandlestick className="h-3 w-3" />
      Chart
    </button>
  )
}
