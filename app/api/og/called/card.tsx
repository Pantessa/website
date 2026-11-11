import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'
import { VERDICT_WORDS, moveLine, pickCalls, type CalledCall, type CalledRecord, type CallVerdict } from '@/lib/called-it/spec'
import {
  OG_COLUMN,
  OG_MAX_CARDS,
  OG_PANEL,
  OG_SIZE,
  clampPostWidth,
  cleanLine,
  fmtCallPrice,
  fmtUtcDate,
  headlineParts,
  headlineTally,
  initialOf,
  linePaths,
  ogLayout,
  plotScale,
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
// A post's words reach the picture as TEXT (a React string the renderer
// draws), clamped for the small card and never reworded; nothing from a post
// is ever placed in the SVG below, which is built from numbers alone. The
// avatar is a data URI the server fetched from X's own image host, or the
// account's initial.

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const SOFT = '#b8bfb5'
const ACCENT = '#34e3a0'
const DOWN = '#ff5d5d'
const GOLD = '#f0b454'
const FLAT = '#a2a99f'
const CARD_BG = '#0d1211'
const LINE = 'rgba(255,255,255,0.12)'
const TONE: Record<CallVerdict, string> = { right: ACCENT, wrong: DOWN, flat: FLAT, open: GOLD }
const TONE_RGB: Record<CallVerdict, string> = { right: '52,227,160', wrong: '255,93,93', flat: '162,169,159', open: '240,180,84' }

/** A post card's two lines, in lowercase-letter widths (card-layout textUnits): 328px of 17.5px Geist, less a word's worth of ragged edge. */
const CARD_TEXT_UNITS = 62

const MARK = gemMarkSvg(ACCENT)
const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// ── Fonts (once per process) ────────────────────────────────────────────

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

// ── What a card is drawn from ───────────────────────────────────────────

export type CalledCardKind = 'record' | 'empty' | 'unscanned' | 'scanning' | 'refused' | 'handle' | 'generic'

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
}

/** The calls that get a post card: the plot's pins, the best hit and the worst miss first, then by impact (spec pickCalls). */
export function cardedCalls(record: CalledRecord): CalledCall[] {
  const picked = record.calls.filter((c) => c.picked)
  const ids = new Set(pickCalls(picked, { max: OG_MAX_CARDS }))
  return picked.filter((c) => ids.has(c.postId))
}

// ── The exhibit's drawing (numbers only) ────────────────────────────────

function exhibitSvg(layout: OgLayout, scale: PlotScale | null, closes: readonly ClosePoint[], tones: Map<string, CallVerdict>): string {
  const { panel: P, band } = layout
  const parts: string[] = [`<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="22" fill="rgba(255,255,255,0.028)" stroke="rgba(255,255,255,0.11)" stroke-width="1.5"/>`]
  if (scale) {
    const { line, area } = linePaths(closes, scale, band)
    parts.push(
      `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity="0.13"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient></defs>`,
      `<path d="${area}" fill="url(#a)"/>`,
      `<path d="${line}" fill="none" stroke="${INK}" stroke-opacity="0.9" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`,
    )
  }
  const toneOf = (id: string) => TONE[tones.get(id) ?? 'flat']
  for (const c of layout.cards) parts.push(`<line x1="${c.attach.x}" y1="${c.attach.y}" x2="${c.anchor.x}" y2="${c.anchor.y}" stroke="${toneOf(c.id)}" stroke-width="2" stroke-linecap="round" stroke-opacity="0.9"/>`)
  for (const d of layout.dots.filter((x) => !x.carded)) parts.push(`<circle cx="${d.x}" cy="${d.y}" r="4.5" fill="${toneOf(d.id)}" stroke="${BG}" stroke-width="2"/>`)
  for (const d of layout.dots.filter((x) => x.carded)) parts.push(`<circle cx="${d.x}" cy="${d.y}" r="12" fill="${toneOf(d.id)}" fill-opacity="0.22"/><circle cx="${d.x}" cy="${d.y}" r="6.5" fill="${toneOf(d.id)}" stroke="${BG}" stroke-width="2.5"/>`)
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
  const ghost = (i: number, top: boolean) => {
    const [x, y] = at(i)
    const cx = Math.min(Math.max(x - 120, P.x + 24), P.x + P.w - 264)
    const cy = top ? P.y + 30 : P.y + P.h - 30 - 92
    return `<rect x="${cx}" y="${cy}" width="240" height="92" rx="14" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" stroke-dasharray="6 7"/><line x1="${x}" y1="${top ? cy + 92 : cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-dasharray="3 5"/><circle cx="${x}" cy="${y}" r="5.5" fill="${ACCENT}" stroke="${BG}" stroke-width="2.5"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_SIZE.w}" height="${OG_SIZE.h}" viewBox="0 0 ${OG_SIZE.w} ${OG_SIZE.h}"><rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="22" fill="rgba(255,255,255,0.028)" stroke="rgba(255,255,255,0.11)" stroke-width="1.5"/><path d="M${pts.join('L')}" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>${ghost(12, true)}${ghost(31, false)}${ghost(49, true)}</svg>`
}

// ── Pieces ──────────────────────────────────────────────────────────────

function Face({ uri, initial, size }: { uri: string | null; initial: string; size: number }) {
  if (uri) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={uri} width={size} height={size} alt="" style={{ borderRadius: size / 2, objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: size / 2, background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.16)', color: INK, fontFamily: 'Newsreader', fontSize: Math.round(size * 0.52), flexShrink: 0 }}>
      {initial}
    </div>
  )
}

function PostCard({ box, call, name, handle, avatar, initial }: { box: OgCardBox; call: CalledCall; name: string; handle: string; avatar: string | null; initial: string }) {
  const tone = TONE[call.verdict]
  const rgb = TONE_RGB[call.verdict]
  const head = (
    <div key="head" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 14px', marginTop: box.row === 'top' ? 10 : 8 }}>
      <Face uri={avatar} initial={initial} size={26} />
      <span style={{ color: INK, fontSize: 15, fontWeight: 600, maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</span>
      <span style={{ color: MUTED, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{`@${handle}`}</span>
      <span style={{ color: MUTED, fontSize: 12.5, marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtUtcDate(call.postedAt)}</span>
    </div>
  )
  const text = (
    <div key="text" style={{ display: 'flex', padding: '0 14px', marginTop: 6, height: 48, overflow: 'hidden', color: INK, fontSize: 17.5, lineHeight: 1.34 }}>
      <span>{clampPostWidth(call.text, CARD_TEXT_UNITS)}</span>
    </div>
  )
  // The stamp sits on the card's band-side edge, where its leader leaves.
  const stamp = (
    <div key="stamp" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 30, padding: '0 14px', background: `rgba(${rgb},0.15)`, ...(box.row === 'top' ? { marginTop: 'auto', borderTop: `1.5px solid rgba(${rgb},0.5)` } : { borderBottom: `1.5px solid rgba(${rgb},0.5)` }) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: tone, fontSize: 15.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{VERDICT_WORDS[call.verdict]}</span>
        <span style={{ display: 'flex', padding: '1px 7px', borderRadius: 999, border: `1px solid rgba(${rgb},0.55)`, color: tone, fontSize: 10.5, letterSpacing: 1.6 }}>{call.stance === 'bull' ? 'BULL' : 'BEAR'}</span>
      </div>
      <span style={{ color: tone, fontSize: 14.5, whiteSpace: 'nowrap' }}>{moveLine(call)}</span>
    </div>
  )
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', flexDirection: 'column', borderRadius: 14, background: CARD_BG, border: `1.5px solid rgba(${rgb},0.42)`, overflow: 'hidden' }}>
      {/* An array, not a fragment: the image renderer lays a fragment out as a row of its own. */}
      {box.row === 'top' ? [head, text, stamp] : [stamp, head, text]}
    </div>
  )
}

/** Spec's words, standing alone as a sentence: the same words with a capital to open them. */
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  const marketSize = market.length <= 8 ? 54 : market.length <= 15 ? 42 : market.length <= 22 ? 32 : 25
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(MARK)} width={34} height={34} alt="" />
        <span style={{ color: INK, fontSize: 26, fontWeight: 600, letterSpacing: -1 }}>pantessa</span>
        <span style={{ color: ACCENT, fontSize: 13, letterSpacing: 4, marginLeft: 'auto' }}>CALLED IT</span>
      </div>

      {handle ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 30 }}>
          <Face uri={input.avatar} initial={initialOf(record?.profile.name, handle)} size={60} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ color: INK, fontSize: 23, fontWeight: 600, letterSpacing: -0.4, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            {!bare && <span style={{ color: SOFT, fontSize: 18, marginTop: 2, whiteSpace: 'nowrap' }}>{`@${handle}`}</span>}
          </div>
        </div>
      ) : (
        <span style={{ display: 'flex', marginTop: 40, color: INK, fontFamily: 'Newsreader', fontSize: 64, letterSpacing: -2, lineHeight: 1 }}>Whose calls?</span>
      )}

      {market && handle && <span style={{ display: 'flex', marginTop: 16, color: INK, fontFamily: 'Newsreader', fontStyle: 'italic', fontSize: marketSize, letterSpacing: -1, lineHeight: 1.05, whiteSpace: 'nowrap' }}>{market}</span>}
      {record && <span style={{ display: 'flex', marginTop: 10, color: MUTED, fontSize: 12.5, letterSpacing: 2.2, whiteSpace: 'nowrap' }}>{`DAILY CLOSES \u00b7 NOW ${fmtCallPrice(record.priceNow, input.unit ?? 'usd')}`}</span>}

      {record && parts && (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 20 }}>
          {total && <span style={{ color: SOFT, fontSize: 15, letterSpacing: 3 }}>{total.toUpperCase()}</span>}
          {counts.map((c, i) => (
            <span key={c.kind} style={{ color: TONE[c.kind as CallVerdict], fontSize: i < 2 ? 41 : 21, fontWeight: 600, letterSpacing: i < 2 ? -1.4 : -0.2, lineHeight: 1.16, marginTop: i === 0 ? 4 : i === 2 ? 8 : 0, whiteSpace: 'nowrap' }}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      {record && !parts && <span style={{ display: 'flex', marginTop: 22, color: INK, fontSize: 25, lineHeight: 1.25 }}>{sentenceCase(headlineTally(record.words.headline))}</span>}
      {message && <span style={{ display: 'flex', marginTop: 24, color: kind === 'generic' || kind === 'handle' ? SOFT : INK, fontSize: kind === 'refused' ? 21 : 23, lineHeight: 1.3 }}>{message}</span>}

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
        {record && <span style={{ color: record.verified ? ACCENT : MUTED, fontSize: 14.5, fontWeight: record.verified ? 600 : 500, lineHeight: 1.35 }}>{record.words.standing}</span>}
        <span style={{ color: ACCENT, fontSize: 14.5, marginTop: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: C.w }}>{address}</span>
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
  const svg = schematic ? schematicSvg() : exhibitSvg(layout, scale, closes, tones)
  const name = record ? cleanLine(record.profile.name.trim() && record.profile.name.trim().toLowerCase() !== record.handle ? record.profile.name : `@${record.handle}`, 20) : ''
  const initial = record ? initialOf(record.profile.name, record.handle) : ''
  const note = input.kind === 'empty' ? 'No calls found in this window' : input.kind === 'unscanned' ? 'No pins yet' : input.kind === 'scanning' ? 'Pins land when the scan is done' : null
  const B = layout.band
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
      <div style={{ position: 'absolute', left: -180, top: -120, width: 700, height: 560, borderRadius: 350, background: 'radial-gradient(circle, rgba(52,227,160,0.10) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={toDataUri(svg)} width={OG_SIZE.w} height={OG_SIZE.h} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />

      {!schematic && closes.length > 1 && (
        <div style={{ position: 'absolute', left: B.x, top: B.y + B.h + 5, width: B.w, display: 'flex', justifyContent: 'space-between', color: MUTED, fontSize: 12, letterSpacing: 1.2 }}>
          <span>{fmtUtcDate(closes[0].t * 1000).toUpperCase()}</span>
          <span>{fmtUtcDate(closes[closes.length - 1].t * 1000).toUpperCase()}</span>
        </div>
      )}
      {note && !schematic && (
        <div style={{ position: 'absolute', left: OG_PANEL.x, top: OG_PANEL.y + 26, width: OG_PANEL.w, display: 'flex', justifyContent: 'center' }}>
          <span style={{ display: 'flex', padding: '8px 18px', borderRadius: 999, border: `1.5px solid ${LINE}`, background: 'rgba(5,7,8,0.7)', color: SOFT, fontSize: 15, letterSpacing: 2.4 }}>{note.toUpperCase()}</span>
        </div>
      )}

      {record &&
        layout.cards.map((box) => {
          const call = byId.get(box.id)
          return call ? <PostCard key={box.id} box={box} call={call} name={name} handle={record.handle} avatar={input.avatar} initial={initial} /> : null
        })}

      <Scoreboard input={input} address={address} />
    </div>
  )
}

/** Paint one card to the end (so a throw is the caller's to catch, never a broken stream). */
export async function renderCalledCard(input: CalledCardInput, address: string): Promise<ArrayBuffer> {
  const [serif, serifItalic, sans, sansSemi] = await fonts()
  const res = new ImageResponse(<CalledCard input={input} address={address} />, {
    width: OG_SIZE.w,
    height: OG_SIZE.h,
    fonts: [
      { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
      { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
      { name: 'Geist', data: sans, weight: 500, style: 'normal' },
      { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
    ],
  })
  return res.arrayBuffer()
}
