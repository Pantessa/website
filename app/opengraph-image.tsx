import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { candleSvg, fmtOgPrice } from '@/lib/markets-seo'
import type { Candle } from '@/lib/charts'
import { HERO_LINE, HERO_REEL, LANDING_SYMBOL, REEL_STAMP } from '@/lib/markets-copy'

// Social card for the site (og:image + twitter:image via app/twitter-image.tsx).
// mk2 LANDING (2026-09-15): the card IS the hero — the claim in the serif with
// the gradient-italic payoff, and beside it the executing chart: a live ETH
// tape (self-fetched from /api/charts/candles on this host, the /t card's
// idiom; a feed miss draws the grid, never a fake series) with the rehearsal
// HUD on it (the first reel beat: the ask, the venue leg, the guard tick,
// the receipt line) and its honesty stamp. Deliberately no body copy — share
// previews render too small to read it. Fonts from assets/og-fonts.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `Pantessa — ${HERO_LINE}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(ACCENT)

interface Series { candles: Candle[]; last: number | null }

/** Self-fetch the cached candle proxy on this deployment's own host. */
async function loadSeries(symbol: string): Promise<Series> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (!host) return { candles: [], last: null }
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/api/charts/candles?symbol=${encodeURIComponent(symbol)}&tf=1h`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const body = (await res.json()) as Partial<Series> & { error?: string }
    if (body.error || !Array.isArray(body.candles)) return { candles: [], last: null }
    return { candles: body.candles, last: body.last ?? null }
  } catch {
    return { candles: [], last: null }
  }
}

export default async function Image() {
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi, series] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
    loadSeries(LANDING_SYMBOL),
  ])
  const beat = HERO_REEL[0]
  const n = series.candles.length
  const chg = n >= 2 && series.candles[n - 25]?.c > 0 ? ((series.candles[n - 1].c - series.candles[n - 25].c) / series.candles[n - 25].c) * 100 : null
  const chart = candleSvg(series.candles, { width: 600, height: 300, up: ACCENT, down: DOWN, grid: 'rgba(255,255,255,0.07)', count: 72 })

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        {/* ambient glow behind the stage */}
        <div style={{ position: 'absolute', right: -120, top: 60, width: 720, height: 520, borderRadius: 360, background: 'radial-gradient(circle, rgba(52,227,160,0.16) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={58} height={58} alt="" />
            <span style={{ color: INK, fontSize: 44, fontWeight: 600, letterSpacing: -1.8 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', marginTop: 22, fontSize: 17, letterSpacing: 4.5, color: MUTED }}>
            <span>STOCKS 24/7</span>
            <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>
            <span>PERPS</span>
            <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>
            <span>SPOT</span>
            <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>
            <span>YIELD</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 46, fontFamily: 'Newsreader', fontWeight: 500, fontSize: 92, lineHeight: 0.98, letterSpacing: -3 }}>
            <span style={{ color: INK }}>The chart</span>
            <span
              style={{
                fontStyle: 'italic',
                letterSpacing: -1.6,
                backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
                backgroundClip: 'text',
                color: 'transparent',
                paddingBottom: 12,
                paddingRight: 10,
              }}
            >
              that executes.
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 34, fontSize: 19, letterSpacing: 5, color: MUTED }}>
            <span>YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* right: the stage — a live tape with the rehearsal HUD on it */}
        <div style={{ position: 'absolute', left: 620, top: 64, width: 520, height: 502, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1.5px solid rgba(255,255,255,0.10)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ color: INK, fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>{LANDING_SYMBOL} / USD</span>
              <span style={{ color: MUTED, fontSize: 13, letterSpacing: 2.5 }}>COINBASE SPOT</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              {series.last != null && <span style={{ color: INK, fontSize: 24, fontWeight: 600 }}>${fmtOgPrice(series.last)}</span>}
              {chg != null && <span style={{ color: chg >= 0 ? ACCENT : DOWN, fontSize: 15, fontWeight: 600 }}>{chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%</span>}
              <span style={{ color: ACCENT, fontSize: 12, letterSpacing: 2.5 }}>LIVE</span>
            </div>
          </div>
          <div style={{ display: 'flex', position: 'relative', width: 520, height: 300, marginTop: 8, marginLeft: -40 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(chart)} width={600} height={300} alt="" />
          </div>
          {/* the HUD: the first beat, complete */}
          <div style={{ position: 'absolute', left: 18, top: 92, width: 300, display: 'flex', flexDirection: 'column', padding: '14px 16px', borderRadius: 14, border: `1.5px solid rgba(52,227,160,0.45)`, background: 'rgba(5,7,8,0.86)' }}>
            <span style={{ fontFamily: 'Newsreader', color: INK, fontSize: 24, letterSpacing: -0.4 }}>{beat.ask}</span>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10, fontSize: 14, color: '#b8bfb5' }}>
              <span style={{ color: INK, fontWeight: 600 }}>{beat.legs[0].venue} <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, marginLeft: 8 }}>{beat.legs[0].chain.toUpperCase()}</span></span>
              <span style={{ marginTop: 2 }}>{beat.legs[0].what}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(255,255,255,0.14)', fontSize: 12, color: MUTED }}>
              {beat.guard.map((g) => (
                <span key={g} style={{ display: 'flex' }}>
                  <span style={{ color: ACCENT, marginRight: 6 }}>✓</span>
                  <span>{g}</span>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, letterSpacing: 2, color: ACCENT }}>
              <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
              <span>{beat.ending.line.toUpperCase()}</span>
            </div>
            <span style={{ marginTop: 8, fontSize: 10, letterSpacing: 1.5, color: MUTED }}>{REEL_STAMP}</span>
          </div>
          <div style={{ position: 'absolute', left: 22, bottom: 14, display: 'flex', fontSize: 11, letterSpacing: 2, color: MUTED }}>
            <span>{n >= 2 ? 'LIVE TAPE · COINBASE' : 'LIVE CHART · FEED WARMING UP'}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
