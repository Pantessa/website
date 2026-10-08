// ─────────────────────────────────────────────────────────────────────────
//  The share image — the chart as a picture someone posts.
//
//  The engine hands over its own canvas (candles, axes, overlays); this draws
//  the drawings back on top (they live in an SVG layer the screenshot never
//  sees), a header that says what the picture is (symbol, frame, price, the
//  UTC minute it was taken), and the Pantessa watermark with the page's
//  address, bottom-left inside the plot. A chart that leaves the site should
//  say where it came from and where it can be traded: the watermark is the
//  link back.
//
//  Browser only (canvas). The text helpers are pure and pinned.
// ─────────────────────────────────────────────────────────────────────────

import type { ChartLine } from './chart-state'
import type { DrawSpace } from './chart-draw'
import { trendReadout, fibLevels } from './chart-draw'
import { gemMarkSvg } from './og-marks'

export interface ShareTokens {
  accent: string
  sell: string
  fg: string
  bg: string
  line: string
  muted: string
  muted2: string
  surf: string
}

export interface ShareImageInput {
  /** `chart.takeScreenshot()` — device pixels. */
  shot: HTMLCanvasElement
  /** The plot's CSS size: the drawing coordinates are in these pixels. */
  cssWidth: number
  cssHeight: number
  geom: DrawSpace & { plotRight: number; barSec: number }
  lines: ChartLine[]
  symbol: string
  /** "Apple · Robinhood Chain · 24/7" — the pair's own label. */
  label?: string | null
  tfLabel: string
  last: number | null
  changePct: number | null
  tokens: ShareTokens
  /** Extra header line on a published call ("CALLED 14:02 UTC · $336.13"). */
  stamp?: string | null
  now?: Date
}

/** The address printed in the watermark: no scheme, no www. */
export function watermarkUrl(symbol: string, callId?: string | null): string {
  return callId ? `pantessa.com/c/${callId}` : `pantessa.com/t/${symbol}`
}

/** "2026-10-05 14:02 UTC" — a picture of a price needs its minute on it. */
export function shotTimeLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

export function sharePrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

export function shareFileName(symbol: string, tfLabel: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `pantessa-${symbol}-${tfLabel}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.png`.toLowerCase()
}

const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const SANS = "Geist, 'Hanken Grotesk', system-ui, sans-serif"
const SERIF = "Fraunces, 'Instrument Serif', Georgia, serif"
const HEADER_H = 58

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const sellish = (l: ChartLine) => (l.kind === 'h' || l.kind === 'zone') && (l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect')

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, t: ShareTokens, stroke: string) {
  ctx.font = `500 10px ${MONO}`
  const w = Math.ceil(ctx.measureText(text).width) + 12
  ctx.fillStyle = t.surf
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, w, 18, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = t.fg
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 6, y + 9.5)
}

function drawLines(ctx: CanvasRenderingContext2D, input: ShareImageInput) {
  const { geom, lines, tokens: t, cssHeight } = input
  const plotW = Math.max(0, geom.plotRight)
  const clampY = (y: number) => Math.max(2, Math.min(cssHeight - 20, y))
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, plotW, cssHeight)
  ctx.clip()
  for (const l of lines) {
    if (l.kind !== 'zone') continue
    const y1 = geom.priceToY(l.p1)
    const y2 = geom.priceToY(l.p2)
    if (y1 === null || y2 === null) continue
    const top = Math.min(y1, y2)
    const ink = sellish(l) ? t.sell : l.action ? t.accent : t.muted
    ctx.globalAlpha = 0.14
    ctx.fillStyle = ink
    ctx.fillRect(0, top, plotW, Math.max(2, Math.abs(y2 - y1)))
    ctx.globalAlpha = 1
    ctx.font = `500 10px ${MONO}`
    ctx.fillStyle = ink
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(`${l.label ?? (l.action ? l.action.kind : 'zone')} ${sharePrice(Math.min(l.p1, l.p2))}–${sharePrice(Math.max(l.p1, l.p2))}`, 8, Math.max(12, top + 12))
  }
  for (const l of lines) {
    if (l.kind === 'h') {
      const y = geom.priceToY(l.price)
      if (y === null) continue
      const ink = sellish(l) ? t.sell : l.action ? t.accent : t.muted
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.setLineDash(l.action ? [] : [5, 4])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(plotW, y)
      ctx.stroke()
      ctx.setLineDash([])
      pill(ctx, 8, clampY(y - 9), `${l.label ?? (l.action ? l.action.kind : 'level')} · ${sharePrice(l.price)}`, t, ink)
    } else if (l.kind === 'vline') {
      const x = geom.timeToX(l.t)
      if (x === null || x < 0 || x > plotW) continue
      ctx.strokeStyle = t.muted
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssHeight)
      ctx.stroke()
      ctx.setLineDash([])
      if (l.label) {
        ctx.font = `500 10px ${MONO}`
        ctx.fillStyle = t.muted
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(l.label, Math.min(x + 6, plotW - 8 - ctx.measureText(l.label).width), 14)
      }
    } else if (l.kind === 'fib') {
      const x1 = geom.timeToX(l.t1)
      const x2 = geom.timeToX(l.t2)
      const y1 = geom.priceToY(l.p1)
      const y2 = geom.priceToY(l.p2)
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue
      const left = Math.max(0, Math.min(x1, x2))
      ctx.font = `500 9.5px ${MONO}`
      ctx.textBaseline = 'alphabetic'
      for (const lv of fibLevels(l.p1, l.p2)) {
        const y = geom.priceToY(lv.price)
        if (y === null || y < 0 || y > cssHeight) continue
        const end = lv.ratio === 0 || lv.ratio === 1
        ctx.strokeStyle = lv.ratio > 1 ? t.muted : end ? t.fg : t.accent
        ctx.globalAlpha = end ? 0.5 : 0.65
        ctx.lineWidth = 1
        ctx.setLineDash(lv.ratio > 1 ? [3, 3] : [])
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(plotW, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        const words = `${lv.label} · ${sharePrice(lv.price)}`
        ctx.fillStyle = t.muted
        ctx.fillText(words, plotW - 6 - ctx.measureText(words).width, Math.max(10, y - 3))
      }
      ctx.strokeStyle = t.muted
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (l.kind === 'trend') {
      const x1 = geom.timeToX(l.t1)
      const x2 = geom.timeToX(l.t2)
      const y1 = geom.priceToY(l.p1)
      const y2 = geom.priceToY(l.p2)
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue
      // The extension (a ray, or the whole line) draws lighter, under the segment.
      if (l.extend && x1 !== x2) {
        const slope = (y2 - y1) / (x2 - x1)
        const at = (x: number) => y1 + (x - x1) * slope
        const right = x2 >= x1
        const far = right ? plotW : 0
        const near = right ? 0 : plotW
        ctx.strokeStyle = t.muted
        ctx.lineWidth = 1
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        if (l.extend === 'both') ctx.moveTo(near, at(near))
        else ctx.moveTo(x2, y2)
        ctx.lineTo(far, at(far))
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.strokeStyle = t.fg
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.fillStyle = t.fg
      for (const [x, y] of [[x1, y1], [x2, y2]] as const) {
        ctx.beginPath()
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.font = `500 10px ${MONO}`
      ctx.fillStyle = t.muted
      ctx.textBaseline = 'alphabetic'
      const words = [l.label, trendReadout(l.p1, l.p2, l.t1, l.t2, geom.barSec)].filter(Boolean).join(' · ')
      ctx.fillText(words, Math.min(Math.max(8, x2 + 8), plotW - 8 - ctx.measureText(words).width), Math.max(12, y2 - 8))
    } else if (l.kind === 'note') {
      const x = geom.timeToX(l.t)
      const y = geom.priceToY(l.price)
      if (x === null || y === null) continue
      ctx.fillStyle = t.accent
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `500 11px ${SANS}`
      ctx.fillStyle = t.fg
      ctx.textBaseline = 'alphabetic'
      const words = l.text.length > 64 ? `${l.text.slice(0, 63)}…` : l.text
      ctx.fillText(words, Math.min(Math.max(8, x + 9), Math.max(8, plotW - 8 - ctx.measureText(words).width)), Math.max(12, y - 8))
    }
  }
  ctx.restore()
}

/** The watermark: the Emerald Cut, the wordmark, the page's address. */
function drawWatermark(ctx: CanvasRenderingContext2D, mark: HTMLImageElement | null, x: number, bottom: number, url: string, t: ShareTokens) {
  const h = 34
  ctx.font = `600 17px ${SERIF}`
  const wordW = ctx.measureText('pantessa').width
  ctx.font = `500 9.5px ${MONO}`
  const urlW = ctx.measureText(url).width
  const w = 10 + 22 + 8 + Math.max(wordW, urlW) + 12
  const y = bottom - h
  ctx.globalAlpha = 0.86
  ctx.fillStyle = t.bg
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 9)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = t.line
  ctx.lineWidth = 1
  ctx.stroke()
  if (mark) ctx.drawImage(mark, x + 8, y + 6, 22, 22)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = t.fg
  ctx.font = `600 17px ${SERIF}`
  ctx.fillText('pantessa', x + 38, y + 17)
  ctx.fillStyle = t.muted2
  ctx.font = `500 9.5px ${MONO}`
  ctx.fillText(url, x + 38.5, y + 28)
}

/**
 * Compose the picture. Returns a canvas at the screenshot's own pixel
 * density (a 2x display gives a 2x image). `callId` re-points the watermark
 * at a published call.
 */
export async function composeShareImage(input: ShareImageInput & { callId?: string | null }): Promise<HTMLCanvasElement> {
  const { shot, cssWidth, cssHeight, tokens: t } = input
  const scale = shot.width > 0 && cssWidth > 0 ? shot.width / cssWidth : 1
  const out = document.createElement('canvas')
  out.width = Math.round(cssWidth * scale)
  out.height = Math.round((cssHeight + HEADER_H) * scale)
  const ctx = out.getContext('2d')
  if (!ctx) return shot
  try {
    await Promise.all([document.fonts?.load(`600 17px Fraunces`), document.fonts?.load(`600 20px Geist`), document.fonts?.load(`500 10px 'Geist Mono'`)])
  } catch {
    /* the fallbacks draw */
  }
  const mark = await loadImage(`data:image/svg+xml;base64,${btoa(gemMarkSvg())}`)
  ctx.scale(scale, scale)
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, cssWidth, cssHeight + HEADER_H)

  // header: what this is a picture of
  const now = input.now ?? new Date()
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = t.fg
  ctx.font = `600 22px ${SANS}`
  ctx.fillText(input.symbol, 14, 28)
  let x = 14 + ctx.measureText(input.symbol).width + 10
  ctx.font = `500 11px ${MONO}`
  ctx.fillStyle = t.muted2
  ctx.fillText(input.tfLabel.toUpperCase(), x, 27)
  x += ctx.measureText(input.tfLabel.toUpperCase()).width + 14
  if (input.last !== null) {
    ctx.font = `600 18px ${SANS}`
    ctx.fillStyle = t.fg
    const price = `$${sharePrice(input.last)}`
    ctx.fillText(price, x, 28)
    x += ctx.measureText(price).width + 9
    if (input.changePct !== null && Number.isFinite(input.changePct)) {
      ctx.font = `600 12px ${SANS}`
      ctx.fillStyle = input.changePct >= 0 ? t.accent : t.sell
      const chg = `${input.changePct >= 0 ? '▲' : '▼'} ${Math.abs(input.changePct).toFixed(2)}% 24h`
      ctx.fillText(chg, x, 27)
      x += ctx.measureText(chg).width
    }
  }
  const headEnd = x
  // The minute sits top-right when the first line has room for it; on a
  // narrow picture (a phone) it drops to the second line, so it never runs
  // into the price.
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = t.muted2
  const when = shotTimeLabel(now)
  const whenX = cssWidth - 14 - ctx.measureText(when).width
  const tight = headEnd > whenX - 12
  ctx.fillText(when, whenX, tight ? 46 : 27)
  let sub = [input.stamp, input.label].filter(Boolean).join(' · ')
  const subMax = (tight ? whenX - 12 : cssWidth - 14) - 14
  while (sub.length > 1 && ctx.measureText(sub).width > subMax) sub = `${sub.slice(0, -2)}…`
  if (sub.length > 1) ctx.fillText(sub, 14, 46)

  // the engine's picture, then the drawings it never saw
  ctx.drawImage(shot, 0, HEADER_H, cssWidth, cssHeight)
  ctx.save()
  ctx.translate(0, HEADER_H)
  drawLines(ctx, input)
  // bottom-left, clear of the time axis (the engine's last ~26px)
  drawWatermark(ctx, mark, 10, cssHeight - 34, watermarkUrl(input.symbol, input.callId), t)
  ctx.restore()
  return out
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
