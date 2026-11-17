// GET /api/og/depth?symbol=UNI&win=10&unit=base — the share card of a Depth
// link (2026-11-17). /t/<sym>?view=depth names this image in its og: and
// twitter: tags (app/t/[symbol]/page.tsx), so the card X draws is the book as
// it stood when X read the link: both sides stepped from the mid outward, the
// biggest wall per side, the dollars resting inside the window, the venue and
// the minute. The curve is lib/depth-share depthCurveSvg; the book is the one
// the chart draws (lib/depth-book-server).
//
// Never a 500 and never a fake book: a symbol with no book (a tokenized
// stock, an index) or a venue that did not answer goes to the symbol's own
// card. Under /api/og/, which robots.txt allows.

import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { depthWindow, fmtDepthPrice, fmtDepthSize, fmtDepthUsd, DEPTH_VENUE_LABEL } from '@/lib/depth'
import { depthCurveSvg, depthLean, depthSourceWords, depthWindowWords, parseDepthOgQuery } from '@/lib/depth-share'
import { readServerDepthBook } from '@/lib/depth-book-server'
import { symbolPageSeo } from '@/lib/markets-seo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const W = 1200
const H = 630
const CURVE_W = 1072
const CURVE_H = 268
const UP = '#34e3a0'
const DOWN = '#ff5d5d'
/** X reads the card once, at post time; a minute keeps a burst of shares to one book read. */
const CACHE = 'public, max-age=60, s-maxage=60'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = parseDepthOgQuery(url.search)
  if (!q) return new Response('bad symbol', { status: 400, headers: { 'cache-control': 'no-store' } })
  const read = await readServerDepthBook(q.symbol)
  const w = read ? depthWindow(read.book, q.settings.pct) : null
  if (!read || !w || (!w.bids.length && !w.asks.length)) {
    // No book to draw: the symbol's own card, never an empty frame.
    return new Response(null, { status: 307, headers: { location: `/t/${encodeURIComponent(q.symbol.toUpperCase())}/opengraph-image`, 'cache-control': CACHE } })
  }

  const pal = brandOgPalette(null)
  const seo = symbolPageSeo(read.pair.symbol)
  const unit = q.settings.unit
  const curve = depthCurveSvg(w, {
    width: CURVE_W,
    height: CURVE_H,
    unit,
    bid: UP,
    ask: DOWN,
    bidFill: 'rgba(52,227,160,0.16)',
    askFill: 'rgba(255,93,93,0.16)',
    grid: 'rgba(255,255,255,0.06)',
    mid: 'rgba(250,250,247,0.55)',
  })
  const lean = depthLean(w)
  const leanColor = lean.side === 'bid' ? UP : lean.side === 'ask' ? DOWN : pal.ink
  const amount = (usd: number, base: number) => (unit === 'base' ? `${fmtDepthSize(base)} ${read.pair.symbol}` : fmtDepthUsd(usd))
  const bidBase = w.bids[w.bids.length - 1]?.cum ?? 0
  const askBase = w.asks[w.asks.length - 1]?.cum ?? 0

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [sans, sansSemi] = await Promise.all([readFile(join(fonts, 'geist-500.ttf')), readFile(join(fonts, 'geist-600.ttf'))])

  const chip = (label: string, color: string, border: string) => (
    <div key={label} style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${border}`, color, fontSize: 16, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>
      <span>{label}</span>
    </div>
  )

  const res = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* header: lockup left, what this is right */}
        <div style={{ position: 'absolute', top: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={40} height={40} alt="" />
            <span style={{ color: pal.ink, fontSize: 30, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
            <span style={{ color: pal.muted, fontSize: 16, letterSpacing: 4, marginLeft: 10 }}>MARKETS</span>
          </div>
          <span style={{ color: pal.muted, fontSize: 16, letterSpacing: 3 }}>{`ORDER BOOK DEPTH · ${depthWindowWords(w.pct).toUpperCase()}`}</span>
        </div>

        {/* symbol + venue / mid + the lean */}
        <div style={{ position: 'absolute', top: 108, left: 64, right: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: pal.ink, fontSize: 64, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1 }}>{read.pair.symbol}</span>
            <span style={{ color: pal.muted, fontSize: 22, marginTop: 10 }}>{seo.name === 'Hyperliquid' && read.venue === 'hyperliquid' ? 'Hyperliquid perp book' : `${seo.name} · ${DEPTH_VENUE_LABEL[read.venue]} book`}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: pal.ink, fontSize: 54, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>{`$${fmtDepthPrice(w.mid)}`}</span>
            <span style={{ color: leanColor, fontSize: 22, fontWeight: 600, marginTop: 10 }}>{lean.words}</span>
          </div>
        </div>

        {/* the curve, with the per-side totals in its top corners */}
        <div style={{ position: 'absolute', top: 222, left: 64, width: CURVE_W, height: CURVE_H + 34, display: 'flex', borderRadius: 18, border: '1.5px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={toDataUri(curve.svg)} width={CURVE_W} height={CURVE_H} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
          <div style={{ position: 'absolute', top: 14, left: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, color: UP, fontWeight: 600 }}>
            <span>{`BIDS ${amount(w.bidUsd, bidBase)}`}</span>
          </div>
          <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, color: DOWN, fontWeight: 600 }}>
            <span>{`ASKS ${amount(w.askUsd, askBase)}`}</span>
          </div>
          {/* A wall's label sits on the mid side of its step, where the curve is lower and the space is clear. */}
          {curve.walls.map((l) => (
            <div
              key={l.side}
              style={{
                position: 'absolute',
                top: Math.max(44, Math.min(CURVE_H - 26, l.y - 26)),
                left: l.side === 'bid' ? Math.min(CURVE_W - 158, l.x + 8) : Math.max(8, l.x - 158),
                width: 150,
                display: 'flex',
                justifyContent: l.side === 'bid' ? 'flex-start' : 'flex-end',
                fontSize: 15,
                fontWeight: 600,
                color: l.side === 'bid' ? UP : DOWN,
              }}
            >
              <span>{l.text}</span>
            </div>
          ))}
          {/* the price axis: the window's edges and the mid */}
          <div style={{ position: 'absolute', top: CURVE_H + 6, left: 0, width: CURVE_W, height: 24, display: 'flex', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {curve.ticks.map((t, i) => (
              <span
                key={i}
                style={{ position: 'absolute', top: 4, left: i === 0 ? 14 : i === 2 ? CURVE_W - 134 : t.x - 60, width: 120, display: 'flex', justifyContent: i === 0 ? 'flex-start' : i === 2 ? 'flex-end' : 'center', fontSize: 15, color: i === 1 ? pal.ink : pal.muted }}
              >
                {i === 1 ? `mid ${t.text}` : t.text}
              </span>
            ))}
          </div>
        </div>

        {/* foot: what the link does, the book and the minute */}
        <div style={{ position: 'absolute', bottom: 34, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {chip(read.venue === 'coinbase' ? 'Click a level, rest an order' : 'Trade from this chart', UP, UP)}
            {chip('Your wallet signs', pal.muted, 'rgba(255,255,255,0.12)')}
          </div>
          <span style={{ color: pal.muted, fontSize: 14, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>{depthSourceWords(read.venue, read.book.at).toUpperCase()}</span>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
  const body = await res.arrayBuffer()
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': CACHE,'x-pantessa-card': 'depth' } })
}
