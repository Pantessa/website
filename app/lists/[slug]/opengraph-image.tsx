import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { fmtOgPrice, symbolName } from '@/lib/markets-seo'
import { listCardRows } from '@/lib/share-posts'
import type { Quote } from '@/lib/watchlists'
import { publicWatchlistBySlug } from '@/lib/watchlists-store'

// Social card for a public watchlist (og:image + twitter:image via
// ./twitter-image.tsx). The list is the card: its name in the house serif on
// the left, and on the right the list itself as a board — the first rows with
// a live last + 24h move from our own batched /api/quotes on this host (the
// /markets card's idiom), and how many more follow. Same fence as the page
// (public AND not internal). An unknown slug, or a quotes miss, still draws a
// card: dashes for numbers, never a made-up price and never a 500. The
// owner's address is not on the card.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A Pantessa watchlist — live quotes, follow it in one tap, every row trades.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'
const LINE = 'rgba(255,255,255,0.10)'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const MARK = gemMarkSvg(ACCENT)

async function loadQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {}
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    if (!host) return {}
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const body = (await res.json()) as { quotes?: Record<string, Quote> }
    return body.quotes && typeof body.quotes === 'object' ? body.quotes : {}
  } catch {
    return {}
  }
}

function shortName(symbol: string): string {
  const name = symbolName(symbol)
  if (name.toUpperCase() === symbol) return ''
  return name.length > 16 ? `${name.slice(0, 15)}…` : name
}

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  const list = await publicWatchlistBySlug(slug).catch(() => null)
  const name = list?.name ?? 'Watchlist'
  const symbols = list?.symbols ?? []
  const { rows, more } = listCardRows(symbols)
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, sans, sansSemi, quotes] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
    loadQuotes(rows),
  ])
  const quoted = rows.some((s) => quotes[s])
  // The name is the hero: it steps down in size as it gets longer, and is cut
  // rather than allowed to run under the board.
  const title = name.length > 44 ? `${name.slice(0, 43).trimEnd()}…` : name
  const titleSize = title.length <= 12 ? 84 : title.length <= 22 ? 68 : 54

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        <div style={{ position: 'absolute', right: -140, top: 40, width: 760, height: 560, borderRadius: 380, background: 'radial-gradient(circle, rgba(52,227,160,0.15) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={58} height={58} alt="" />
            <span style={{ color: INK, fontSize: 44, fontWeight: 600, letterSpacing: -1.8 }}>pantessa</span>
            <span style={{ color: MUTED, fontSize: 19, letterSpacing: 5, marginLeft: 8, marginTop: 6 }}>WATCHLIST</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 17, letterSpacing: 4.5, color: MUTED, whiteSpace: 'nowrap' }}>
            <span>PUBLIC LIST</span>
            <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>
            <span>{symbols.length} SYMBOL{symbols.length === 1 ? '' : 'S'}</span>
            {list && list.followers > 0 && <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>}
            {list && list.followers > 0 && <span>{list.followers} FOLLOWING</span>}
          </div>
          <div style={{ display: 'flex', marginTop: 44, fontFamily: 'Newsreader', fontWeight: 500, fontSize: titleSize, lineHeight: 1.04, letterSpacing: -2, color: INK }}>{title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, gap: 12, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <span style={{ color: '#b8bfb5' }}>FOLLOW IT IN ONE TAP</span>
            <span>EVERY ROW IS AN ORDER FORM</span>
          </div>
        </div>

        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span>UNLIMITED WATCHLISTS · FREE</span>
          </div>
          <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span>YOUR WALLET SIGNS</span>
          </div>
        </div>

        <div style={{ position: 'absolute', left: 618, top: 56, width: 518, height: 518, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: `1.5px solid ${LINE}` }}>
            <span style={{ color: INK, fontSize: 14, fontWeight: 600, letterSpacing: 3 }}>THE LIST</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: 2.5, color: quoted ? ACCENT : MUTED }}>
              <div style={{ display: 'flex', width: 7, height: 7, borderRadius: 4, background: quoted ? ACCENT : MUTED }} />
              <span>{quoted ? 'LIVE QUOTES' : rows.length ? 'FEED WARMING UP' : 'NOTHING LISTED YET'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 22px 0' }}>
            {rows.map((s, i) => {
              const q = quotes[s]
              const nm = shortName(s)
              const up = q ? q.chgPct >= 0 : null
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 43, borderTop: i === 0 ? 'none' : `1px solid ${LINE}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
                    <span style={{ color: INK, fontSize: 23, fontWeight: 600, letterSpacing: -0.3 }}>{s}</span>
                    {nm && <span style={{ color: MUTED, fontSize: 15 }}>{nm}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
                    {q ? (
                      <span style={{ color: up ? ACCENT : DOWN, fontSize: 15, fontWeight: 600, width: 92, justifyContent: 'flex-end', display: 'flex' }}>
                        {up ? '▲' : '▼'} {Math.abs(q.chgPct).toFixed(2)}%
                      </span>
                    ) : (
                      <span style={{ color: MUTED, fontSize: 15, width: 92, justifyContent: 'flex-end', display: 'flex' }}>—</span>
                    )}
                    <span style={{ color: q ? INK : MUTED, fontSize: 22, fontWeight: 600, width: 128, justifyContent: 'flex-end', display: 'flex' }}>{q ? `$${fmtOgPrice(q.last)}` : '—'}</span>
                  </div>
                </div>
              )
            })}
            {rows.length === 0 && <div style={{ display: 'flex', height: 43, alignItems: 'center', color: MUTED, fontSize: 18 }}>{list ? 'This list is empty.' : 'This list is not public.'}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px', fontSize: 11, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span style={{ color: MUTED }}>{more > 0 ? `+ ${more} MORE ON THE LIST` : 'LIVE QUOTES · EVERY ROW TRADES'}</span>
            <span style={{ color: ACCENT }}>pantessa.com/lists/{slug.length > 22 ? `${slug.slice(0, 21)}…` : slug}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
