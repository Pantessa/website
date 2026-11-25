// THE CHART'S PICTURE on a dense screen (squad mobile-sleek, lane CHART, 2026-11-24).
//
// Share draws a picture of the chart. The library's own screenshot is right on
// a screen of one device pixel per CSS pixel; on a denser one (every phone, a
// retina laptop) it draws the pane at CSS size and the scales at device size:
// a 260px plot beside a price scale twice its type, the last-price label under
// the frame (measured on v33.1.0, 390x844 at 2x). So on those screens the
// picture is composed here, from what the chart has already drawn: every
// canvas inside the chart's table (the pane, both scales, and the marks layer
// of a plotted handle, lib/tv/called-overlay) copied at device resolution to
// where it stands, the symbol's line from the legend set over it, and a foot
// for the attribution, the page's address and a record's standing line.
//
// LICENCE: the library's logo is HTML over the pane and is in no canvas, so the
// foot names TradingView in words ("Charts by TradingView"): the attribution
// stays in every picture.
//
// Browser only; returns null wherever it cannot read the frame (the caller
// then takes the library's own screenshot).

export interface PictureInks {
  bg: string
  fg: string
  muted: string
  line: string
}

/** Px (CSS) of the foot under the chart: up to two lines of a record's standing, then the attribution and the address. */
export const PICTURE_FOOT_PX = 68
export const PICTURE_ATTRIBUTION = 'Charts by TradingView'

/** Does this screen need the composed picture? */
export function needsComposedPicture(dpr: number): boolean {
  return Number.isFinite(dpr) && dpr > 1.01
}

export function composeChartPicture(host: HTMLElement | null | undefined, inks: PictureInks, family: string): HTMLCanvasElement | null {
  try {
    const frame = host?.querySelector('iframe')
    const doc = frame?.contentDocument
    const table = doc?.querySelector('.chart-markup-table')
    if (!frame || !doc || !table || typeof document === 'undefined') return null
    const dpr = frame.contentWindow?.devicePixelRatio || 1
    const box = table.getBoundingClientRect()
    if (!(box.width > 40) || !(box.height > 40)) return null
    const out = document.createElement('canvas')
    out.width = Math.round(box.width * dpr)
    out.height = Math.round((box.height + PICTURE_FOOT_PX) * dpr)
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = inks.bg
    ctx.fillRect(0, 0, out.width, out.height)
    let drawn = 0
    for (const cv of Array.from(table.querySelectorAll('canvas'))) {
      const r = cv.getBoundingClientRect()
      if (!(r.width > 0) || !(r.height > 0) || !(cv.width > 0) || !(cv.height > 0)) continue
      ctx.drawImage(cv, Math.round((r.left - box.left) * dpr), Math.round((r.top - box.top) * dpr), Math.round(r.width * dpr), Math.round(r.height * dpr))
      drawn++
    }
    if (!drawn) return null
    // The symbol's line (the legend is HTML): its own words, where it stands.
    const title = doc.querySelector('[data-qa-id="legend-series-item"] [data-qa-id="legend-titles"], [data-qa-id="legend-series-item"]')
    const words = title
      ? Array.from(title.querySelectorAll('[data-qa-id^="title-wrapper"]'))
          .map((el) => (el.textContent ?? '').trim())
          .filter(Boolean)
          .join(' · ')
      : ''
    if (title && words) {
      const r = title.getBoundingClientRect()
      const px = Math.max(11, Math.min(16, parseFloat(doc.defaultView?.getComputedStyle(title).fontSize ?? '14') || 14))
      ctx.font = `${Math.round(px * dpr)}px ${family}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillStyle = inks.muted
      ctx.fillText(words, Math.round((r.left - box.left) * dpr), Math.round((r.top - box.top + r.height / 2) * dpr))
    }
    // The foot: one hairline, then the attribution at the left of its last line (the caller writes the rest).
    const footTop = Math.round(box.height * dpr)
    ctx.fillStyle = inks.line
    ctx.fillRect(0, footTop, out.width, Math.max(1, Math.round(dpr)))
    return out
  } catch {
    return null
  }
}
