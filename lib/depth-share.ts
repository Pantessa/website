// SHARE THE DEPTH (2026-11-17). Nate, on /t/UNI's Depth view: "can we add a
// link to share on x the snapshot of the depth with a meta tag of the depth?"
//
// The chart's Share already links the Depth view (`/t/UNI?view=depth&win=10`),
// but X drew the symbol's candle card for it. Now a `?view=depth` link names
// its own image, `/api/og/depth?symbol=UNI&win=10`, which draws the venue's
// book as it stands when X reads the link: the two stepped sides, the mid, the
// walls, the dollars resting per side inside the window.
//
// This module is the pure half: the image's address, the query it reads, the
// curve as one SVG string (satori draws it as an <img>; the labels are laid
// out by the card from the numbers returned here, never as SVG text, which
// satori's rasteriser cannot set without a font), and the words. Pinned in
// scripts/depth-pins.ts.

import { DEFAULT_DEPTH_SETTINGS, DEPTH_WINDOWS, fmtDepthPrice, fmtDepthSize, fmtDepthUsd, parseDepthSettings, wallsIn, writeDepthParams, type CumLevel, type DepthSettings, type DepthUnit, type DepthVenue, type DepthWindow } from './depth'
import { X_MENTION } from './social'

/** The image route. Under /api/og/, which robots.txt allows (X's card bot obeys it). */
export const DEPTH_OG_PATH = '/api/og/depth'

/**
 * The image a Depth link names. The window and the unit ride along (the
 * overlay is not drawn on the card). `stamp` is the minute the page was
 * rendered: X caches a card image by its URL, so two shares a day apart
 * name two images and the second never shows the first one's book.
 */
export function depthOgPath(symbol: string, settings: DepthSettings | null, stamp?: number | null): string {
  const p = new URLSearchParams({ symbol })
  writeDepthParams(p, settings ? { ...settings, overlay: false } : null)
  if (stamp != null && Number.isFinite(stamp)) p.set('t', String(Math.floor(stamp / 60_000)))
  return `${DEPTH_OG_PATH}?${p.toString()}`
}

/** What the image route reads: the symbol (letters and digits, the book routes' rule) and the view's settings. */
export function parseDepthOgQuery(search: string): { symbol: string; settings: DepthSettings } | null {
  const p = new URLSearchParams(search)
  const symbol = p.get('symbol') ?? ''
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) return null
  return { symbol, settings: { ...parseDepthSettings(search), overlay: false } }
}

/** The window's words: "±10%", or "the whole book". */
export function depthWindowWords(pct: number | null): string {
  if (pct == null) return 'the whole book'
  return `±${DEPTH_WINDOWS.find((w) => w.pct === pct)?.label ?? `${pct}%`}`
}

/** The card's lead: which side holds more inside the window, by how much. */
export function depthLean(w: Pick<DepthWindow, 'bidUsd' | 'askUsd'>): { side: 'bid' | 'ask' | 'even'; ratio: number | null; words: string } {
  const { bidUsd, askUsd } = w
  if (!(bidUsd > 0) && !(askUsd > 0)) return { side: 'even', ratio: null, words: 'Nothing resting in this window' }
  if (!(askUsd > 0)) return { side: 'bid', ratio: null, words: 'Only bids in this window' }
  if (!(bidUsd > 0)) return { side: 'ask', ratio: null, words: 'Only asks in this window' }
  const ratio = bidUsd >= askUsd ? bidUsd / askUsd : askUsd / bidUsd
  if (ratio < 1.1) return { side: 'even', ratio, words: 'Bids and asks about even' }
  const x = ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)
  return bidUsd >= askUsd ? { side: 'bid', ratio, words: `${x}× more bids than asks` } : { side: 'ask', ratio, words: `${x}× more asks than bids` }
}

/** The post X opens with. The numbers are on the card; the words say what the link does. */
/** `rests`: a level on this book takes a limit order (lib/depth levelActsFor: a Coinbase coin). */
export function depthTweetHref(symbol: string, url: string, pct: number | null = DEFAULT_DEPTH_SETTINGS.pct, rests = false): string {
  const act = rests ? 'Click a level to rest an order there' : 'Trade from the chart'
  const text = `$${symbol} order book, live: every bid and ask within ${depthWindowWords(pct)} of the mid. ${act}, via ${X_MENTION}:`
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url }).toString()}`
}

/** The card's title and description (og: + twitter:). */
export function depthCardMeta(symbol: string, settings: DepthSettings, rests = false): { title: string; description: string; alt: string } {
  const win = depthWindowWords(settings.pct)
  const act = rests ? 'Click a level to rest a limit order there' : 'Trade from the chart'
  return {
    title: `${symbol} order book depth · Pantessa`,
    description: `Every bid and ask on ${symbol} within ${win} of the mid, read live from the venue's book. ${act}; your wallet signs.`,
    alt: `${symbol} order book depth within ${win}: bids against asks, with the walls marked`,
  }
}

export interface DepthCurveOptions {
  width: number
  height: number
  unit: DepthUnit
  bid: string
  ask: string
  /** The fill under each side, as an rgba() (satori renders no color-mix). */
  bidFill: string
  askFill: string
  grid: string
  mid: string
}

export interface DepthCurveLabel {
  side: 'bid' | 'ask'
  /** Pixel position inside the curve's box. */
  x: number
  y: number
  text: string
}

export interface DepthCurve {
  svg: string
  /** The mid's x, for the label above the dashed line. */
  midX: number
  /** The biggest level per side, placed where its step is drawn. */
  walls: DepthCurveLabel[]
  /** The y axis's top, in the unit (dollars or base). */
  top: number
  /** The price axis's three marks: the window's two edges and the mid. */
  ticks: { x: number; text: string }[]
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * The curve: each side cumulated from the mid outward (lib/depth
 * depthWindow), drawn as a step — flat between levels, a riser at every
 * level — filled down to the axis. The y scale is the taller side's total
 * with headroom, so one side reaching the top still shows its edge.
 */
export function depthCurveSvg(w: DepthWindow, o: DepthCurveOptions): DepthCurve {
  const { width: W, height: H } = o
  const val = (l: CumLevel) => (o.unit === 'base' ? l.cum : l.cumUsd)
  const maxV = o.unit === 'base' ? w.maxCum : w.maxCumUsd
  // 22% headroom: the card sets the per-side totals in the top corners, above the curve.
  const top = maxV > 0 ? maxV * 1.22 : 1
  const span = w.hi - w.lo
  const x = (px: number) => r1(span > 0 ? ((px - w.lo) / span) * W : W / 2)
  const y = (v: number) => r1(H - (v / top) * H)
  const midX = x(w.mid)

  const side = (rows: readonly CumLevel[], edge: number): string => {
    if (!rows.length) return ''
    let d = `M${x(rows[0].px)},${H} V${y(val(rows[0]))}`
    for (let i = 1; i < rows.length; i++) d += ` H${x(rows[i].px)} V${y(val(rows[i]))}`
    d += ` H${x(edge)} V${H} Z`
    return d
  }
  const bidD = side(w.bids, w.lo)
  const askD = side(w.asks, w.hi)
  // The outline is the same path without the closing run along the axis.
  const line = (d: string) => d.replace(/ V[\d.]+ Z$/, '')

  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${r1(H * f)}" y2="${r1(H * f)}" stroke="${o.grid}" stroke-width="1"/>`).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    grid +
    (bidD ? `<path d="${bidD}" fill="${o.bidFill}"/><path d="${line(bidD)}" fill="none" stroke="${o.bid}" stroke-width="2.5" stroke-linejoin="miter"/>` : '') +
    (askD ? `<path d="${askD}" fill="${o.askFill}"/><path d="${line(askD)}" fill="none" stroke="${o.ask}" stroke-width="2.5" stroke-linejoin="miter"/>` : '') +
    `<line x1="${midX}" x2="${midX}" y1="0" y2="${H}" stroke="${o.mid}" stroke-width="1.5" stroke-dasharray="5 6"/>` +
    `</svg>`

  const big = wallsIn(w, 1)
  const walls: DepthCurveLabel[] = []
  for (const [s, rows] of [['bid', big.bids], ['ask', big.asks]] as const) {
    const l = rows[0]
    if (!l) continue
    const text = o.unit === 'base' ? `wall ${fmtDepthSize(l.size)}` : `wall ${fmtDepthUsd(l.size * l.px)}`
    walls.push({ side: s, x: x(l.px), y: y(val(l)), text })
  }
  return {
    svg,
    midX,
    walls,
    top,
    ticks: [
      { x: 0, text: fmtDepthPrice(w.lo) },
      { x: midX, text: fmtDepthPrice(w.mid) },
      { x: W, text: fmtDepthPrice(w.hi) },
    ],
  }
}

/** The card's foot: which book, read when. */
export function depthSourceWords(venue: DepthVenue, at: number): string {
  const name = venue === 'coinbase' ? 'Coinbase level 2' : 'Hyperliquid l2Book'
  const d = new Date(at)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `Book · ${name} · read ${d.toISOString().slice(0, 10)} ${hh}:${mm} UTC`
}
