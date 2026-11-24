import { ImageResponse } from 'next/og'
import { cutPMarkSvg } from '@/lib/og-marks'
import { OG_DISPLAY, OG_MONO, brandOgFonts, ogTrack } from '@/lib/og-brand-fonts'
import { ADDED_MARK, VERDICT_WORDS, judgedLine, moveLine, pickCalls, sinceLine, type CalledCall, type CalledRecord, type CallVerdict } from '@/lib/called-it/spec'
import {
  OG_CALL,
  OG_COLUMN,
  OG_MAX_CARDS,
  OG_PANEL,
  OG_SIZE,
  callPlot,
  callQuote,
  callQuoteFit,
  clampPostWidth,
  cleanLine,
  fmtCallPrice,
  fmtCount,
  fmtUtcDate,
  headlineParts,
  headlineTally,
  initialOf,
  linePaths,
  ogLayout,
  plotScale,
  sentenceCase,
  textUnits,
  unreadShare,
  type CallPlot,
  type ClosePoint,
  type OgCardBox,
  type OgLayout,
  type PlotScale,
} from '@/lib/called-it/card-layout'

// THE SHARE IMAGE for one record (squad called-it, lane RECORD): the artifact
// people post. Left, a scoreboard: who, on what market, the FULL tally in the
// record's own words, the standing line, the address. Right, the exhibit: the
// daily closes across the record's window with up to four post cards, each
// tied by a leader line to the day it was posted, each stamped with its
// verdict in a word and a colour.
//
// Where everything stands is lib/called-it/card-layout ogLayout (pure,
// pinned: cards never overlap each other or the scoreboard, a leader never
// crosses a card or another leader). This file only paints it.
//
// WHAT IT MAY CLAIM (squad review R1, R8). The scoreboard's tally is the
// record's own headline: what the SCAN found. A record nobody has scanned (its
// posts were pasted by viewers) draws no tally at all: the scoreboard says, in
// the record's own words, that a viewer added the posts and that there is no
// tally, and every pasted post that is drawn wears spec's mark and a dashed
// edge. What the scans read is the record's coverage line, small, above the
// standing line; a drawn stretch they did not read is dimmed and says so.
//
// THE LOOK (squad mobile-sleek, 2026-11-24; brand guidelines section 7): the
// ground is #07080D edge to edge and everything on it is flat: no gradient,
// glow, shadow, rounded corner or pill. The Cut P wears its own magenta and
// violet; green and red are the market's (a verdict), never the brand's. A
// call is the brand's cut-corner tile in its verdict's colour (the geometry of
// components/sleek/VerdictTile, drawn as plain paths: the renderer has no
// clip-path). Labels and numbers are spaced capitals; the display line is
// upright.
//
// A post's words reach the picture as TEXT (a React string the renderer
// draws), clamped for the small card and never reworded; nothing from a post
// is ever placed in the SVG below, which is built from numbers alone. The
// avatar is a data URI the server fetched from X's own image host, or the
// account's initial.

const BG = '#07080D'
const INK = '#FFFFFF'
const MUTED = '#7C8499'
const SOFT = '#B4BAC8'
const VIOLET = '#9F7AFF'
const UP = '#2AF598'
const DOWN = '#FF3B47'
const GOLD = '#F0B454'
const FLAT = '#8E94A3'
const CARD_BG = '#0C0E15'
const LINE = 'rgba(255,255,255,0.14)'
const TONE: Record<CallVerdict, string> = { right: UP, wrong: DOWN, flat: FLAT, open: GOLD }
/** The tile's shaded half: the verdict's colour at 68% over black (sleek.css `.sk-tile__shade`). */
const TONE_SHADE: Record<CallVerdict, string> = { right: '#1DA767', wrong: '#AD2830', flat: '#61656F', open: '#A37A39' }

/** The faces by role (lib/og-brand-fonts). */
const DISPLAY = OG_DISPLAY
const MONO = OG_MONO
const track = ogTrack

/** A post card's two lines, in lowercase-letter widths (card-layout textUnits): 328px of 17.5px Geist, less a word's worth of ragged edge. */
const CARD_TEXT_UNITS = 62

const MARK = cutPMarkSvg()
const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// ── What a card is drawn from ───────────────────────────────────────────

/**
 * `pasted`: a record with no scan behind it, only posts viewers added. It is never drawn as a record.
 * `call` (squad called-gtm): ONE call of a ready record leads, with the record's whole tally along the foot.
 */
export type CalledCardKind = 'record' | 'call' | 'pasted' | 'empty' | 'unscanned' | 'scanning' | 'refused' | 'handle' | 'generic'

export interface CalledCardInput {
  kind: CalledCardKind
  handle: string | null
  symbol: string | null
  record: CalledRecord | null
  closes: readonly ClosePoint[]
  avatar: string | null
  /** A refusal's own words. */
  reason?: string
  /** The chart's unit (dollars unless the market is an index level or a yield). */
  unit?: 'usd' | 'level' | 'yield'
  /** Kind `call`: the call that leads. It is one of `record.calls`. */
  call?: CalledCall
}

/** The calls that get a post card: the plot's pins, the best hit and the worst miss first, then by impact (spec pickCalls). */
export function cardedCalls(record: CalledRecord): CalledCall[] {
  const picked = record.calls.filter((c) => c.picked)
  const ids = new Set(pickCalls(picked, { max: OG_MAX_CARDS }))
  return picked.filter((c) => ids.has(c.postId))
}

// ── The tile (numbers only) ─────────────────────────────────────────────

const n2 = (v: number) => Math.round(v * 100) / 100
/**
 * The brand's cut-corner tile at (x, y), `size` wide, in a verdict's colour:
 * the lit half over the shaded half, and the verdict's glyph when the tile is
 * big enough to carry one (components/sleek/VerdictTile, the same paths).
 * `hollow` (a pasted post): the outline alone.
 */
function tileSvg(x: number, y: number, size: number, verdict: CallVerdict, hollow = false): string {
  const k = size / 24
  const c = (24 * 16) / 72
  const tone = TONE[verdict]
  const g = `<g transform="translate(${n2(x)} ${n2(y)}) scale(${n2(k)})">`
  if (hollow) return `${g}<path d="M ${n2(c)} 0 L 24 0 L 24 ${n2(24 - c)} L ${n2(24 - c)} 24 L 0 24 L 0 ${n2(c)} Z" fill="${BG}" stroke="${tone}" stroke-width="${n2(2.2 / k)}"/></g>`
  const glyph =
    size < 15
      ? ''
      : verdict === 'right'
        ? `<path d="M 7 12.4 L 10.6 16 L 17.2 8.6" fill="none" stroke="${BG}" stroke-width="2.6"/>`
        : verdict === 'wrong'
          ? `<path d="M 8 8 L 16 16 M 16 8 L 8 16" fill="none" stroke="${BG}" stroke-width="2.6"/>`
          : verdict === 'flat'
            ? `<path d="M 7.5 12 L 16.5 12" fill="none" stroke="${BG}" stroke-width="2.6"/>`
            : [6.2, 10.6, 15].map((gx) => `<rect x="${gx}" y="10.6" width="2.8" height="2.8" fill="${BG}"/>`).join('')
  return `${g}<path d="M ${n2(c)} 0 L 24 0 L 0 24 L 0 ${n2(c)} Z" fill="${tone}"/><path d="M 24 0 L 24 ${n2(24 - c)} L ${n2(24 - c)} 24 L 0 24 Z" fill="${TONE_SHADE[verdict]}"/>${glyph}</g>`
}
const tileUri = (size: number, verdict: CallVerdict, hollow = false) => toDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${tileSvg(0, 0, size, verdict, hollow)}</svg>`)
/** A box with the tile's two cut corners (top-left, bottom-right), as a path. */
const cutBox = (x: number, y: number, w: number, h: number, cut: number) => `M ${x + cut} ${y} L ${x + w} ${y} L ${x + w} ${y + h - cut} L ${x + w - cut} ${y + h} L ${x} ${y + h} L ${x} ${y + cut} Z`
/** A call that gets no card: a small square in its verdict's colour (outlined when pasted). */
const squareSvg = (x: number, y: number, tone: string, hollow: boolean) => (hollow ? `<rect x="${n2(x - 3.5)}" y="${n2(y - 3.5)}" width="7" height="7" fill="${BG}" stroke="${tone}" stroke-width="1.6"/>` : `<rect x="${n2(x - 4)}" y="${n2(y - 4)}" width="8" height="8" fill="${tone}" stroke="${BG}" stroke-width="1.5"/>`)

// ── The exhibit's drawing (numbers only) ────────────────────────────────

const CARD_CUT = 12
const PIN = 22

function exhibitSvg(layout: OgLayout, scale: PlotScale | null, closes: readonly ClosePoint[], tones: Map<string, CallVerdict>, hollow: ReadonlySet<string>, unread: number): string {
  const { panel: P, band } = layout
  const parts: string[] = [`<rect x="${P.x + 0.5}" y="${P.y + 0.5}" width="${P.w - 1}" height="${P.h - 1}" fill="none" stroke="${LINE}" stroke-width="1"/>`]
  if (scale) parts.push(`<path d="${linePaths(closes, scale, band).line}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt"/>`)
  // The stretch the scans did not read: dimmed, with a dashed edge where reading began.
  if (scale && unread > 0) {
    const w = Math.round(band.w * unread * 10) / 10
    parts.push(`<rect x="${band.x}" y="${band.y - 4}" width="${w}" height="${band.h + 8}" fill="${BG}" fill-opacity="0.62"/>`, `<line x1="${band.x + w}" y1="${band.y - 4}" x2="${band.x + w}" y2="${band.y + band.h + 4}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4 6"/>`)
  }
  const verdictOf = (id: string) => tones.get(id) ?? 'flat'
  // A pasted post is drawn hollow, its leader and its card's edge dashed: shown, marked, never counted.
  for (const c of layout.cards) parts.push(`<line x1="${c.attach.x}" y1="${c.attach.y}" x2="${c.anchor.x}" y2="${c.anchor.y}" stroke="${TONE[verdictOf(c.id)]}" stroke-width="1.5"${hollow.has(c.id) ? ' stroke-dasharray="5 6"' : ''}/>`)
  for (const d of layout.dots.filter((x) => !x.carded)) parts.push(squareSvg(d.x, d.y, TONE[verdictOf(d.id)], hollow.has(d.id)))
  for (const d of layout.dots.filter((x) => x.carded)) parts.push(`<rect x="${n2(d.x - PIN / 2 - 2)}" y="${n2(d.y - PIN / 2 - 2)}" width="${PIN + 4}" height="${PIN + 4}" fill="${BG}"/>`, tileSvg(d.x - PIN / 2, d.y - PIN / 2, PIN, verdictOf(d.id), hollow.has(d.id)))
  // The post cards' own boxes: the cut corner, a hairline in the verdict's colour.
  for (const c of layout.cards) parts.push(`<path d="${cutBox(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, CARD_CUT)}" fill="${CARD_BG}" stroke="${TONE[verdictOf(c.id)]}" stroke-opacity="0.7" stroke-width="1.25"${hollow.has(c.id) ? ' stroke-dasharray="6 5"' : ''}/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.w}" height="${OG_SIZE.h}" viewBox="0 0 ${OG_SIZE.w} ${OG_SIZE.h}">${parts.join('')}</svg>`
}

/** No record to draw: the idea of one. Three empty post outlines tied to a line that is nobody's price. */
function schematicSvg(): string {
  const P = OG_PANEL
  const y0 = P.y + P.h / 2
  const pts: string[] = []
  for (let i = 0; i <= 60; i++) {
    const x = P.x + 40 + ((P.w - 80) * i) / 60
    const y = y0 + Math.sin(i / 6.2) * 46 + Math.sin(i / 2.3) * 12 - (i - 30) * 0.9
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  const at = (i: number) => pts[i].split(' ').map(Number) as [number, number]
  // The ghosts' tiles are outlines in grey: an idea of a call, never a verdict on anybody.
  const ghost = (i: number, top: boolean) => {
    const [x, y] = at(i)
    const cx = Math.round(Math.min(Math.max(x - 120, P.x + 24), P.x + P.w - 264))
    const cy = top ? P.y + 30 : P.y + P.h - 30 - 92
    return `<path d="${cutBox(cx + 0.5, cy + 0.5, 240, 92, CARD_CUT)}" fill="none" stroke="rgba(255,255,255,0.26)" stroke-width="1.25" stroke-dasharray="6 6"/><line x1="${x}" y1="${top ? cy + 92 : cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.3)" stroke-width="1.25" stroke-dasharray="3 5"/>${tileSvg(x - 10, y - 10, 20, 'flat', true)}`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.w}" height="${OG_SIZE.h}" viewBox="0 0 ${OG_SIZE.w} ${OG_SIZE.h}"><rect x="${P.x + 0.5}" y="${P.y + 0.5}" width="${P.w - 1}" height="${P.h - 1}" fill="none" stroke="${LINE}" stroke-width="1"/><path d="M${pts.join('L')}" fill="none" stroke="${INK}" stroke-opacity="0.6" stroke-width="2" stroke-linejoin="miter"/>${ghost(12, true)}${ghost(31, false)}${ghost(49, true)}</svg>`
}

// ── Pieces ──────────────────────────────────────────────────────────────

function Face({ uri, initial, size }: { uri: string | null; initial: string; size: number }) {
  if (uri) {
    // (A true circle stays for an avatar.)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={uri} width={size} height={size} alt="" style={{ borderRadius: size / 2, objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: size / 2, background: '#161924', border: `1px solid ${LINE}`, color: INK, fontFamily: DISPLAY, fontWeight: 600, fontSize: Math.round(size * 0.5), flexShrink: 0 }}>
      {initial}
    </div>
  )
}

/** The lockup: the Cut P in its own colours and the wordmark. */
function Lockup({ size, label }: { size: number; label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.3), width: '100%' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={toDataUri(MARK)} width={size} height={size} alt="" />
      <span style={{ color: INK, fontFamily: DISPLAY, fontWeight: 600, fontSize: Math.round(size * 0.86), letterSpacing: -0.6, lineHeight: 1 }}>pantessa</span>
      {label && <span style={{ color: MUTED, fontFamily: MONO, fontSize: 12.5, letterSpacing: track(12.5), marginLeft: 'auto', whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  )
}

/** A headline count's own number, for a bar's proportions only (the words printed are the record's, untouched). */
const countOf = (words: string): number => {
  const v = parseInt(words, 10)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** The tally as ONE flat bar, a segment per verdict in proportion (the squad's score bar). */
function ScoreBar({ counts, width, height }: { counts: { kind: string; text: string }[]; width: number; height: number }) {
  const segs = counts.filter((c) => c.kind !== 'total').map((c) => ({ kind: c.kind as CallVerdict, n: countOf(c.text) }))
  const total = segs.reduce((a, s) => a + s.n, 0)
  if (!total) return <div style={{ display: 'flex', width, height, background: LINE }} />
  return (
    <div style={{ display: 'flex', width, height, gap: 2 }}>
      {segs
        .filter((s) => s.n > 0)
        .map((s) => (
          <div key={s.kind} style={{ display: 'flex', flexGrow: s.n, flexShrink: 1, flexBasis: 0, minWidth: 4, height, background: TONE[s.kind] }} />
        ))}
    </div>
  )
}

function PostCard({ box, call }: { box: OgCardBox; call: CalledCall }) {
  const tone = TONE[call.verdict]
  const added = call.origin === 'added'
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', flexDirection: 'column', padding: '11px 16px 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tileUri(20, call.verdict, added)} width={20} height={20} alt="" />
        <span style={{ color: tone, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>{VERDICT_WORDS[call.verdict]}</span>
        <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11, letterSpacing: track(11), whiteSpace: 'nowrap' }}>{call.stance === 'bull' ? 'BULL' : 'BEAR'}</span>
        {/* A pasted post wears spec's mark where the day sits; its day moves to the foot. */}
        {added ? (
          <span style={{ display: 'flex', marginLeft: 'auto', padding: '1px 6px', border: '1px dashed rgba(255,255,255,0.4)', color: SOFT, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>{ADDED_MARK}</span>
        ) : (
          <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11, letterSpacing: track(11), marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtUtcDate(call.postedAt).toUpperCase()}</span>
        )}
      </div>
      <div style={{ display: 'flex', marginTop: 6, height: 47, overflow: 'hidden', color: INK, fontSize: 17.5, lineHeight: 1.34 }}>
        <span>{clampPostWidth(call.text, CARD_TEXT_UNITS)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, height: 20 }}>
        <span style={{ color: tone, fontFamily: MONO, fontSize: added ? 12.5 : 13.5, fontWeight: 600, letterSpacing: added ? 0 : 0.2, whiteSpace: 'nowrap' }}>{moveLine(call)}</span>
        {added && <span style={{ color: MUTED, fontFamily: MONO, fontSize: 10.5, letterSpacing: track(10.5), marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtUtcDate(call.postedAt).toUpperCase()}</span>}
      </div>
    </div>
  )
}

/** "on BTC" / "bullish on BTC": the headline's own words between the handle and the colon. */
function marketWords(record: CalledRecord | null, handle: string | null, symbol: string | null): string {
  if (record) {
    const who = headlineParts(record.words.headline)?.who ?? record.words.headline.split(': ')[0] ?? ''
    const rest = who.replace(/: $/, '').replace(`@${record.handle}`, '').replace(/^,?\s*/, '')
    if (rest) return rest
  }
  return symbol ? `on ${symbol}` : handle ? 'market by market' : ''
}

function Scoreboard({ input, address }: { input: CalledCardInput; address: string }) {
  const { record, handle, symbol, kind } = input
  const C = OG_COLUMN
  // X gave no display name (a bare profile): the handle is the name, printed once.
  const bare = !record || !record.profile.name.trim() || record.profile.name.trim().toLowerCase() === record.handle
  const name = record && !bare ? cleanLine(record.profile.name, 24) : handle ? `@${handle}` : ''
  const market = marketWords(record, handle, symbol)
  // The display line: "@handle on ETH". It may take two lines; a long handle steps the size down.
  const display = handle ? `@${handle}${market ? ` ${market}` : ''}` : ''
  const displaySize = display.length <= 12 ? 44 : display.length <= 15 ? 37 : display.length <= 21 ? 30 : 26
  const parts = record ? headlineParts(record.words.headline) : null
  const counts = parts ? parts.counts.filter((c) => c.kind !== 'total') : []
  const total = parts?.counts.find((c) => c.kind === 'total')?.text ?? null
  const message =
    kind === 'generic'
      ? 'Plot any X handle on a chart. Every call pinned to the day it was posted, judged by what the price did next.'
      : kind === 'handle'
        ? 'Every call pinned to the day it was posted, judged by what the price did next.'
        : kind === 'unscanned'
          ? 'Not plotted yet. Anyone can plot it.'
          : kind === 'scanning'
            ? 'A scan is reading this account’s posts now.'
            : kind === 'refused'
              ? cleanLine(input.reason ?? 'This record could not be drawn.', 130)
              : null
  return (
    <div style={{ position: 'absolute', left: C.x, top: C.y, width: C.w, height: C.h, display: 'flex', flexDirection: 'column' }}>
      <Lockup size={30} label="CALLED IT" />

      {handle ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 26 }}>
          <Face uri={input.avatar} initial={initialOf(record?.profile.name, handle)} size={46} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: INK, fontSize: 20, fontWeight: 600, letterSpacing: -0.3, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {record?.profile.followers != null && <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11.5, letterSpacing: track(11.5), marginTop: 3, whiteSpace: 'nowrap' }}>{`${fmtCount(record.profile.followers)} FOLLOWERS`}</span>}
          </div>
        </div>
      ) : (
        <span style={{ display: 'flex', marginTop: 40, color: INK, fontFamily: DISPLAY, fontWeight: 600, fontSize: 60, letterSpacing: -1.6, lineHeight: 1 }}>Whose calls?</span>
      )}

      {display && <span style={{ display: 'flex', marginTop: 16, width: C.w, color: INK, fontFamily: DISPLAY, fontWeight: 600, fontSize: displaySize, letterSpacing: -0.8, lineHeight: 1.06, wordBreak: 'break-word' }}>{display}</span>}
      {record && <span style={{ display: 'flex', marginTop: 10, color: MUTED, fontFamily: MONO, fontSize: 12, letterSpacing: track(12), whiteSpace: 'nowrap' }}>{`DAILY CLOSES · NOW ${fmtCallPrice(record.priceNow, input.unit ?? 'usd')}`}</span>}

      {record && parts && (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20 }}>
          {total && <span style={{ color: SOFT, fontFamily: MONO, fontSize: 13, letterSpacing: track(13), marginBottom: 8 }}>{total.toUpperCase()}</span>}
          <ScoreBar counts={parts.counts} width={C.w} height={10} />
          <div style={{ display: 'flex', flexWrap: 'wrap', width: C.w, marginTop: 10 }}>
            {counts.map((c) => (
              <div key={c.kind} style={{ display: 'flex', alignItems: 'center', gap: 7, width: C.w / 2, height: 27 }}>
                <div style={{ display: 'flex', width: 9, height: 9, background: TONE[c.kind as CallVerdict], flexShrink: 0 }} />
                <span style={{ color: INK, fontFamily: MONO, fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {record && !parts && <span style={{ display: 'flex', marginTop: 22, color: INK, fontSize: 24, lineHeight: 1.25 }}>{sentenceCase(headlineTally(record.words.headline))}</span>}
      {message && <span style={{ display: 'flex', marginTop: 24, color: kind === 'generic' || kind === 'handle' ? SOFT : INK, fontSize: kind === 'refused' ? 21 : 23, lineHeight: 1.3 }}>{message}</span>}

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
        {record?.words.coverage && <span style={{ color: MUTED, fontSize: 12.5, lineHeight: 1.35, marginBottom: 7 }}>{record.words.coverage}</span>}
        {record && <span style={{ color: record.verified ? UP : SOFT, fontSize: 14.5, fontWeight: record.verified ? 600 : 500, lineHeight: 1.35 }}>{record.words.standing}</span>}
        <span style={{ color: VIOLET, fontFamily: MONO, fontSize: 13.5, marginTop: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: C.w }}>{address}</span>
      </div>
    </div>
  )
}

function CalledCard({ input, address }: { input: CalledCardInput; address: string }) {
  const { record, closes } = input
  const carded = record ? cardedCalls(record) : []
  const cardedIds = new Set(carded.map((c) => c.postId))
  const scale = plotScale(closes, record ? record.calls.map((c) => c.priceAt) : [])
  const toIn = (c: CalledCall) => ({ id: c.postId, t: c.barTime, price: c.priceAt })
  const layout = ogLayout(scale, carded.map(toIn), record ? record.calls.filter((c) => !cardedIds.has(c.postId)).map(toIn) : [])
  const tones = new Map((record?.calls ?? []).map((c) => [c.postId, c.verdict]))
  const byId = new Map((record?.calls ?? []).map((c) => [c.postId, c]))
  const schematic = !scale
  const hollow = new Set((record?.calls ?? []).filter((c) => c.origin === 'added').map((c) => c.postId))
  const unread = scale && record ? unreadShare(scale, record.coverage?.from) : 0
  const svg = schematic ? schematicSvg() : exhibitSvg(layout, scale, closes, tones, hollow, unread)
  const note = input.kind === 'empty' ? 'No calls found in this window' : input.kind === 'unscanned' ? 'No pins yet' : input.kind === 'scanning' ? 'Pins land when the scan is done' : null
  const B = layout.band
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={toDataUri(svg)} width={OG_SIZE.w} height={OG_SIZE.h} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />

      {!schematic && closes.length > 1 && (
        <div style={{ position: 'absolute', left: B.x, top: B.y + B.h + 5, width: B.w, display: 'flex', justifyContent: 'space-between', color: MUTED, fontFamily: MONO, fontSize: 11.5, letterSpacing: track(11.5) }}>
          <span>{fmtUtcDate(closes[0].t * 1000).toUpperCase()}</span>
          <span>{fmtUtcDate(closes[closes.length - 1].t * 1000).toUpperCase()}</span>
        </div>
      )}
      {unread > 0.06 && !schematic && (
        <span style={{ position: 'absolute', left: B.x + 6, top: B.y + B.h - 22, display: 'flex', padding: '2px 8px', background: BG, color: SOFT, fontFamily: MONO, fontSize: 11, letterSpacing: track(11) }}>NOT READ</span>
      )}
      {note && !schematic && (
        <div style={{ position: 'absolute', left: OG_PANEL.x, top: OG_PANEL.y + 26, width: OG_PANEL.w, display: 'flex', justifyContent: 'center' }}>
          <span style={{ display: 'flex', padding: '8px 18px', border: `1px solid ${LINE}`, background: BG, color: SOFT, fontFamily: MONO, fontSize: 14, letterSpacing: track(14) }}>{note.toUpperCase()}</span>
        </div>
      )}

      {record &&
        layout.cards.map((box) => {
          const call = byId.get(box.id)
          return call ? <PostCard key={box.id} box={box} call={call} /> : null
        })}

      <Scoreboard input={input} address={address} />
    </div>
  )
}

// ── ONE CALL (squad called-gtm, lane CALL) ──────────────────────────────
// The image that unfurls when an account reposts the call it was sent. Flat:
// no glow, no gradient. Left, the words: the verdict in spec's word beside
// its tile, the post's own words large (card-layout callQuote: the whole
// post, or the labeled span with an ellipsis where the post goes on), who
// said it and the day. Right, the proof: the daily closes with THIS call's
// day marked by its tile (every other call of the record a small square in
// its verdict's colour), the price that day and the record's own move words.
// Along the foot, always: the record's WHOLE tally as the score bar and in
// its own headline's words, and the standing line. The drawing is built from
// numbers alone.

function callPlotSvg(plot: CallPlot | null, scale: PlotScale | null, closes: readonly ClosePoint[], verdict: CallVerdict, tones: Map<string, CallVerdict>, hollow: ReadonlySet<string>, added: boolean, unread: number): string {
  const B = OG_CALL.plot
  const parts: string[] = []
  if (plot && scale) {
    const base = B.y + B.h + 10
    parts.push(`<line x1="${B.x}" y1="${base}" x2="${B.x + B.w}" y2="${base}" stroke="${LINE}" stroke-width="1"/>`, `<path d="${linePaths(closes, scale, B).line}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt"/>`)
    // The stretch the scans did not read: dimmed, with a dashed edge where reading began.
    if (unread > 0) {
      const w = Math.round(B.w * unread * 10) / 10
      parts.push(`<rect x="${B.x - 2}" y="${B.y - 6}" width="${w + 2}" height="${B.h + 14}" fill="${BG}" fill-opacity="0.66"/>`, `<line x1="${B.x + w}" y1="${B.y - 6}" x2="${B.x + w}" y2="${base}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-dasharray="4 6"/>`)
    }
    for (const o of plot.others) parts.push(squareSvg(o.x, o.y, TONE[tones.get(o.id) ?? 'flat'], hollow.has(o.id)))
    const { x, y } = plot.dot
    const pin = 28
    parts.push(
      `<line x1="${x}" y1="${B.y - 14}" x2="${x}" y2="${base}" stroke="${TONE[verdict]}" stroke-width="1.5"${added ? ' stroke-dasharray="5 6"' : ''}/>`,
      `<rect x="${n2(x - pin / 2 - 3)}" y="${n2(y - pin / 2 - 3)}" width="${pin + 6}" height="${pin + 6}" fill="${BG}"/>`,
      tileSvg(x - pin / 2, y - pin / 2, pin, verdict, added),
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.w}" height="${OG_SIZE.h}" viewBox="0 0 ${OG_SIZE.w} ${OG_SIZE.h}">${parts.join('')}</svg>`
}

function OneCallCard({ input, address }: { input: CalledCardInput; address: string }) {
  const record = input.record as CalledRecord
  const call = input.call as CalledCall
  const unit = input.unit ?? 'usd'
  const tone = TONE[call.verdict]
  const added = call.origin === 'added'
  const Q = OG_CALL.quote
  const B = OG_CALL.plot
  const W = OG_SIZE.w - 2 * OG_CALL.pad
  const scale = plotScale(input.closes, record.calls.map((c) => c.priceAt))
  const toIn = (c: CalledCall) => ({ id: c.postId, t: c.barTime, price: c.priceAt })
  const plot = callPlot(scale, toIn(call), record.calls.map(toIn))
  const tones = new Map(record.calls.map((c) => [c.postId, c.verdict]))
  const hollow = new Set(record.calls.filter((c) => c.origin === 'added').map((c) => c.postId))
  const unread = scale ? unreadShare(scale, record.coverage?.from) : 0
  const quote = callQuote(call.text, call.quote)
  const fit = callQuoteFit(textUnits(quote.text))
  const bare = !record.profile.name.trim() || record.profile.name.trim().toLowerCase() === record.handle
  const name = bare ? `@${record.handle}` : cleanLine(record.profile.name, 24)
  const under = [bare ? null : `@${record.handle}`, record.profile.followers != null ? `${fmtCount(record.profile.followers)} followers` : null].filter(Boolean).join(' · ')
  const parts = headlineParts(record.words.headline)
  const since = sinceLine(call)
  // The day's tag sits beside its mark, on whichever side has the room.
  const tagLeft = plot ? (plot.dot.x > B.x + B.w * 0.62 ? plot.dot.x - 10 - 150 : plot.dot.x + 10) : 0
  const tagRight = !!plot && plot.dot.x > B.x + B.w * 0.62
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={toDataUri(callPlotSvg(plot, scale, input.closes, call.verdict, tones, hollow, added, unread))} width={OG_SIZE.w} height={OG_SIZE.h} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />

      {/* The mark, and whose feature this is. */}
      <div style={{ position: 'absolute', left: OG_CALL.pad, top: 40, width: W, display: 'flex' }}>
        <Lockup size={30} label={`${record.symbol} · DAILY CLOSES`} />
      </div>

      {/* The verdict leads: its tile, spec's word. */}
      <div style={{ position: 'absolute', left: OG_CALL.pad, top: 102, width: Q.w, height: 52, display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tileUri(44, call.verdict, added)} width={44} height={44} alt="" />
        <span style={{ color: INK, fontSize: 40, fontWeight: 600, letterSpacing: -1.2, whiteSpace: 'nowrap' }}>{`${sentenceCase(VERDICT_WORDS[call.verdict])}.`}</span>
        <span style={{ color: SOFT, fontFamily: MONO, fontSize: 14, letterSpacing: track(14), marginLeft: 6, whiteSpace: 'nowrap' }}>{`${call.stance === 'bull' ? 'BULL' : 'BEAR'} ${added ? 'POST' : 'CALL'} · ${fmtUtcDate(call.postedAt).toUpperCase()}`}</span>
      </div>

      {/* The post's own words: the picture's display line, upright. */}
      <div style={{ position: 'absolute', left: Q.x, top: Q.y, width: Q.w, height: Q.h, display: 'flex' }}>
        <div style={{ display: 'flex', width: 3, height: '100%', background: tone, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: 24, width: Q.w - 27, height: '100%', overflow: 'hidden' }}>
          <span style={{ color: INK, fontFamily: DISPLAY, fontWeight: 600, fontSize: fit.size, lineHeight: 1.14, letterSpacing: fit.size > 45 ? -1.2 : -0.6, textWrap: 'balance' }}>{`“${quote.text}”`}</span>
        </div>
      </div>

      {/* Who said it. */}
      <div style={{ position: 'absolute', left: OG_CALL.pad, top: 438, width: Q.w, display: 'flex', alignItems: 'center', gap: 14 }}>
        <Face uri={input.avatar} initial={initialOf(record.profile.name, record.handle)} size={50} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ color: INK, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {under && <span style={{ color: SOFT, fontSize: 16.5, marginTop: 1, whiteSpace: 'nowrap' }}>{under}</span>}
        </div>
        {added && <span style={{ display: 'flex', marginLeft: 6, padding: '2px 9px', border: '1px dashed rgba(255,255,255,0.4)', color: SOFT, fontSize: 13, whiteSpace: 'nowrap' }}>{ADDED_MARK}</span>}
      </div>

      {/* The proof: the day on the line, the price that day, what it did next. */}
      {plot ? (
        <span style={{ position: 'absolute', left: tagLeft, top: B.y - 34, width: 150, display: 'flex', justifyContent: tagRight ? 'flex-end' : 'flex-start', color: tone, fontFamily: MONO, fontSize: 12.5, letterSpacing: track(12.5), whiteSpace: 'nowrap' }}>{fmtUtcDate(call.postedAt).toUpperCase()}</span>
      ) : (
        <span style={{ position: 'absolute', left: B.x, top: B.y + 70, width: B.w, display: 'flex', color: MUTED, fontSize: 15, lineHeight: 1.4 }}>The chart did not answer just now. The call is judged on its daily closes.</span>
      )}
      {unread > 0.06 && plot && <span style={{ position: 'absolute', left: B.x + 2, top: B.y + B.h - 16, display: 'flex', padding: '1px 7px', background: BG, color: SOFT, fontFamily: MONO, fontSize: 10.5, letterSpacing: track(10.5) }}>NOT READ</span>}
      <div style={{ position: 'absolute', left: B.x, top: B.y + B.h + 28, width: B.w, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ color: INK, fontFamily: MONO, fontSize: 32, fontWeight: 600, letterSpacing: -0.6 }}>{fmtCallPrice(call.priceAt, unit)}</span>
          <span style={{ color: MUTED, fontFamily: MONO, fontSize: 12.5, letterSpacing: track(12.5) }}>THAT DAY</span>
        </div>
        <span style={{ display: 'flex', marginTop: 6, color: tone, fontFamily: MONO, fontSize: 19, fontWeight: 600, lineHeight: 1.22 }}>{judgedLine(call)}</span>
        {since && <span style={{ display: 'flex', marginTop: 2, color: SOFT, fontFamily: MONO, fontSize: 15.5 }}>{since}</span>}
      </div>

      {/* The record this call belongs to: the whole tally (the bar, then its words), the standing line, the address. */}
      <div style={{ position: 'absolute', left: OG_CALL.pad, top: OG_CALL.footY - 3, width: W, display: 'flex' }}>{parts ? <ScoreBar counts={parts.counts} width={W} height={6} /> : <div style={{ display: 'flex', width: W, height: 1, marginTop: 3, background: LINE }} />}</div>
      <div style={{ position: 'absolute', left: OG_CALL.pad, top: OG_CALL.footY + 16, width: W, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, height: 30 }}>
          <span style={{ color: MUTED, fontFamily: MONO, fontSize: 12.5, letterSpacing: track(12.5), whiteSpace: 'nowrap' }}>FULL RECORD</span>
          {parts ? (
            parts.counts.map((c) => (
              <div key={c.kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.kind !== 'total' && <div style={{ display: 'flex', width: 9, height: 9, background: TONE[c.kind as CallVerdict] }} />}
                <span style={{ color: c.kind === 'total' ? INK : SOFT, fontFamily: MONO, fontSize: 17.5, fontWeight: c.kind === 'total' ? 600 : 500, whiteSpace: 'nowrap' }}>{c.text}</span>
              </div>
            ))
          ) : (
            <span style={{ color: SOFT, fontSize: 19, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sentenceCase(headlineTally(record.words.headline))}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
          <span style={{ color: record.verified ? UP : SOFT, fontSize: 15.5, fontWeight: record.verified ? 600 : 500, whiteSpace: 'nowrap' }}>{record.words.standing}</span>
          <span style={{ color: VIOLET, fontFamily: MONO, fontSize: 14.5, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 520 }}>{address}</span>
        </div>
      </div>
    </div>
  )
}

/** Paint one card to the end (so a throw is the caller's to catch, never a broken stream). */
export async function renderCalledCard(input: CalledCardInput, address: string): Promise<ArrayBuffer> {
  const res = new ImageResponse(input.kind === 'call' && input.record && input.call ? <OneCallCard input={input} address={address} /> : <CalledCard input={input} address={address} />, {
    width: OG_SIZE.w,
    height: OG_SIZE.h,
    fonts: await brandOgFonts(),
  })
  return res.arrayBuffer()
}
