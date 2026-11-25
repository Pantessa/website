import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgEyebrow, OgFrame, OgLockup, ogDataUri, ogDisplay, ogLabel, ogNum, type OgChip } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { CHART_FEED_LABELS, chartUnitOf, isLookOnlyPair, resolveChartPair, type Candle, type ChartFeed } from '@/lib/charts'
import { fmtIndexValue } from '@/lib/macro'
import { READ_INDEX_VENUE_LINE, fmtReadAmount } from '@/lib/read'
import { candleSvg, fmtOgPrice, symbolPageSeo } from '@/lib/markets-seo'
import { TAPE_FOOTNOTE, sessionKindFor, sessionLine } from '@/lib/markets-copy'

// Social card for a symbol page (/t/<symbol>): the last price and 24h move
// as the hero, sixty daily candles drawn under it, the feed named in the
// footer. Same palette, fonts and lockup as every other Pantessa card. The
// series comes from our own /api/charts/candles on the SAME host (cached,
// keyless, the pair resolver is the gate) — a feed miss renders the honest
// "no live chart" card, never a 500 and never a flat fake.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the symbol as the one display line, the price and its move in the
// mono role, the tape in a square hairline frame. Green and red are the
// candles and the day's move; what the link does is said in the brand violet.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A live chart on Pantessa Markets — the chart that executes.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const UP = OG.up
const DOWN = OG.down
const MARK = gemMarkSvg(undefined, { bare: true })

interface Series {
  candles: Candle[]
  last: number | null
  changePct24h: number | null
  feed: ChartFeed | null
}

/** Self-fetch the cached candle proxy on this deployment's own host. */
async function loadSeries(symbol: string): Promise<Series> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (!host) return { candles: [], last: null, changePct24h: null, feed: null }
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1d`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const body = (await res.json()) as Partial<Series> & { error?: string }
    if (body.error || !Array.isArray(body.candles)) return { candles: [], last: null, changePct24h: null, feed: null }
    return { candles: body.candles, last: body.last ?? null, changePct24h: body.changePct24h ?? null, feed: body.feed ?? null }
  } catch {
    return { candles: [], last: null, changePct24h: null, feed: null }
  }
}

type Params = { params: Promise<{ symbol: string }> }

export default async function Image({ params }: Params) {
  const { symbol } = await params
  // A perp only the live table knows needs the universe read first (lib/charts).
  await resolveChartPair(symbol)
  const seo = symbolPageSeo(symbol)
  const pal = brandOgPalette(null)
  const series = seo.pair ? await loadSeries(seo.symbol) : { candles: [], last: null, changePct24h: null, feed: null }
  // Daily candles: the 24h read lands in the same bucket as "now" and says
  // 0.00% — the honest move on a daily tape is last close vs prior close.
  const n = series.candles.length
  const chg = n >= 2 && series.candles[n - 2].c > 0 ? ((series.candles[n - 1].c - series.candles[n - 2].c) / series.candles[n - 2].c) * 100 : null
  // A look-only index (lib/charts): its value in its own unit — a yield in
  // percent, moved in basis points — and no promise of a trade on the card.
  const lookOnly = isLookOnlyPair(seo.pair)
  const unit = chartUnitOf(seo.pair)
  const bp = unit === 'yield' && n >= 2 ? (series.candles[n - 1].c - series.candles[n - 2].c) * 100 : null
  const move = unit === 'yield' ? bp : chg
  const chgColor = move == null ? pal.muted : move >= 0 ? UP : DOWN
  const arrow = move != null && move >= 0 ? '▲' : '▼'
  // The arrow is the sign: the amount beside it is unsigned ("▲ 0.5 bp", "▼ 1.23%").
  const chgLabel = move == null ? '' : unit === 'yield' ? `${arrow} ${fmtReadAmount({ unit }, move)} · 1D` : `${arrow} ${Math.abs(move).toFixed(2)}% · 1D`
  const lastLabel = series.last == null ? '' : lookOnly && seo.pair ? fmtIndexValue(seo.pair, series.last) : unit === 'level' ? fmtOgPrice(series.last) : `$${fmtOgPrice(series.last)}`
  const feedLabel = series.feed ? CHART_FEED_LABELS[series.feed] : seo.pair ? CHART_FEED_LABELS[seo.pair.source] : ''
  const session = seo.pair ? sessionLine(sessionKindFor(seo.pair.source)) : ''
  const chart = candleSvg(series.candles, { width: 1070, height: 236, up: UP, down: DOWN, grid: OG.rule, count: 60 })
  // What the link does, said first and in the accent: the card is a chart in
  // a feed full of charts, and this one takes the order.
  const does: OgChip[] = seo.pair && !lookOnly ? [{ label: 'Trade from this chart', tone: OG.violet, plain: true }] : []
  const chips: OgChip[] = [...does, ...(lookOnly ? ['Full chart', 'Here to read'] : [feedLabel ? `Feed · ${feedLabel}` : 'Guarded build', 'Your wallet signs']).map((label) => ({ label, plain: true }))]

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* header: lockup left, MARKETS + session right */}
        <div style={{ position: 'absolute', top: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} size={44} tag="MARKETS" />
          {session && <OgEyebrow size={15}>{session.toUpperCase()}</OgEyebrow>}
        </div>

        {/* symbol + name / last + change */}
        <div style={{ position: 'absolute', top: 124, left: 64, right: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...ogDisplay(seo.symbol.length > 9 ? 56 : 72), lineHeight: 1 }}>{seo.symbol}</span>
            <span style={{ color: pal.muted, fontSize: 24, marginTop: 12 }}>
              {seo.pair ? (lookOnly ? `${seo.name} · index data` : `${seo.name} · ${seo.pair.label}`) : `${seo.name} · no live chart yet`}
            </span>
          </div>
          {series.last != null && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ ...ogNum(60), letterSpacing: -1.6, lineHeight: 1 }}>{lastLabel}</span>
              {chgLabel && <span style={{ ...ogNum(23, chgColor), marginTop: 12 }}>{chgLabel}</span>}
            </div>
          )}
        </div>

        {/* the tape */}
        <div style={{ position: 'absolute', top: 262, left: 64, width: 1072, height: 238, display: 'flex', border: `1px solid ${OG.line}`, background: OG.panel, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ogDataUri(chart)} width={1070} height={236} alt="" />
          {series.candles.length < 2 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: 1070, height: 236, display: 'flex', alignItems: 'center', justifyContent: 'center', color: pal.muted, fontSize: 24 }}>
              {seo.pair ? (lookOnly ? 'Index data did not answer just now' : 'Live chart · feed warming up') : 'No live chart yet — tradable in chat'}
            </div>
          )}
        </div>

        {/* footer: what the link does + the feed / the footnote */}
        <div style={{ position: 'absolute', bottom: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={chips} size={14} ink={pal.muted} />
          <span style={{ ...ogLabel(12.5, pal.muted), flexShrink: 0 }}>{(lookOnly ? READ_INDEX_VENUE_LINE.split('.')[0] : TAPE_FOOTNOTE).toUpperCase()}</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
