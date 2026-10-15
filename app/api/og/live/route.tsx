import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import LiveCard from '@/app/live/opengraph-image'
import { fmtPct, isBattleView } from '@/lib/battle'
import { ARMY_INKS, cardEyebrow, cardFoot, cardRankNote, cardRowHeight, cardRows, cardTagline, groundShare, headlineSize, parseLiveShare, shareName, type CardRow, type LiveShare, type VenueRow } from '@/lib/live-share'
import { armySliceNote } from '@/lib/market-pick'
import { gemMarkSvg } from '@/lib/og-marks'
import { fmtPrice, fmtUsd, tapeMarket } from '@/lib/tape'

// THE CARD THAT CARRIES THE PICK (GTM squad 2026-10-13, lane CARD). A shared
// `/live?view=front&t=ZK,OP,AZTEC` used to unfurl as the generic /live card
// (app/live/opengraph-image — the venue's 24h leaders, the same for every
// URL). The page's generateMetadata now points og:image + twitter:image here
// whenever `t` names a market, and this draws THOSE markets: last price, the
// 24h move and open interest from Hyperliquid's own context rows
// (metaAndAssetCtxs — the read the /live card and lib/battle-feed make; the
// xyz dex too when a stock perp is picked), the view named, the Front's five
// inks on a battle view.
//
// Honesty: a battle's live window (percent since the anchor, the last minute
// of fills) exists only in the viewer's browser, so a battle card ranks by the
// venue's 24h move as the proxy and says "24h" on its face. A feed miss draws
// dashes and "feed warming up"; a market the venue doesn't list says so. The
// numbers are Hyperliquid's and the card credits Hyperliquid — no other feed.
// Unknown input (no `t`, garbage, an over-long `t`, or a pick the venue lists
// none of) answers the generic /live card. It never 500s: a render that throws falls to the generic card, and a
// generic card that throws redirects to /live's own.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIZE = { width: 1200, height: 630 }
/** The tape's headline names this many; the panel lists the whole pick. */
const HEAD_TAPE = 4
const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const SOFT = '#b8bfb5'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'
const LINE = 'rgba(255,255,255,0.10)'

/** A live card holds a minute; a warming-up card a quarter of one. */
const CACHE_LIVE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=120'
const CACHE_MISS = 'public, max-age=15, s-maxage=15'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const MARK = gemMarkSvg(ACCENT)
const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// ── The venue read (the /live card's, duplicated on purpose: that file is not
//    this lane's, and the read is twenty lines) ──────────────────────────────

type Ctx = { markPx?: string; prevDayPx?: string; openInterest?: string }
type Meta = [{ universe?: { name: string; isDelisted?: boolean }[] }, Ctx[]]

/** One dex's rows; null when the venue didn't answer. Held 20s per process so
 *  a burst of unfurl scrapes is one read. */
const memo = new Map<string, { at: number; rows: VenueRow[] }>()
async function readDex(dex: string | null): Promise<VenueRow[] | null> {
  const key = dex ?? 'main'
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < 20_000) return hit.rows
  try {
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const [meta, ctxs] = (await res.json()) as Meta
    if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) return null
    const num = (v: string | undefined) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const rows: VenueRow[] = meta.universe.map((u, i) => ({
      name: u.name,
      delisted: Boolean(u.isDelisted),
      markPx: num(ctxs[i]?.markPx),
      prevDayPx: num(ctxs[i]?.prevDayPx),
      openInterest: num(ctxs[i]?.openInterest),
    }))
    memo.set(key, { at: Date.now(), rows })
    return rows
  } catch {
    return null
  }
}

/** The main book, plus the xyz dex when a stock perp is picked. null = the
 *  main book didn't answer (the card's "feed warming up"). */
async function readVenue(markets: readonly string[]): Promise<{ rows: VenueRow[]; asOf: number } | null> {
  const wantXyz = markets.some((m) => tapeMarket(m).dex === 'xyz')
  const [main, xyz] = await Promise.all([readDex(null), wantXyz ? readDex('xyz') : Promise.resolve([] as VenueRow[])])
  if (!main) return null
  return { rows: [...main, ...(xyz ?? [])], asOf: Date.now() }
}

// ── Fonts (once per process) ─────────────────────────────────────────────────

let fontsP: Promise<Buffer[]> | null = null
function fonts(): Promise<Buffer[]> {
  if (!fontsP) {
    const dir = join(process.cwd(), 'assets', 'og-fonts')
    fontsP = Promise.all(['newsreader-500.ttf', 'newsreader-500-italic.ttf', 'geist-500.ttf', 'geist-600.ttf'].map((f) => readFile(join(dir, f))))
    fontsP.catch(() => {
      fontsP = null
    })
  }
  return fontsP
}

function fmtUtc(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

// ── The picture ──────────────────────────────────────────────────────────────

function Card({ share, rows, warm, asOf }: { share: LiveShare; rows: CardRow[]; warm: boolean; asOf: number | null }) {
  const battle = isBattleView(share.view)
  // The headline names the markets in the venue's spelling (the rows'), in the
  // pick's order; the tape names four and counts the rest (the panel lists all).
  const bySlot = [...rows].sort((a, b) => a.slot - b.slot).map((r) => shareName(r.market))
  const names = battle ? bySlot : bySlot.slice(0, HEAD_TAPE)
  const more = battle ? 0 : Math.max(0, bySlot.length - HEAD_TAPE)
  const hl = headlineSize(names, battle)
  const slice = battle ? armySliceNote(share.pick) : null
  const rowH = cardRowHeight(share.view, rows.length)
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
      <div style={{ position: 'absolute', right: -140, top: 40, width: 760, height: 560, borderRadius: 380, background: 'radial-gradient(circle, rgba(52,227,160,0.13) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

      {/* left: lockup, the view, the names */}
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
        <div style={{ display: 'flex', marginTop: 26, fontSize: 16, letterSpacing: 4, color: ACCENT, whiteSpace: 'nowrap' }}>{cardEyebrow(share.view, share.since)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 22, fontFamily: 'Newsreader', fontWeight: 500, fontSize: hl, lineHeight: 1.02, letterSpacing: -2 }}>
          {names.map((n, i) => (
            <span key={`${n}-${i}`} style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap', marginRight: 14 }}>
              {battle && i > 0 && <span style={{ color: MUTED, fontStyle: 'italic', fontSize: Math.round(hl * 0.62), marginRight: 14 }}>vs</span>}
              <span style={{ color: battle ? ARMY_INKS[i % ARMY_INKS.length] : INK }}>{n}</span>
              {!battle && (i < names.length - 1 || more > 0) && <span style={{ color: MUTED, marginLeft: 14 }}>·</span>}
            </span>
          ))}
          {more > 0 && <span style={{ display: 'flex', color: MUTED, fontStyle: 'italic', fontSize: Math.round(hl * 0.62) }}>{`+${more} more`}</span>}
        </div>
        <span
          style={{
            display: 'flex',
            marginTop: 10,
            fontFamily: 'Newsreader',
            fontStyle: 'italic',
            fontWeight: 500,
            fontSize: 46,
            letterSpacing: -1,
            backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
            backgroundClip: 'text',
            color: 'transparent',
            paddingBottom: 10,
            paddingRight: 10,
          }}
        >
          {cardTagline(share.view)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 18, gap: 10, fontSize: 14, letterSpacing: 2.6, color: MUTED, whiteSpace: 'nowrap' }}>
          {cardRankNote(share.view, share.since).map((l) => (
            <span key={l}>{l}</span>
          ))}
          {slice && <span style={{ color: SOFT }}>{slice.toUpperCase()}</span>}
        </div>
      </div>

      <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
          <span>PRICES · HYPERLIQUID</span>
        </div>
        <div style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${LINE}`, color: MUTED, fontSize: 14, letterSpacing: 2, whiteSpace: 'nowrap' }}>
          <span>NO SIGN-UP TO LOOK</span>
        </div>
      </div>

      {/* right: the picked markets */}
      <div style={{ position: 'absolute', left: 618, top: 56, width: 518, height: 518, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: `1.5px solid ${LINE}` }}>
          <span style={{ color: INK, fontSize: 14, fontWeight: 600, letterSpacing: 3 }}>{share.view === 'flyover' ? 'YOUR PLOTS · 24H' : battle ? 'STANDINGS · 24H MOVE' : 'YOUR TAPE · 24H'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: 2.5, color: warm ? ACCENT : MUTED }}>
            <div style={{ display: 'flex', width: 7, height: 7, borderRadius: 4, background: warm ? ACCENT : MUTED }} />
            <span>{warm && asOf != null ? `HYPERLIQUID · ${fmtUtc(asOf)}` : 'FEED WARMING UP'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 0 6px', borderBottom: `1px solid ${LINE}`, margin: '0 22px' }}>
          <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2 }}>{battle ? '#  MARKET' : 'MARKET'}</span>
          <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
            <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 84, justifyContent: 'flex-end', display: 'flex' }}>24H</span>
            <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 100, justifyContent: 'flex-end', display: 'flex' }}>LAST</span>
            <span style={{ color: MUTED, fontSize: 11, letterSpacing: 2, width: 76, justifyContent: 'flex-end', display: 'flex' }}>OI</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 22px 0' }}>
          {rows.map((r) => {
            const m = tapeMarket(r.market)
            const up = r.chgPct == null ? null : r.chgPct >= 0
            const ink = battle ? ARMY_INKS[(r.slot - 1) % ARMY_INKS.length] : ACCENT
            const tag = !r.listed && warm ? 'NOT LISTED' : r.delisted ? 'DELISTED' : m.dex ? 'STOCK' : 'PERP'
            const share01 = groundShare(r.chgPct, rows)
            return (
              <div key={`${r.market}-${r.slot}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: rowH, borderBottom: battle ? `1px solid ${LINE}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                    {battle && <span style={{ color: r.rank === 1 ? INK : MUTED, fontSize: 15, fontWeight: 600, width: 18, display: 'flex' }}>{r.rank ?? '—'}</span>}
                    <div style={{ display: 'flex', width: battle ? 4 : 6, height: battle ? 26 : 6, borderRadius: 3, background: ink }} />
                    <span style={{ color: INK, fontSize: m.ticker.length > 6 ? 17 : battle ? 22 : 19, fontWeight: 600, letterSpacing: -0.3 }}>{m.ticker}</span>
                    <span style={{ color: tag === 'NOT LISTED' || tag === 'DELISTED' ? DOWN : MUTED, fontSize: 11, letterSpacing: 1.5 }}>{tag}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
                    {up == null ? (
                      <span style={{ color: MUTED, fontSize: 15, width: 84, justifyContent: 'flex-end', display: 'flex' }}>—</span>
                    ) : (
                      <span style={{ color: up ? ACCENT : DOWN, fontSize: 15, fontWeight: 600, width: 84, justifyContent: 'flex-end', display: 'flex' }}>
                        {up ? '▲' : '▼'} {fmtPct(Math.abs(r.chgPct ?? 0)).replace(/^\+/, '')}
                      </span>
                    )}
                    <span style={{ color: r.last != null ? INK : MUTED, fontSize: 18, fontWeight: 600, width: 100, justifyContent: 'flex-end', display: 'flex' }}>{r.last != null ? `$${fmtPrice(r.last)}` : '—'}</span>
                    <span style={{ color: r.oiUsd != null && r.oiUsd > 0 ? SOFT : MUTED, fontSize: 14, width: 76, justifyContent: 'flex-end', display: 'flex' }}>{r.oiUsd != null && r.oiUsd > 0 ? fmtUsd(r.oiUsd) : '—'}</span>
                  </div>
                </div>
                {battle && (
                  <div style={{ display: 'flex', position: 'relative', marginTop: 10, marginLeft: 28, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', position: 'absolute', left: '50%', top: -3, width: 1.5, height: 12, background: 'rgba(255,255,255,0.28)' }} />
                    {share01 !== 0 && (
                      <div
                        style={{
                          display: 'flex',
                          position: 'absolute',
                          top: 0,
                          height: 6,
                          borderRadius: 3,
                          background: ink,
                          opacity: share01 < 0 ? 0.55 : 1,
                          width: `${Math.max(1, Math.abs(share01) * 50)}%`,
                          ...(share01 > 0 ? { left: '50%' } : { right: '50%' }),
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px', fontSize: 11, letterSpacing: 2, whiteSpace: 'nowrap' }}>
          <span style={{ color: MUTED }}>{cardFoot(share.view)}</span>
          <span style={{ color: ACCENT }}>pantessa.com/live</span>
        </div>
      </div>
    </div>
  )
}

/** null = the venue answered and lists none of the picked markets: a card of
 *  dashes says nothing, so the caller serves the generic card. */
async function renderShare(share: LiveShare): Promise<{ png: ArrayBuffer; warm: boolean } | null> {
  const [[serif, serifItalic, sans, sansSemi], venue] = await Promise.all([fonts(), readVenue(share.markets)])
  const rows = cardRows(share, venue ? venue.rows : null)
  const warm = venue != null
  if (warm && !rows.some((r) => r.listed)) return null
  const res = new ImageResponse(<Card share={share} rows={rows} warm={warm} asOf={venue?.asOf ?? null} />, {
    ...SIZE,
    fonts: [
      { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
      { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
      { name: 'Geist', data: sans, weight: 500, style: 'normal' },
      { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
    ],
  })
  // Rendered to the end here, so a throw inside the renderer is caught below
  // rather than breaking a stream already sent with a 200.
  return { png: await res.arrayBuffer(), warm }
}

/** `x-pantessa-card` names the composition served (pick · warming · generic) —
 *  for the pins and anyone debugging an unfurl. */
function png(body: ArrayBuffer, cache: string, card: 'pick' | 'warming' | 'generic'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': cache, 'x-pantessa-card': card } })
}

async function generic(): Promise<Response> {
  try {
    const res = await LiveCard()
    return png(await res.arrayBuffer(), CACHE_LIVE, 'generic')
  } catch {
    return new Response(null, { status: 307, headers: { location: '/live/opengraph-image', 'cache-control': CACHE_MISS } })
  }
}

export async function GET(req: Request): Promise<Response> {
  let share: LiveShare | null = null
  try {
    const q = new URL(req.url).searchParams
    share = parseLiveShare({ view: q.get('view'), t: q.get('t'), since: q.get('since') })
  } catch {
    share = null
  }
  if (!share) return generic()
  try {
    const out = await renderShare(share)
    if (!out) return generic()
    return png(out.png, out.warm ? CACHE_LIVE : CACHE_MISS, out.warm ? 'pick' : 'warming')
  } catch {
    return generic()
  }
}
