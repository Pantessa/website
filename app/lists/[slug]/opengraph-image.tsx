import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, OgMove, OgPanel, OgPanelHead, OgWords, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { fmtOgPrice, symbolName } from '@/lib/markets-seo'
import { listCardRows } from '@/lib/share-posts'
import type { Quote } from '@/lib/watchlists'
import { publicWatchlistBySlug } from '@/lib/watchlists-store'

// Social card for a public watchlist (og:image + twitter:image via
// ./twitter-image.tsx). The list is the card: its name as the display line on
// the left, and on the right the list itself as a board — the first rows with
// a live last + 24h move from our own batched /api/quotes on this host (the
// /markets card's idiom), and how many more follow. Same fence as the page
// (public AND not internal). An unknown slug, or a quotes miss, still draws a
// card: dashes for numbers, never a made-up price and never a 500. The
// owner's address is not on the card.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the list's name upright, the rows in a square hairline panel with
// their numbers in the mono role. Green and red are a row's 24h move only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A Pantessa watchlist — live quotes, follow it in one tap, every row trades.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK = gemMarkSvg(undefined, { bare: true })

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
  const [fonts, quotes] = await Promise.all([brandOgFonts(), loadQuotes(rows)])
  const quoted = rows.some((s) => quotes[s])
  // The name is the hero: it steps down in size as it gets longer, and is cut
  // rather than allowed to run under the board.
  const title = name.length > 44 ? `${name.slice(0, 43).trimEnd()}…` : name
  const titleSize = title.length <= 12 ? 76 : title.length <= 22 ? 62 : 50
  const facts = ['PUBLIC LIST', `${symbols.length} SYMBOL${symbols.length === 1 ? '' : 'S'}`, ...(list && list.followers > 0 ? [`${list.followers} FOLLOWING`] : [])]

  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <OgLockup mark={MARK} size={50} tag="WATCHLIST" />
          <div style={{ display: 'flex', marginTop: 28 }}>
            <OgWords words={facts} size={15} />
          </div>
          <div style={{ display: 'flex', marginTop: 46, maxHeight: 220, overflow: 'hidden', ...ogDisplay(titleSize) }}>{title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, gap: 12 }}>
            <span style={ogLabel(15, OG.soft)}>FOLLOW IT IN ONE TAP</span>
            <span style={ogLabel(15)}>EVERY ROW IS AN ORDER FORM</span>
          </div>
        </div>

        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex' }}>
          <OgChips size={12.5} ink={OG.muted} chips={[{ label: 'UNLIMITED WATCHLISTS · FREE', plain: true }, { label: 'YOUR WALLET SIGNS', plain: true }]} />
        </div>

        <OgPanel left={618} top={56} width={518} height={518}>
          <OgPanelHead title="THE LIST" note={quoted ? 'LIVE QUOTES' : rows.length ? 'FEED WARMING UP' : 'NOTHING LISTED YET'} live={quoted} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 22px 0' }}>
            {rows.map((s, i) => {
              const q = quotes[s]
              const nm = shortName(s)
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 43, borderTop: i === 0 ? 'none' : `1px solid ${OG.rule}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
                    <span style={{ color: OG.ink, fontSize: 23, fontWeight: 600, letterSpacing: -0.3 }}>{s}</span>
                    {nm && <span style={{ color: OG.muted, fontSize: 15 }}>{nm}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <OgMove pct={q ? q.chgPct : null} size={15} width={96} />
                    <span style={{ display: 'flex', justifyContent: 'flex-end', width: 132, ...ogNum(20, q ? OG.ink : OG.muted) }}>{q ? `$${fmtOgPrice(q.last)}` : '—'}</span>
                  </div>
                </div>
              )
            })}
            {rows.length === 0 && <div style={{ display: 'flex', height: 43, alignItems: 'center', color: OG.muted, fontSize: 18 }}>{list ? 'This list is empty.' : 'This list is not public.'}</div>}
          </div>
          {/* Stacked: a long slug and the foot's words do not fit one line of the panel. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 'auto', padding: '0 22px 14px' }}>
            <span style={ogLabel(11)}>{more > 0 ? `+ ${more} MORE ON THE LIST` : 'LIVE QUOTES · EVERY ROW TRADES'}</span>
            <span style={ogNum(13, OG.violet)}>{`pantessa.com/lists/${slug.length > 22 ? `${slug.slice(0, 21)}…` : slug}`}</span>
          </div>
        </OgPanel>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
