import { ImageResponse } from 'next/og'
import LiveCard from '@/app/live/opengraph-image'
import { fmtPct, isBattleView } from '@/lib/battle'
import { ARMY_INKS, cardEyebrow, cardFoot, cardRankNote, cardRowHeight, cardRows, cardTagline, groundShare, headlineSize, parseLiveShare, shareName, type CardRow, type LiveShare, type VenueRow } from '@/lib/live-share'
import { armySliceNote } from '@/lib/market-pick'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, OgMove, OgPanel, OgPanelHead, OgSquare, ogDisplay, ogLabel, ogMix, ogNum } from '@/lib/og-brand'
import { OG_DISPLAY, brandOgFonts } from '@/lib/og-brand-fonts'
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
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the picked names and the view as the display line, upright, the
// rows in a square hairline panel with their numbers in the mono role. Green
// and red are a row's 24h move only. A battle's five inks are the page's own
// army colours (lib/live-share ARMY_INKS, the same hexes as the view the link
// opens), so they stay: they name a side, never a direction.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIZE = { width: 1200, height: 630 }
/** The tape's headline names this many; the panel lists the whole pick. */
const HEAD_TAPE = 4
/** A live card holds a minute; a warming-up card a quarter of one. */
const CACHE_LIVE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=120'
const CACHE_MISS = 'public, max-age=15, s-maxage=15'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const MARK = gemMarkSvg(undefined, { bare: true })

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
  // The display face sets wider than the serif the ladder was measured in.
  const hl = Math.round(headlineSize(names, battle) * 0.88)
  const slice = battle ? armySliceNote(share.pick) : null
  const rowH = cardRowHeight(share.view, rows.length)
  const col = (width: number) => ({ display: 'flex', justifyContent: 'flex-end', width }) as const
  return (
    <OgFrame>
      {/* left: lockup, the view, the names */}
      <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <OgLockup mark={MARK} size={50} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, marginTop: 5, ...ogLabel(17, OG.soft) }}>
            <OgSquare />
            <span>LIVE</span>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 30, ...ogLabel(15, OG.violet) }}>{cardEyebrow(share.view, share.since)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 24, ...ogDisplay(hl), lineHeight: 1.04 }}>
          {names.map((n, i) => (
            <span key={`${n}-${i}`} style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap', marginRight: 14 }}>
              {battle && i > 0 && <span style={{ color: OG.muted, fontSize: Math.round(hl * 0.62), marginRight: 14 }}>vs</span>}
              <span style={{ color: battle ? ARMY_INKS[i % ARMY_INKS.length] : OG.ink }}>{n}</span>
              {!battle && (i < names.length - 1 || more > 0) && <span style={{ color: OG.muted, marginLeft: 14 }}>·</span>}
            </span>
          ))}
          {more > 0 && <span style={{ display: 'flex', color: OG.muted, fontSize: Math.round(hl * 0.62) }}>{`+${more} more`}</span>}
        </div>
        <span style={{ display: 'flex', marginTop: 10, fontFamily: OG_DISPLAY, fontWeight: 600, fontSize: 42, letterSpacing: -0.6, color: OG.ink }}>{cardTagline(share.view)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22, gap: 10 }}>
          {cardRankNote(share.view, share.since).map((l) => (
            <span key={l} style={ogLabel(13)}>
              {l}
            </span>
          ))}
          {slice && <span style={ogLabel(13, OG.soft)}>{slice.toUpperCase()}</span>}
        </div>
      </div>

      <div style={{ position: 'absolute', left: 64, bottom: 44, display: 'flex' }}>
        <OgChips size={12} ink={OG.muted} chips={[{ label: 'PRICES · HYPERLIQUID', plain: true }, { label: 'NO SIGN-UP TO LOOK', plain: true }]} />
      </div>

      {/* right: the picked markets */}
      <OgPanel left={618} top={56} width={518} height={518}>
        <OgPanelHead title={share.view === 'flyover' ? 'YOUR PLOTS · 24H' : battle ? 'STANDINGS · 24H MOVE' : 'YOUR TAPE · 24H'} note={warm && asOf != null ? `HYPERLIQUID · ${fmtUtc(asOf)}` : 'FEED WARMING UP'} live={warm} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 0 6px', borderBottom: `1px solid ${OG.rule}`, margin: '0 22px' }}>
          <span style={ogLabel(10.5)}>{battle ? '#  MARKET' : 'MARKET'}</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ ...ogLabel(10.5), ...col(88) }}>24H</span>
            <span style={{ ...ogLabel(10.5), ...col(100) }}>LAST</span>
            <span style={{ ...ogLabel(10.5), ...col(76) }}>OI</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 22px 0' }}>
          {rows.map((r) => {
            const m = tapeMarket(r.market)
            const ink = battle ? ARMY_INKS[(r.slot - 1) % ARMY_INKS.length] : OG.violet
            const tag = !r.listed && warm ? 'NOT LISTED' : r.delisted ? 'DELISTED' : m.dex ? 'STOCK' : 'PERP'
            const share01 = groundShare(r.chgPct, rows)
            return (
              <div key={`${r.market}-${r.slot}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: rowH, borderBottom: battle ? `1px solid ${OG.rule}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
                    {battle && <span style={{ display: 'flex', width: 18, ...ogNum(15, r.rank === 1 ? OG.ink : OG.muted) }}>{r.rank ?? '—'}</span>}
                    <div style={{ display: 'flex', width: battle ? 4 : 6, height: battle ? 26 : 6, background: ink }} />
                    <span style={{ color: OG.ink, fontSize: m.ticker.length > 6 ? 17 : battle ? 22 : 19, fontWeight: 600, letterSpacing: -0.3 }}>{m.ticker}</span>
                    <span style={ogLabel(10.5, tag === 'NOT LISTED' || tag === 'DELISTED' ? OG.ink : OG.muted)}>{tag}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <OgMove pct={r.chgPct} text={fmtPct(Math.abs(r.chgPct ?? 0)).replace(/^\+/, '')} size={14.5} width={88} />
                    <span style={{ ...col(100), ...ogNum(17, r.last != null ? OG.ink : OG.muted) }}>{r.last != null ? `$${fmtPrice(r.last)}` : '—'}</span>
                    <span style={{ ...col(76), ...ogNum(13.5, r.oiUsd != null && r.oiUsd > 0 ? OG.soft : OG.muted, 500) }}>{r.oiUsd != null && r.oiUsd > 0 ? fmtUsd(r.oiUsd) : '—'}</span>
                  </div>
                </div>
                {battle && (
                  <div style={{ display: 'flex', position: 'relative', marginTop: 10, marginLeft: 28, height: 6, background: '#161924' }}>
                    <div style={{ display: 'flex', position: 'absolute', left: '50%', top: -3, width: 1.5, height: 12, background: OG.muted }} />
                    {share01 !== 0 && (
                      <div
                        style={{
                          display: 'flex',
                          position: 'absolute',
                          top: 0,
                          height: 6,
                          // Ground lost is the side's ink walked toward the panel: a flat fill, never a see-through one.
                          background: share01 < 0 ? ogMix(ink, OG.panel, 0.45) : ink,
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 22px 14px' }}>
          <span style={ogLabel(11)}>{cardFoot(share.view)}</span>
          <span style={ogNum(13, OG.violet)}>pantessa.com/live</span>
        </div>
      </OgPanel>
    </OgFrame>
  )
}

/** null = the venue answered and lists none of the picked markets: a card of
 *  dashes says nothing, so the caller serves the generic card. */
async function renderShare(share: LiveShare): Promise<{ png: ArrayBuffer; warm: boolean } | null> {
  const [fonts, venue] = await Promise.all([brandOgFonts(), readVenue(share.markets)])
  const rows = cardRows(share, venue ? venue.rows : null)
  const warm = venue != null
  if (warm && !rows.some((r) => r.listed)) return null
  const res = new ImageResponse(<Card share={share} rows={rows} warm={warm} asOf={venue?.asOf ?? null} />, { ...SIZE, fonts })
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
