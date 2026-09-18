import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { fmtCountdown, sessionStripFor } from '@/lib/markets'
import { HERO_LINE } from '@/lib/markets-copy'
import { fmtOgPrice, marketsOgBoard, marketsOgSymbols, symbolName } from '@/lib/markets-seo'
import type { Quote } from '@/lib/watchlists'

// Social card for /markets (og:image + twitter:image via ./twitter-image.tsx).
// Before this file the index shared a text-only preview: the page's metadata
// set a title and a description and no picture, so a pasted /markets link
// rendered as a bare headline. The card is the page in miniature: the claim
// in the hero's serif on the left, and on the right THE BOARD — the three
// market families the index lists (digital equities on Robinhood Chain,
// crypto spot, Hyperliquid perps), each with its household names, live last
// + 24h move from our own batched /api/quotes on this host, and the family's
// honest size. The NYSE session and its next bell come from the same clock
// the page's session strip reads. A quotes miss draws the board with dashes
// and says the feed is warming up; it never fakes a number and never 500s.
// Fonts from assets/og-fonts (the families every other Pantessa card uses).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `Pantessa Markets — ${HERO_LINE} Stocks 24/7, crypto spot and perps on one board.`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'
const LINE = 'rgba(255,255,255,0.10)'

// The root card's eyebrow, word for word: the landing's own carries
// "one wallet" too, which is the one word the 520px column can't hold
// beside the board.
const EYEBROW = ['STOCKS 24/7', 'PERPS', 'SPOT', 'YIELD']

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(ACCENT)

interface Quotes {
  quotes: Record<string, Quote>
  asOf: number | null
}

const NO_QUOTES: Quotes = { quotes: {}, asOf: null }

/** Self-fetch the batched quotes reader on this deployment's own host — the
 *  /t card's idiom; the reader caches per symbol, so the card costs the same
 *  as one rail refresh. */
async function loadQuotes(symbols: string[]): Promise<Quotes> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (!host) return NO_QUOTES
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const body = (await res.json()) as Partial<Quotes>
    if (!body.quotes || typeof body.quotes !== 'object') return NO_QUOTES
    return { quotes: body.quotes, asOf: typeof body.asOf === 'number' ? body.asOf : null }
  } catch {
    return NO_QUOTES
  }
}

/** A company name that fits the row; the symbol carries the identity. */
function shortName(symbol: string): string {
  const name = symbolName(symbol)
  if (name.toUpperCase() === symbol) return ''
  return name.length > 16 ? `${name.slice(0, 15)}…` : name
}

function fmtUtc(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}

export default async function Image() {
  const board = marketsOgBoard()
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi, live] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
    loadQuotes(marketsOgSymbols()),
  ])
  const quoted = Object.keys(live.quotes).length
  const strip = sessionStripFor()
  const bell = `${strip.nyse.label} · ${strip.nyse.bell} in ${fmtCountdown(strip.nyse.minsToBell)}`

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        {/* ambient glow behind the board */}
        <div style={{ position: 'absolute', right: -140, top: 40, width: 760, height: 560, borderRadius: 380, background: 'radial-gradient(circle, rgba(52,227,160,0.15) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={58} height={58} alt="" />
            <span style={{ color: INK, fontSize: 44, fontWeight: 600, letterSpacing: -1.8 }}>pantessa</span>
            <span style={{ color: MUTED, fontSize: 19, letterSpacing: 5, marginLeft: 8, marginTop: 6 }}>MARKETS</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 17, letterSpacing: 4.5, color: MUTED, whiteSpace: 'nowrap' }}>
            {EYEBROW.map((w, i) => (
              <span key={w} style={{ display: 'flex' }}>
                {i > 0 && <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>}
                <span>{w}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, fontFamily: 'Newsreader', fontWeight: 500, fontSize: 92, lineHeight: 0.98, letterSpacing: -3 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, gap: 12, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <span>UNLIMITED WATCHLISTS · ALERTS · FREE</span>
            <span style={{ color: '#b8bfb5' }}>YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* left-bottom: the session strip the page shows */}
        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: strip.nyse.open ? ACCENT : '#ffd25e' }} />
            <span>{bell.toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span>{strip.tokens.toUpperCase()}</span>
          </div>
        </div>

        {/* right: THE BOARD — the three families the index lists */}
        <div style={{ position: 'absolute', left: 618, top: 56, width: 518, height: 518, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: `1.5px solid ${LINE}` }}>
            <span style={{ color: INK, fontSize: 14, fontWeight: 600, letterSpacing: 3 }}>THE BOARD</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: 2.5, color: quoted ? ACCENT : MUTED }}>
              <div style={{ display: 'flex', width: 7, height: 7, borderRadius: 4, background: quoted ? ACCENT : MUTED }} />
              <span>{quoted && live.asOf != null ? `LIVE · ${fmtUtc(live.asOf)}` : 'LIVE · FEED WARMING UP'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 22px 0' }}>
            {board.map((g, gi) => (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', marginTop: gi === 0 ? 0 : 9 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 4, borderBottom: `1px solid ${LINE}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                    <span style={{ color: INK, fontSize: 12, fontWeight: 600, letterSpacing: 2.5 }}>{g.label.toUpperCase()}</span>
                    <span style={{ color: MUTED, fontSize: 11, letterSpacing: 1.5 }}>{g.venue.toUpperCase()}</span>
                  </div>
                  <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, whiteSpace: 'nowrap' }}>{g.total} LISTED</span>
                </div>
                {g.symbols.map((s) => {
                  const q = live.quotes[s]
                  const name = shortName(s)
                  const up = q ? q.chgPct >= 0 : null
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 31 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, whiteSpace: 'nowrap' }}>
                        <span style={{ color: INK, fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>{s}</span>
                        {name && <span style={{ color: MUTED, fontSize: 13 }}>{name}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
                        {q ? (
                          <span style={{ color: up ? ACCENT : DOWN, fontSize: 13, fontWeight: 600, width: 84, justifyContent: 'flex-end', display: 'flex' }}>
                            {up ? '▲' : '▼'} {Math.abs(q.chgPct).toFixed(2)}%
                          </span>
                        ) : (
                          <span style={{ color: MUTED, fontSize: 13, width: 84, justifyContent: 'flex-end', display: 'flex' }}>—</span>
                        )}
                        <span style={{ color: q ? INK : MUTED, fontSize: 18, fontWeight: 600, width: 104, justifyContent: 'flex-end', display: 'flex' }}>{q ? `$${fmtOgPrice(q.last)}` : '—'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px', fontSize: 11, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span style={{ color: MUTED }}>EVERY ROW IS AN ORDER FORM</span>
            <span style={{ color: ACCENT }}>pantessa.com/markets</span>
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
