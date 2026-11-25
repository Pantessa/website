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
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the symbol as the one display line, every figure in the mono role,
// the curve in a square hairline frame. Green is the bids and red the asks
// (the market's own two sides); their fills are flat tints, not see-through.

import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, ogDataUri, ogDisplay, ogLabel, ogMix, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { depthWindow, fmtDepthPrice, fmtDepthSize, fmtDepthUsd, DEPTH_VENUE_LABEL } from '@/lib/depth'
import { depthCurveSvg, depthLean, depthSourceWords, depthWindowWords, parseDepthOgQuery } from '@/lib/depth-share'
import { readServerDepthBook } from '@/lib/depth-book-server'
import { symbolPageSeo } from '@/lib/markets-seo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const W = 1200
const H = 630
const CURVE_W = 1070
const CURVE_H = 268
const UP = OG.up
const DOWN = OG.down
const MARK = gemMarkSvg(undefined, { bare: true })
/** X reads the card once, at post time; a minute keeps a burst of shares to one book read. */
const CACHE = 'public, max-age=60, s-maxage=60'

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
    bidFill: ogMix(UP, OG.panel, 0.84),
    askFill: ogMix(DOWN, OG.panel, 0.84),
    grid: OG.rule,
    mid: OG.soft,
  })
  const lean = depthLean(w)
  const leanColor = lean.side === 'bid' ? UP : lean.side === 'ask' ? DOWN : pal.ink
  const amount = (usd: number, base: number) => (unit === 'base' ? `${fmtDepthSize(base)} ${read.pair.symbol}` : fmtDepthUsd(usd))
  const bidBase = w.bids[w.bids.length - 1]?.cum ?? 0
  const askBase = w.asks[w.asks.length - 1]?.cum ?? 0

  const fonts = await brandOgFonts()

  const res = new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* header: lockup left, what this is right */}
        <div style={{ position: 'absolute', top: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} size={42} tag="MARKETS" />
          <span style={ogLabel(14.5, pal.muted)}>{`ORDER BOOK DEPTH · ${depthWindowWords(w.pct).toUpperCase()}`}</span>
        </div>

        {/* symbol + venue / mid + the lean */}
        <div style={{ position: 'absolute', top: 106, left: 64, right: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...ogDisplay(read.pair.symbol.length > 9 ? 50 : 64, pal.ink), lineHeight: 1 }}>{read.pair.symbol}</span>
            <span style={{ color: pal.muted, fontSize: 22, marginTop: 10 }}>{seo.name === 'Hyperliquid' && read.venue === 'hyperliquid' ? 'Hyperliquid perp book' : `${seo.name} · ${DEPTH_VENUE_LABEL[read.venue]} book`}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ ...ogNum(52, pal.ink), letterSpacing: -1.4, lineHeight: 1 }}>{`$${fmtDepthPrice(w.mid)}`}</span>
            <span style={{ color: leanColor, fontSize: 22, fontWeight: 600, marginTop: 10 }}>{lean.words}</span>
          </div>
        </div>

        {/* the curve, with the per-side totals in its top corners */}
        <div style={{ position: 'absolute', top: 222, left: 64, width: CURVE_W + 2, height: CURVE_H + 34, display: 'flex', border: `1px solid ${OG.line}`, background: OG.panel, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ogDataUri(curve.svg)} width={CURVE_W} height={CURVE_H} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
          <div style={{ position: 'absolute', top: 14, left: 18, display: 'flex', ...ogNum(17, UP) }}>
            <span>{`BIDS ${amount(w.bidUsd, bidBase)}`}</span>
          </div>
          <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', ...ogNum(17, DOWN) }}>
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
                ...ogNum(14, l.side === 'bid' ? UP : DOWN),
              }}
            >
              <span>{l.text}</span>
            </div>
          ))}
          {/* the price axis: the window's edges and the mid */}
          <div style={{ position: 'absolute', top: CURVE_H + 6, left: 0, width: CURVE_W, height: 24, display: 'flex', borderTop: `1px solid ${OG.rule}` }}>
            {curve.ticks.map((t, i) => (
              <span
                key={i}
                style={{ position: 'absolute', top: 5, left: i === 0 ? 14 : i === 2 ? CURVE_W - 134 : t.x - 60, width: 120, display: 'flex', justifyContent: i === 0 ? 'flex-start' : i === 2 ? 'flex-end' : 'center', ...ogNum(13.5, i === 1 ? pal.ink : pal.muted, 500) }}
              >
                {i === 1 ? `mid ${t.text}` : t.text}
              </span>
            ))}
          </div>
        </div>

        {/* foot: what the link does, the book and the minute */}
        <div style={{ position: 'absolute', bottom: 34, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips size={14} ink={pal.muted} chips={[{ label: read.venue === 'coinbase' ? 'Click a level, rest an order' : 'Trade from this chart', tone: OG.violet, plain: true }, { label: 'Your wallet signs', plain: true }]} />
          <span style={ogLabel(12, pal.muted)}>{depthSourceWords(read.venue, read.book.at).toUpperCase()}</span>
        </div>
      </OgFrame>
    ),
    { width: W, height: H, fonts },
  )
  const body = await res.arrayBuffer()
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': CACHE,'x-pantessa-card': 'depth' } })
}
