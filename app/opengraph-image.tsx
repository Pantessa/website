import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, OgMove, OgPanel, OgPanelHead, OgWords, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { fmtCountdown, sessionStripFor } from '@/lib/markets'
import { HERO_LINE } from '@/lib/markets-copy'
import { fmtOgPrice, marketsOgBoard, marketsOgSymbols, symbolName } from '@/lib/markets-seo'
import type { Quote } from '@/lib/watchlists'

// Social card for the site (og:image + twitter:image via app/twitter-image.tsx).
// THE FRONT DOOR (squad front-door, 2026-10-06): `/` is the markets splash —
// the index in the app shell with the live pulse on top — so the site card is
// the page in miniature: the claim as the display line on the left, and on
// the right THE BOARD, the card /markets wore since #817 (2026-09-17), now
// re-homed here with the page (the /markets URL redirects to `/`, and so do
// its card URLs). The brochure's rehearsal card — a live tape with the HUD —
// moved with the brochure to app/story/opengraph-image.tsx.
//
// The board: the three market families the index lists (digital equities on
// Robinhood Chain, crypto spot, Hyperliquid perps), each with its household
// names, live last + 24h move from our own batched /api/quotes on this host,
// and the family's honest size. The NYSE session and its next bell come from
// the same clock the page's session strip reads. A quotes miss draws the
// board with dashes and says the feed is warming up; it never fakes a number
// and never 500s.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): the ground
// is #07080D and flat, the Cut P wears its own magenta and violet, the claim
// is the one display line, upright, and the board is a square hairline panel.
// Green and red are a row's move and nothing else.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `Pantessa — ${HERO_LINE} Stocks 24/7, crypto spot and perps on one board; every row is an order form your wallet signs.`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The eyebrow, word for word the splash's family line: "one wallet" is the
// one word the 520px column can't hold beside the board.
const EYEBROW = ['STOCKS 24/7', 'PERPS', 'SPOT', 'YIELD']

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })

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
  const [fonts, live] = await Promise.all([brandOgFonts(), loadQuotes(marketsOgSymbols())])
  const quoted = Object.keys(live.quotes).length
  const strip = sessionStripFor()
  const bell = `${strip.nyse.label} · ${strip.nyse.bell} in ${fmtCountdown(strip.nyse.minsToBell)}`

  return new ImageResponse(
    (
      <OgFrame>
        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <OgLockup mark={MARK} size={50} />
          <div style={{ display: 'flex', marginTop: 28 }}>
            <OgWords words={EYEBROW} size={15} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 46, whiteSpace: 'nowrap', ...ogDisplay(74) }}>
            <span>The chart</span>
            <span>that executes.</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, gap: 12 }}>
            <span style={ogLabel(15)}>UNLIMITED WATCHLISTS · ALERTS · FREE</span>
            <span style={ogLabel(15, OG.soft)}>YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* left-bottom: the session strip the page shows */}
        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex' }}>
          <OgChips size={12.5} ink={OG.muted} accent={strip.nyse.open ? OG.violet : OG.muted} chips={[bell, { label: strip.tokens, plain: true }]} />
        </div>

        {/* right: THE BOARD — the three families the index lists */}
        <OgPanel left={618} top={56} width={518} height={518}>
          <OgPanelHead title="THE BOARD" note={quoted && live.asOf != null ? `LIVE · ${fmtUtc(live.asOf)}` : 'LIVE · FEED WARMING UP'} live={!!quoted} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 22px 0' }}>
            {board.map((g, gi) => (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', marginTop: gi === 0 ? 0 : 9 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 5, borderBottom: `1px solid ${OG.rule}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                    <span style={{ ...ogLabel(11.5, OG.ink), fontWeight: 600 }}>{g.label.toUpperCase()}</span>
                    <span style={ogLabel(10.5)}>{g.venue.toUpperCase()}</span>
                  </div>
                  <span style={ogLabel(10.5)}>{g.total} LISTED</span>
                </div>
                {g.symbols.map((s) => {
                  const q = live.quotes[s]
                  const name = shortName(s)
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 31 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, whiteSpace: 'nowrap' }}>
                        <span style={{ color: OG.ink, fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>{s}</span>
                        {name && <span style={{ color: OG.muted, fontSize: 13 }}>{name}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                        <OgMove pct={q ? q.chgPct : null} size={13} width={88} />
                        <span style={{ display: 'flex', justifyContent: 'flex-end', width: 108, ...ogNum(17, q ? OG.ink : OG.muted) }}>{q ? `$${fmtOgPrice(q.last)}` : '—'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px' }}>
            <span style={ogLabel(11)}>EVERY ROW IS AN ORDER FORM</span>
            <span style={ogNum(13, OG.violet)}>pantessa.com</span>
          </div>
        </OgPanel>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
