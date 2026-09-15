// SessionBands — the extended-hours shading behind a stock's intraday candles
// (lib/chart-sessions decides which bars are quiet). A series primitive on the
// engine's 'bottom' layer, which paints after the background and before the
// grid and the series: the grid lines and every candle stay on top of the
// tint. Each run of extended bars is one band, from half a bar before its
// first bar to half a bar after its last, so a band meets the regular
// session's candles edge to edge.

import type { IChartApiBase, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { SessionRun } from '@/lib/chart-sessions'

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]

/** Bar spacing (css px) where the tint is at full strength, and where it is gone.
 *  Zoomed far out, a band per session reads as a barcode, so it fades between. */
const FULL_TINT_SPACING = 4
const NO_TINT_SPACING = 1.5

export class SessionBands implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private requestUpdate: (() => void) | null = null
  private runs: readonly SessionRun[] = []
  private color = 'transparent'
  /** Media-space x spans of the runs in view, rebuilt on every viewport change. */
  private spans: { x0: number; x1: number }[] = []
  private spacing = 0
  private readonly renderer: IPrimitivePaneRenderer = { draw: (target) => this.paint(target) }
  private readonly views: readonly IPrimitivePaneView[] = [{ zOrder: () => 'bottom', renderer: () => (this.spans.length ? this.renderer : null) }]

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart
    this.requestUpdate = requestUpdate
  }

  detached(): void {
    this.chart = null
    this.requestUpdate = null
  }

  /** Replace the runs (bar indices into the series' data) and the tint. */
  update(runs: readonly SessionRun[], color: string): void {
    this.runs = runs
    this.color = color
    this.requestUpdate?.()
  }

  updateAllViews(): void {
    const ts = this.chart?.timeScale()
    const view = ts?.getVisibleLogicalRange()
    this.spans = []
    if (!ts || !view || this.runs.length === 0) return
    // The engine converts whole bar indices only: a fractional logical comes
    // back as x = 0 (5.2.1's indexToCoordinate), so a band's edges are its end
    // bars' centers, pushed out by half a bar measured between two neighbours.
    const anchor = Math.max(0, Math.floor(view.from))
    const a = ts.logicalToCoordinate(anchor as Logical)
    const b = ts.logicalToCoordinate((anchor + 1) as Logical)
    if (a === null || b === null || b <= a) return
    this.spacing = b - a
    const half = this.spacing / 2
    for (const run of this.runs) {
      if (run.to < view.from - 1 || run.from > view.to + 1) continue
      const x0 = ts.logicalToCoordinate(run.from as Logical)
      const x1 = ts.logicalToCoordinate(run.to as Logical)
      if (x0 !== null && x1 !== null) this.spans.push({ x0: x0 - half, x1: x1 + half })
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }

  private paint(target: Target): void {
    const strength = Math.min(1, Math.max(0, (this.spacing - NO_TINT_SPACING) / (FULL_TINT_SPACING - NO_TINT_SPACING)))
    if (strength === 0) return
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      context.save()
      context.globalAlpha = strength
      context.fillStyle = this.color
      for (const { x0, x1 } of this.spans) {
        const left = Math.round(x0 * horizontalPixelRatio)
        const right = Math.round(x1 * horizontalPixelRatio)
        if (right > left) context.fillRect(left, 0, right - left, bitmapSize.height)
      }
      context.restore()
    })
  }
}
