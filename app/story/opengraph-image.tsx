import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgFrame, OgLockup, OgMove, OgPanel, OgSquare, OgWords, ogDataUri, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { candleSvg, fmtOgPrice } from '@/lib/markets-seo'
import { CHART_FEED_LABELS, chartPairFor, type Candle, type ChartFeed } from '@/lib/charts'
import { venueLabel } from '@/lib/markets'
import { HERO_LINE, HERO_REEL, REEL_STAMP } from '@/lib/markets-copy'

// Social card for /story — the brochure (og:image + twitter:image via
// ./twitter-image.tsx). This WAS the site's root card until the front door
// flipped (squad front-door, 2026-10-06): `/` is the markets splash now and
// wears the board card (app/opengraph-image.tsx); the brochure that used to
// be `/` moved here with its own card — the rehearsing chart is its hero, so
// the rehearsal is its picture.
//
// mk2 LANDING (2026-09-15): the card IS the hero — the claim as the display
// line, and beside it the executing chart: a live tape of the first reel
// beat's symbol (AAPL on Robinhood Chain since 2026-09-16; self-fetched from
// /api/charts/candles on this host, the /t card's idiom; a feed miss draws
// the grid, never a fake series) with the rehearsal HUD on it (the first reel
// beat: the ask, the venue leg, the receipt line) and its honesty stamp. The
// venue, the feed and the 24h move come from the pair and the route, never
// typed: a stock tape prints 16 hourly bars a trading day, so "24 bars back"
// is not a day. Deliberately no body copy — share previews render too small
// to read it.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the claim upright, the stage a square hairline panel and the
// receipt strip a solid box on it. Green and red are the candles and the 24h
// move; everything else is ink, quiet grey or the brand violet.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `The Pantessa story — ${HERO_LINE} A live chart rehearses the product: the ask, the route, the receipt.`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })

interface Series { candles: Candle[]; last: number | null; feed: ChartFeed | null; changePct24h: number | null }

const EMPTY: Series = { candles: [], last: null, feed: null, changePct24h: null }

/** Self-fetch the cached candle proxy on this deployment's own host. */
async function loadSeries(symbol: string): Promise<Series> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (!host) return EMPTY
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1h`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const body = (await res.json()) as Partial<Series> & { error?: string }
    if (body.error || !Array.isArray(body.candles)) return EMPTY
    return {
      candles: body.candles,
      last: body.last ?? null,
      feed: body.feed && Object.prototype.hasOwnProperty.call(CHART_FEED_LABELS, body.feed) ? body.feed : null,
      changePct24h: typeof body.changePct24h === 'number' ? body.changePct24h : null,
    }
  } catch {
    return EMPTY
  }
}

export default async function Image() {
  const beat = HERO_REEL[0]
  const pair = chartPairFor(beat.symbol)
  const [fonts, series] = await Promise.all([brandOgFonts(), loadSeries(beat.symbol)])
  const n = series.candles.length
  const chg = n >= 2 ? series.changePct24h : null
  // The tape that actually drew (Yahoo Finance when Robinhood's is down).
  const feed = series.feed ?? pair?.source ?? null
  const chart = candleSvg(series.candles, { width: 518, height: 300, up: OG.up, down: OG.down, grid: OG.rule, count: 72 })

  return new ImageResponse(
    (
      <OgFrame>
        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <OgLockup mark={MARK} size={50} />
          <div style={{ display: 'flex', marginTop: 28 }}>
            <OgWords words={['STOCKS 24/7', 'PERPS', 'SPOT', 'YIELD']} size={15} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 46, whiteSpace: 'nowrap', ...ogDisplay(74) }}>
            <span>The chart</span>
            <span>that executes.</span>
          </div>
          {/* pre-gtm POLISH r3: the promise in one line + where it lives,
              not a lone slogan fragment. */}
          <span style={{ ...ogLabel(16), marginTop: 34 }}>NO CUSTODY · YOUR WALLET SIGNS</span>
          <span style={{ ...ogNum(18, OG.violet), marginTop: 16 }}>pantessa.com</span>
        </div>

        {/* right: the stage — a live tape with the rehearsal HUD on it */}
        <OgPanel left={620} top={64} width={520} height={502}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderBottom: `1px solid ${OG.line}` }}>
            {/* The venue sits UNDER the symbol: "ROBINHOOD CHAIN · 24/7" beside
                it pushed the price and the 24h move off the card. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: OG.ink, fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>{pair?.label ?? `${beat.symbol} / USD`}</span>
              <span style={ogLabel(11.5)}>{venueLabel(pair).toUpperCase()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              {series.last != null && <span style={ogNum(22)}>${fmtOgPrice(series.last)}</span>}
              {chg != null && <OgMove pct={chg} size={15} />}
              <span style={ogLabel(11.5, OG.soft)}>LIVE</span>
            </div>
          </div>
          {/* The tape is drawn at the panel's own width, so its newest bars are never cut by the frame. */}
          <div style={{ display: 'flex', position: 'relative', width: 518, height: 300, marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ogDataUri(chart)} width={518} height={300} alt="" />
          </div>
          {/* the receipt strip: the first beat, complete — bottom-left over the volume pane */}
          <div style={{ position: 'absolute', left: 16, bottom: 44, maxWidth: 440, display: 'flex', flexDirection: 'column', padding: '12px 14px 10px', border: `1px solid ${OG.line}`, background: OG.bg }}>
            <span style={{ display: 'flex', color: OG.ink, fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>
              <span style={{ color: OG.violet, marginRight: 8 }}>›</span>
              <span>{beat.ask}</span>
            </span>
            {beat.legs.map((l) => (
              <span key={l.venue} style={{ display: 'flex', marginTop: 6, fontSize: 14, color: OG.soft }}>{l.line}</span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', marginTop: 9, ...ogLabel(11.5, OG.ink) }}>
              <OgSquare size={7} />
              <span style={{ marginLeft: 8 }}>{beat.ending.line.toUpperCase()}</span>
            </span>
            <span style={{ marginTop: 7, fontSize: 10, letterSpacing: 1.2, color: OG.muted }}>{REEL_STAMP}</span>
          </div>
          <div style={{ position: 'absolute', left: 22, bottom: 14, display: 'flex' }}>
            <span style={ogLabel(10.5)}>{n >= 2 && feed ? `LIVE TAPE · ${CHART_FEED_LABELS[feed].toUpperCase()}` : 'LIVE CHART · FEED WARMING UP'}</span>
          </div>
        </OgPanel>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
