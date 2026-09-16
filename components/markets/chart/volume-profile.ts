// VolumeProfile — the visible bars' volume, binned by price, drawn as quiet
// horizontal bars anchored to the pane's right edge (the way a trader reads
// where the tape actually traded). A series primitive on the engine's
// 'bottom' layer (under the grid and every candle). The bin with the most
// volume (the point of control) wears the up ink; the rest the flat ink.
// Recomputed from the bars in view on every viewport change — no I/O.

import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { Candle } from '@/lib/charts'

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]

/** Price bins across the visible range. */
export const VP_BINS = 24
/** Widest bar as a share of the pane width. */
export const VP_MAX_WIDTH = 0.16

export interface VpBin {
  lo: number
  hi: number
  vol: number
  /** Up-close volume share (0..1) — drawn as the bar's brighter part. */
  up: number
}

/** Pure: bin the bars' volume by close price over [from, to] bar indices. */
export function profileBins(bars: readonly Candle[], from: number, to: number, bins = VP_BINS): { bins: VpBin[]; poc: number; max: number } {
  const lo = Math.max(0, Math.floor(from))
  const hi = Math.min(bars.length - 1, Math.ceil(to))
  if (hi < lo || bins <= 0) return { bins: [], poc: -1, max: 0 }
  let pLo = Infinity
  let pHi = -Infinity
  for (let i = lo; i <= hi; i++) {
    if (bars[i].l < pLo) pLo = bars[i].l
    if (bars[i].h > pHi) pHi = bars[i].h
  }
  if (!(pHi > pLo)) return { bins: [], poc: -1, max: 0 }
  const step = (pHi - pLo) / bins
  const out: VpBin[] = Array.from({ length: bins }, (_, b) => ({ lo: pLo + b * step, hi: pLo + (b + 1) * step, vol: 0, up: 0 }))
  const upVol = new Array<number>(bins).fill(0)
  for (let i = lo; i <= hi; i++) {
    const c = bars[i]
    // A bar's volume spreads evenly over the bins its range covers.
    const b0 = Math.min(bins - 1, Math.max(0, Math.floor((c.l - pLo) / step)))
    const b1 = Math.min(bins - 1, Math.max(0, Math.floor((c.h - pLo) / step - 1e-9)))
    const share = c.v / (b1 - b0 + 1)
    for (let b = b0; b <= b1; b++) {
      out[b].vol += share
      if (c.c >= c.o) upVol[b] += share
    }
  }
  let poc = -1
  let max = 0
  out.forEach((b, i) => {
    b.up = b.vol > 0 ? upVol[i] / b.vol : 0
    if (b.vol > max) {
      max = b.vol
      poc = i
    }
  })
  return { bins: out, poc, max }
}

export class VolumeProfile implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null
  private bars: readonly Candle[] = []
  private ink = 'rgba(128,128,128,0.5)'
  private poc = 'rgba(62,207,142,0.9)'
  private rows: { y0: number; y1: number; w: number; isPoc: boolean }[] = []
  private readonly renderer: IPrimitivePaneRenderer = { draw: (target) => this.paint(target) }
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'bottom', renderer: () => (this.rows.length ? this.renderer : null) }]

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart
    this.series = series as ISeriesApi<'Candlestick'>
    this.requestUpdate = requestUpdate
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  /** Replace the bars (empty = off) and the inks. */
  update(bars: readonly Candle[], ink: string, poc: string): void {
    this.bars = bars
    this.ink = ink
    this.poc = poc
    this.requestUpdate?.()
  }

  updateAllViews(): void {
    this.rows = []
    const ts = this.chart?.timeScale()
    const view = ts?.getVisibleLogicalRange()
    const s = this.series
    if (!ts || !view || !s || this.bars.length === 0) return
    const { bins, poc, max } = profileBins(this.bars, view.from as number, view.to as number)
    if (!bins.length || max <= 0) return
    for (let i = 0; i < bins.length; i++) {
      const b = bins[i]
      const y0 = s.priceToCoordinate(b.hi)
      const y1 = s.priceToCoordinate(b.lo)
      if (y0 === null || y1 === null) continue
      this.rows.push({ y0, y1, w: b.vol / max, isPoc: i === poc })
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }

  private paint(target: Target): void {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save()
      const maxW = bitmapSize.width * VP_MAX_WIDTH
      for (const r of this.rows) {
        const top = Math.round(r.y0 * verticalPixelRatio)
        const bottom = Math.round(r.y1 * verticalPixelRatio)
        const h = Math.max(1, bottom - top - Math.round(1 * verticalPixelRatio))
        const w = Math.max(1, Math.round(r.w * maxW))
        context.fillStyle = r.isPoc ? this.poc : this.ink
        context.fillRect(bitmapSize.width - w, top, w, h)
      }
      void horizontalPixelRatio
      context.restore()
    })
  }
}
