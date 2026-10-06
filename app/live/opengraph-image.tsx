import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'
import { FALLBACK_MARKETS, fmtPrice, fmtUsd, pickTapeMarkets, tapeMarket } from '@/lib/tape'

// Social card for /live — the live tape (og:image + twitter:image via
// ./twitter-image.tsx). The page named its own openGraph/twitter block with
// no picture, so a shared /live link unfurled blank (QA, squad front-door
// 2026-10-06) — and the splash's pulse now sends people there. Same idiom
// as /story's card: the claim in the hero's serif on the left, and on the
// right a panel the page actually shows.
//
// The panel is the venue's 24-hour LEADERS, not fills: the tape itself is a
// WebSocket the BROWSER opens (lib/tape-feed), and a card rendered on a
// server holds no socket, so it never pretends to. One POST to Hyperliquid's
// public info endpoint (metaAndAssetCtxs — the same read the page uses to
// pick its subscription), the rows chosen by lib/tape pickTapeMarkets, each
// with its mark, its 24h move and its 24h notional. A miss draws the fallback
// names with dashes and says the feed is warming up; it never fakes a number
// and never 500s. Fonts from assets/og-fonts (the families every other
// Pantessa card uses).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = `Pantessa Live — every print is a button. Hyperliquid fills as they land; the sentence that does the same at the end of every row, signed by your wallet.`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'
const LINE = 'rgba(255,255,255,0.10)'

/** The page's own eyebrow family: the five tiles above the tape. */
const EYEBROW = ['NOTIONAL / SEC', 'HOT MARKET', 'LARGEST PRINT', 'TAKER SPLIT']

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
/** Rows that fit the panel beside the claim. */
const ROWS = 8

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(ACCENT)

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
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi, live] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
    loadLeaders(),
  ])
  const warm = live.rows.length > 0
  // A miss draws the fallback names (the page's own list) with dashes.
  const rows: LeaderRow[] = warm
    ? live.rows
    : FALLBACK_MARKETS.filter((m) => !m.includes(':')).slice(0, ROWS).map((name) => ({ name, volumeUsd: 0, delisted: false, mark: null, chgPct: null }))

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        {/* ambient glow behind the tape */}
        <div style={{ position: 'absolute', right: -140, top: 40, width: 760, height: 560, borderRadius: 380, background: 'radial-gradient(circle, rgba(52,227,160,0.15) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

        {/* left: lockup + the claim */}
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={58} height={58} alt="" />
            <span style={{ color: INK, fontSize: 44, fontWeight: 600, letterSpacing: -1.8 }}>pantessa</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: ACCENT, fontSize: 19, letterSpacing: 5, marginLeft: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
              <span>LIVE</span>
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 15, letterSpacing: 3.5, color: MUTED, whiteSpace: 'nowrap' }}>
            {EYEBROW.map((w, i) => (
              <span key={w} style={{ display: 'flex' }}>
                {i > 0 && <span style={{ color: ACCENT, margin: '0 10px' }}>·</span>}
                <span>{w}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, fontFamily: 'Newsreader', fontWeight: 500, fontSize: 92, lineHeight: 0.98, letterSpacing: -3 }}>
            <span style={{ color: INK }}>Every print</span>
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
              is a button.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, gap: 12, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <span>HYPERLIQUID FILLS AS THEY LAND</span>
            <span style={{ color: '#b8bfb5' }}>LONG · SHORT · YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* left-bottom: what a row offers */}
        <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span>EVERY ROW · ONE SENTENCE · ONE TAP</span>
          </div>
          <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span>NO SIGN-UP TO LOOK</span>
          </div>
        </div>

        {/* right: THE LEADERS — the venue's busiest books, the page's own pick */}
        <div style={{ position: 'absolute', left: 618, top: 56, width: 518, height: 518, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: `1.5px solid ${LINE}` }}>
            <span style={{ color: INK, fontSize: 14, fontWeight: 600, letterSpacing: 3 }}>24H LEADERS</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: 2.5, color: warm ? ACCENT : MUTED }}>
              <div style={{ display: 'flex', width: 7, height: 7, borderRadius: 4, background: warm ? ACCENT : MUTED }} />
              <span>{warm && live.asOf != null ? `LIVE · ${fmtUtc(live.asOf)}` : 'LIVE · FEED WARMING UP'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 22px 4px', borderBottom: `1px solid ${LINE}`, margin: '0 22px', paddingLeft: 0, paddingRight: 0 }}>
            <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2 }}>MARKET</span>
            <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
              <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 84, justifyContent: 'flex-end', display: 'flex' }}>24H</span>
              <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 104, justifyContent: 'flex-end', display: 'flex' }}>MARK</span>
              <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 92, justifyContent: 'flex-end', display: 'flex' }}>NOTIONAL</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 22px 0' }}>
            {rows.map((r) => {
              const m = tapeMarket(r.name)
              const up = r.chgPct == null ? null : r.chgPct >= 0
              return (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, whiteSpace: 'nowrap' }}>
                    <span style={{ color: INK, fontSize: 19, fontWeight: 600, letterSpacing: -0.3 }}>{m.ticker}</span>
                    <span style={{ color: MUTED, fontSize: 12, letterSpacing: 1.5 }}>{m.kind === 'stock' ? 'STOCK' : 'PERP'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
                    {up == null ? (
                      <span style={{ color: MUTED, fontSize: 13, width: 84, justifyContent: 'flex-end', display: 'flex' }}>—</span>
                    ) : (
                      <span style={{ color: up ? ACCENT : DOWN, fontSize: 13, fontWeight: 600, width: 84, justifyContent: 'flex-end', display: 'flex' }}>
                        {up ? '▲' : '▼'} {Math.abs(r.chgPct ?? 0).toFixed(2)}%
                      </span>
                    )}
                    <span style={{ color: r.mark != null ? INK : MUTED, fontSize: 18, fontWeight: 600, width: 104, justifyContent: 'flex-end', display: 'flex' }}>{r.mark != null ? `$${fmtPrice(r.mark)}` : '—'}</span>
                    <span style={{ color: r.volumeUsd > 0 ? '#b8bfb5' : MUTED, fontSize: 13, width: 92, justifyContent: 'flex-end', display: 'flex' }}>{r.volumeUsd > 0 ? fmtUsd(r.volumeUsd) : '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px', fontSize: 11, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span style={{ color: MUTED }}>THE TAPE STREAMS IN YOUR BROWSER</span>
            <span style={{ color: ACCENT }}>pantessa.com/live</span>
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
