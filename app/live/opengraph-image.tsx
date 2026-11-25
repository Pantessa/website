import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, OgMove, OgPanel, OgPanelHead, OgSquare, OgWords, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { FALLBACK_MARKETS, fmtPrice, fmtUsd, pickTapeMarkets, tapeMarket } from '@/lib/tape'

// Social card for /live — the live tape (og:image + twitter:image via
// ./twitter-image.tsx). The page named its own openGraph/twitter block with
// no picture, so a shared /live link unfurled blank (QA, squad front-door
// 2026-10-06) — and the splash's pulse now sends people there. Same idiom
// as /story's card: the claim as the display line on the left, and on the
// right a panel the page actually shows.
//
// The panel is the venue's 24-hour LEADERS, not fills: the tape itself is a
// WebSocket the BROWSER opens (lib/tape-feed), and a card rendered on a
// server holds no socket, so it never pretends to. One POST to Hyperliquid's
// public info endpoint (metaAndAssetCtxs — the same read the page uses to
// pick its subscription), the rows chosen by lib/tape pickTapeMarkets, each
// with its mark, its 24h move and its 24h notional. A miss draws the fallback
// names with dashes and says the feed is warming up; it never fakes a number
// and never 500s.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the claim upright, the leaders in a square hairline panel with
// their numbers in the mono role. Green and red are a row's 24h move only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `Pantessa Live — every print is a button. Hyperliquid fills as they land; the sentence that does the same at the end of every row, signed by your wallet.`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** The page's own eyebrow family: the five tiles above the tape. */
const EYEBROW = ['NOTIONAL / SEC', 'HOT MARKET', 'LARGEST PRINT', 'TAKER SPLIT']

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
/** Rows that fit the panel beside the claim. */
const ROWS = 8

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })

interface LeaderRow {
  name: string
  volumeUsd: number
  delisted: boolean
  mark: number | null
  chgPct: number | null
}

interface Leaders {
  rows: LeaderRow[]
  asOf: number | null
}

const NO_LEADERS: Leaders = { rows: [], asOf: null }

/** The venue's main book: every listing with its mark, 24h move and 24h
 *  notional, then the page's own pick rule (busiest first, nothing delisted). */
async function loadLeaders(): Promise<Leaders> {
  try {
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(9_000),
    })
    const [meta, ctxs] = (await res.json()) as [{ universe?: { name: string; isDelisted?: boolean }[] }, { dayNtlVlm?: string; markPx?: string; prevDayPx?: string }[]]
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return NO_LEADERS
    const all: LeaderRow[] = meta.universe.map((u, i) => {
      const c = ctxs[i] ?? {}
      const mark = Number(c.markPx)
      const prev = Number(c.prevDayPx)
      return {
        name: u.name,
        delisted: Boolean(u.isDelisted),
        volumeUsd: Number(c.dayNtlVlm ?? 0),
        mark: Number.isFinite(mark) && mark > 0 ? mark : null,
        chgPct: Number.isFinite(mark) && Number.isFinite(prev) && prev > 0 ? ((mark - prev) / prev) * 100 : null,
      }
    })
    const names = pickTapeMarkets(all, [], { main: ROWS, xyz: 0 })
    const rows = names.map((n) => all.find((r) => r.name === n)).filter((r): r is LeaderRow => !!r)
    return rows.length ? { rows, asOf: Date.now() } : NO_LEADERS
  } catch {
    return NO_LEADERS
  }
}

function fmtUtc(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} UTC`
}

export default async function Image() {
  const [fonts, live] = await Promise.all([brandOgFonts(), loadLeaders()])
  const warm = live.rows.length > 0
  // A miss draws the fallback names (the page's own list) with dashes.
  const rows: LeaderRow[] = warm
    ? live.rows
    : FALLBACK_MARKETS.filter((m) => !m.includes(':')).slice(0, ROWS).map((name) => ({ name, volumeUsd: 0, delisted: false, mark: null, chgPct: null }))
  const col = (width: number) => ({ display: 'flex', justifyContent: 'flex-end', width }) as const

  return new ImageResponse(
    (
      <OgFrame>
        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <OgLockup mark={MARK} size={50} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, marginTop: 5, ...ogLabel(17, OG.soft) }}>
              <OgSquare />
              <span>LIVE</span>
            </div>
          </div>
          <div style={{ display: 'flex', marginTop: 28 }}>
            <OgWords words={EYEBROW} size={13} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 46, whiteSpace: 'nowrap', ...ogDisplay(74) }}>
            <span>Every print</span>
            <span>is a button.</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, gap: 12 }}>
            <span style={ogLabel(15)}>HYPERLIQUID FILLS AS THEY LAND</span>
            <span style={ogLabel(15, OG.soft)}>LONG · SHORT · YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* left-bottom: what a row offers */}
        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex' }}>
          <OgChips size={12.5} ink={OG.muted} chips={[{ label: 'EVERY ROW · ONE SENTENCE · ONE TAP', plain: true }, { label: 'NO SIGN-UP TO LOOK', plain: true }]} />
        </div>

        {/* right: THE LEADERS — the venue's busiest books, the page's own pick */}
        <OgPanel left={618} top={56} width={518} height={518}>
          <OgPanelHead title="24H LEADERS" note={warm && live.asOf != null ? `LIVE · ${fmtUtc(live.asOf)}` : 'LIVE · FEED WARMING UP'} live={warm} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 0 6px', borderBottom: `1px solid ${OG.rule}`, margin: '0 22px' }}>
            <span style={ogLabel(10.5)}>MARKET</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ ...ogLabel(10.5), ...col(88) }}>24H</span>
              <span style={{ ...ogLabel(10.5), ...col(104) }}>MARK</span>
              <span style={{ ...ogLabel(10.5), ...col(92) }}>NOTIONAL</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 22px 0' }}>
            {rows.map((r) => {
              const m = tapeMarket(r.name)
              return (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, whiteSpace: 'nowrap' }}>
                    <span style={{ color: OG.ink, fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>{m.ticker}</span>
                    <span style={ogLabel(10.5)}>{m.kind === 'stock' ? 'STOCK' : 'PERP'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <OgMove pct={r.chgPct} size={13} width={88} />
                    <span style={{ ...col(104), ...ogNum(17, r.mark != null ? OG.ink : OG.muted) }}>{r.mark != null ? `$${fmtPrice(r.mark)}` : '—'}</span>
                    <span style={{ ...col(92), ...ogNum(13, r.volumeUsd > 0 ? OG.soft : OG.muted, 500) }}>{r.volumeUsd > 0 ? fmtUsd(r.volumeUsd) : '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px' }}>
            <span style={ogLabel(11)}>THE TAPE STREAMS IN YOUR BROWSER</span>
            <span style={ogNum(13, OG.violet)}>pantessa.com/live</span>
          </div>
        </OgPanel>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
