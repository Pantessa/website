import type { CSSProperties, ReactNode } from 'react'
import { OG_DISPLAY, OG_MONO, ogTrack } from '@/lib/og-brand-fonts'

// THE LOOK OF A LINK CARD, in one place (2026-11-25; brand guidelines section
// 7, first drawn on the Called it card and the trade-link card by squad
// mobile-sleek). Every Open Graph card on the site is built from these pieces,
// so two Pantessa links side by side on a timeline read as one family:
//
//   - the ground is #07080D edge to edge, and everything on it is flat: no
//     gradient, glow, shadow, rounded corner or pill;
//   - the Cut P wears its own magenta and violet beside the wordmark;
//   - ONE display line, upright (lib/og-brand-fonts `Display`);
//   - labels are spaced capitals and numbers are set in the mono role;
//   - the accent is the brand violet. Green and red are the market's: a price
//     that moved, a bid and an ask. Never decoration.
//
// The renderer has no CSS variables, so the palette is spelled here. A
// creator's white-label card (/l, /i) passes its own inks to the same pieces.

export const OG = {
  bg: '#07080D',
  ink: '#FFFFFF',
  inkRgb: '255,255,255',
  muted: '#7C8499',
  soft: '#B4BAC8',
  violet: '#9F7AFF',
  up: '#2AF598',
  down: '#FF3B47',
  /** A hairline on the ground. */
  line: 'rgba(255,255,255,0.14)',
  /** A quieter rule between rows. */
  rule: 'rgba(255,255,255,0.08)',
  /** A panel's own flat ground, one step off the card's. */
  panel: '#0C0E15',
} as const

export const OG_SIZE = { width: 1200, height: 630 } as const

/**
 * Tile colours (brand guidelines section 3, the sweep), [lit, shade]. They are
 * decoration and carry an app's mark; they never mean a price went up or down,
 * so the teal and the cyan are left out of a card that prints prices.
 */
export const OG_TILES = [
  ['#5B8CFF', '#2A52D8'],
  ['#9466FF', '#5A31CC'],
  ['#FF48C4', '#BD1C8E'],
  ['#FF5C93', '#C72A62'],
] as const

/**
 * An app tile (brand guidelines section 5): the square with its top-left and
 * bottom-right corners cut, the lit tone above the diagonal and the shade
 * below it, meeting with no gap. The app's mark is laid over it in the ground
 * colour by the card. Built from numbers alone.
 */
export function ogAppTileSvg(size: number, tones: readonly [string, string]): string {
  const s = size
  const c = Math.round(s * 0.222 * 100) / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><path d="M ${c} 0 L ${s} 0 L 0 ${s} L 0 ${c} Z" fill="${tones[0]}"/><path d="M ${s} 0 L ${s} ${s - c} L ${s - c} ${s} L 0 ${s} Z" fill="${tones[1]}"/></svg>`
}

export const ogDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** A flat mix of hex `a` toward hex `b` (the renderer has no color-mix, and a see-through fill is not a flat one). */
export function ogMix(a: string, b: string, t: number): string {
  const part = (h: string, i: number) => parseInt(h.slice(1 + i, 3 + i), 16)
  return `#${[0, 2, 4].map((i) => Math.round(part(a, i) * (1 - t) + part(b, i) * t).toString(16).padStart(2, '0')).join('')}`
}

/** A label: mono capitals, 0.12em. The caller upper-cases its own words. */
export const ogLabel = (size: number, color: string = OG.muted): CSSProperties => ({ fontFamily: OG_MONO, fontSize: size, letterSpacing: ogTrack(size), color, whiteSpace: 'nowrap' })

/** A number: the mono role, no tracking. */
export const ogNum = (size: number, color: string = OG.ink, weight: 500 | 600 = 600): CSSProperties => ({ fontFamily: OG_MONO, fontSize: size, fontWeight: weight, color, whiteSpace: 'nowrap' })

/** The display line: upright, weight 600, the brand's −0.015em. */
export const ogDisplay = (size: number, color: string = OG.ink): CSSProperties => ({ fontFamily: OG_DISPLAY, fontWeight: 600, fontSize: size, letterSpacing: Math.round(size * -0.015 * 10) / 10, lineHeight: 1.06, color })

/** The card's own frame: the flat ground, Geist as the text face. */
export function OgFrame({ bg = OG.bg, children }: { bg?: string; children: ReactNode }) {
  return <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: bg, fontFamily: 'Geist' }}>{children}</div>
}

/** A flat square: the bullet of a label and of a chip. */
export function OgSquare({ size = 8, color = OG.violet }: { size?: number; color?: string }) {
  return <div style={{ display: 'flex', width: size, height: size, background: color, flexShrink: 0 }} />
}

/**
 * The lockup: the Cut P and the wordmark, and the word that names the page
 * beside them. `mark` is the card's own read of lib/og-marks `gemMarkSvg` (the
 * bare mark: no plate), so the one source of the mark stays visible in every
 * card's file.
 */
export function OgLockup({ mark, size = 46, tag, ink = OG.ink, muted = OG.muted }: { mark: string; size?: number; tag?: string; ink?: string; muted?: string }) {
  const word = Math.round(size * 0.78)
  const tagSize = Math.max(13, Math.round(size * 0.34))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.3) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={ogDataUri(mark)} width={size} height={size} alt="" />
      <span style={{ color: ink, fontFamily: OG_DISPLAY, fontSize: word, fontWeight: 600, letterSpacing: Math.round(word * -0.022 * 10) / 10, lineHeight: 1 }}>pantessa</span>
      {tag && <span style={{ ...ogLabel(tagSize, muted), marginLeft: Math.round(size * 0.2), marginTop: Math.round(size * 0.1) }}>{tag}</span>}
    </div>
  )
}

/** The words that say what the card is: a square, then spaced capitals. */
export function OgEyebrow({ children, size = 16, color = OG.muted, square = OG.violet }: { children: ReactNode; size?: number; color?: string; square?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...ogLabel(size, color) }}>
      {square && <OgSquare color={square} />}
      <span>{children}</span>
    </div>
  )
}

/** Several short labels on one line, a middle dot between them. */
export function OgWords({ words, size = 15, color = OG.muted, dot = OG.violet }: { words: readonly string[]; size?: number; color?: string; dot?: string }) {
  return (
    <div style={{ display: 'flex', ...ogLabel(size, color) }}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} style={{ display: 'flex' }}>
          {i > 0 && <span style={{ color: dot, margin: `0 ${Math.round(size * 0.6)}px` }}>·</span>}
          <span>{w}</span>
        </span>
      ))}
    </div>
  )
}

export interface OgChip {
  label: string
  /** The chip's own ink (its border and bullet take it too). Omit for the card's ink. */
  tone?: string
  /** No bullet. */
  plain?: boolean
}

/**
 * The foot's facts: flat boxes that share their edges (never pills), each a
 * square and a label. `inkRgb` and `accent` re-ink them on a white-label card.
 */
export function OgChips({ chips, size = 16, ink = OG.ink, inkRgb = OG.inkRgb, accent = OG.violet, strong = false }: { chips: readonly (string | OgChip)[]; size?: number; ink?: string; inkRgb?: string; accent?: string; strong?: boolean }) {
  const pad = `${Math.round(size * 0.7)}px ${Math.round(size * 1.1)}px`
  return (
    <div style={{ display: 'flex' }}>
      {chips.map((c, i) => {
        const chip: OgChip = typeof c === 'string' ? { label: c } : c
        return (
          <div key={chip.label} style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.6), padding: pad, marginLeft: i === 0 ? 0 : -1.5, border: `1.5px solid ${chip.tone ?? `rgba(${inkRgb},${strong ? 0.28 : 0.18})`}`, ...ogLabel(size, chip.tone ?? ink) }}>
            {!chip.plain && <OgSquare size={Math.round(size * 0.5)} color={chip.tone ?? accent} />}
            <span>{chip.label.toUpperCase()}</span>
          </div>
        )
      })}
    </div>
  )
}

/** A row of figures: each a number in the mono role over its label, in flat boxes that share their edges. */
export function OgStats({ stats }: { stats: readonly { v: string; k: string }[] }) {
  return (
    <div style={{ display: 'flex' }}>
      {stats.map((t, i) => (
        <div key={t.k} style={{ display: 'flex', flexDirection: 'column', padding: '14px 24px', minWidth: 156, marginLeft: i === 0 ? 0 : -1.5, border: `1.5px solid rgba(${OG.inkRgb},0.18)` }}>
          <span style={{ ...ogNum(30), letterSpacing: -0.5 }}>{t.v}</span>
          <span style={{ ...ogLabel(13), marginTop: 6 }}>{t.k.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

/** A panel: a hairline box on its own flat ground. Square corners. */
export function OgPanel({ left, top, width, height, children }: { left: number; top: number; width: number; height: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', left, top, width, height, display: 'flex', flexDirection: 'column', border: `1px solid ${OG.line}`, background: OG.panel, overflow: 'hidden' }}>{children}</div>
}

/** A panel's head: its title left, its state right, a rule under both. */
export function OgPanelHead({ title, note, live = false }: { title: string; note: string; live?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', borderBottom: `1px solid ${OG.line}` }}>
      <span style={{ ...ogLabel(13.5, OG.ink), fontWeight: 600 }}>{title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...ogLabel(12, live ? OG.soft : OG.muted) }}>
        <OgSquare size={7} color={live ? OG.violet : OG.muted} />
        <span>{note}</span>
      </div>
    </div>
  )
}

/** A price's move: the arrow is the sign, the colour is the market's. */
export function OgMove({ pct, text, size = 14, width }: { pct: number | null; text?: string; size?: number; width?: number }) {
  const box: CSSProperties = width ? { width, justifyContent: 'flex-end' } : {}
  if (pct == null) return <span style={{ display: 'flex', ...ogNum(size, OG.muted, 500), ...box }}>—</span>
  const up = pct >= 0
  return <span style={{ display: 'flex', ...ogNum(size, up ? OG.up : OG.down), ...box }}>{`${up ? '▲' : '▼'} ${text ?? `${Math.abs(pct).toFixed(2)}%`}`}</span>
}
