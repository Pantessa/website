import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { headers } from 'next/headers'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { CHART_FEED_LABELS, type Candle, type ChartFeed } from '@/lib/charts'
import { candleSvg, fmtOgPrice, symbolPageSeo } from '@/lib/markets-seo'
import { TAPE_FOOTNOTE, sessionKindFor, sessionLine } from '@/lib/markets-copy'

// Social card for a symbol page (/t/<symbol>): the last price and 24h move
// as the hero, sixty daily candles drawn under it, the feed named in the
// footer. Same palette, fonts and lockup as every other Pantessa card. The
// series comes from our own /api/charts/candles on the SAME host (cached,
// keyless, the pair resolver is the gate) — a feed miss renders the honest
// "no live chart" card, never a 500 and never a flat fake.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A live chart on Pantessa Markets — the chart that executes.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const UP = '#34e3a0'
const DOWN = '#ff5d5d'

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
  const seo = symbolPageSeo(symbol)
  const pal = brandOgPalette(null)
  const series = seo.pair ? await loadSeries(seo.symbol) : { candles: [], last: null, changePct24h: null, feed: null }
  // Daily candles: the 24h read lands in the same bucket as "now" and says
  // 0.00% — the honest move on a daily tape is last close vs prior close.
  const n = series.candles.length
  const chg = n >= 2 && series.candles[n - 2].c > 0 ? ((series.candles[n - 1].c - series.candles[n - 2].c) / series.candles[n - 2].c) * 100 : null
  const chgColor = chg == null ? pal.muted : chg >= 0 ? UP : DOWN
  const chgLabel = chg == null ? '' : `${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% · 1D`
  const feedLabel = series.feed ? CHART_FEED_LABELS[series.feed] : seo.pair ? CHART_FEED_LABELS[seo.pair.source] : ''
  const session = seo.pair ? sessionLine(sessionKindFor(seo.pair.source)) : ''
  const chart = candleSvg(series.candles, { width: 1072, height: 236, up: UP, down: DOWN, grid: 'rgba(255,255,255,0.06)', count: 60 })

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [sans, sansSemi] = await Promise.all([readFile(join(fonts, 'geist-500.ttf')), readFile(join(fonts, 'geist-600.ttf'))])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* header: lockup left, MARKETS + session right */}
        <div style={{ position: 'absolute', top: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={44} height={44} alt="" />
            <span style={{ color: pal.ink, fontSize: 32, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
            <span style={{ color: pal.muted, fontSize: 17, letterSpacing: 4, marginLeft: 10 }}>MARKETS</span>
          </div>
          {session && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, letterSpacing: 2.5, color: pal.muted }}>
              <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: UP }} />
              <span>{session.toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* symbol + name / last + change */}
        <div style={{ position: 'absolute', top: 128, left: 64, right: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: pal.ink, fontSize: 72, fontWeight: 600, letterSpacing: -3, lineHeight: 1 }}>{seo.symbol}</span>
            <span style={{ color: pal.muted, fontSize: 24, marginTop: 10 }}>
              {seo.pair ? `${seo.name} · ${seo.pair.label}` : `${seo.name} · no live chart yet`}
            </span>
          </div>
          {series.last != null && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ color: pal.ink, fontSize: 64, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1 }}>${fmtOgPrice(series.last)}</span>
              {chgLabel && <span style={{ color: chgColor, fontSize: 24, fontWeight: 600, marginTop: 10 }}>{chgLabel}</span>}
            </div>
          )}
        </div>

        {/* the tape */}
        <div style={{ position: 'absolute', top: 262, left: 64, right: 64, display: 'flex', borderRadius: 18, border: '1.5px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={toDataUri(chart)} width={1072} height={236} alt="" />
          {series.candles.length < 2 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: 1072, height: 236, display: 'flex', alignItems: 'center', justifyContent: 'center', color: pal.muted, fontSize: 24 }}>
              {seo.pair ? 'Live chart · feed warming up' : 'No live chart yet — tradable in chat'}
            </div>
          )}
        </div>

        {/* footer: feed + the footnote / the promise */}
        <div style={{ position: 'absolute', bottom: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {[feedLabel ? `Feed · ${feedLabel}` : 'Guarded build', 'Your wallet signs'].map((label) => (
              <div key={label} style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: '1.5px solid rgba(255,255,255,0.12)', color: pal.muted, fontSize: 16, letterSpacing: 1.5 }}>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: pal.muted, fontSize: 15, letterSpacing: 2, whiteSpace: 'nowrap', flexShrink: 0 }}>{TAPE_FOOTNOTE.toUpperCase()}</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
