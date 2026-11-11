'use client'

// The one door: type a handle, pick a side, plot it. CONTRACT STUB (squad
// called-it): lane CHART owns this file and replaces the body (suggestions,
// the scan button and its progress, refusals with somewhere to go). The props
// are the contract; lane RECORD mounts it with variant="page".
import { useState } from 'react'
import { chartHref, normalizeHandle, recordHref, type CalledSide } from '@/lib/called-it/spec'

export interface HandleDoorProps {
  /** The market to plot on. The page variant may leave it out and ask. */
  symbol?: string
  initialHandle?: string
  side?: CalledSide
  /** `chart` lives on the symbol page and plots in place; `page` lives on /x and navigates to the record. */
  variant: 'chart' | 'page'
  /** Chart variant: called with a valid handle and side instead of navigating. */
  onPlot?: (handle: string, side: CalledSide) => void
  className?: string
}

export default function HandleDoor({ symbol = 'BTC', initialHandle = '', side = 'all', variant, onPlot, className }: HandleDoorProps) {
  const [value, setValue] = useState(initialHandle)
  const handle = normalizeHandle(value)
  return (
    <form
      className={className}
      data-variant={variant}
      onSubmit={(e) => {
        e.preventDefault()
        if (!handle) return
        if (onPlot) onPlot(handle, side)
        else window.location.href = variant === 'chart' ? chartHref(handle, symbol, side) : recordHref(handle, symbol, side)
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="@handle" aria-label="X handle" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="submit" disabled={!handle} data-journey="called_plot">
        Plot
      </button>
    </form>
  )
}
