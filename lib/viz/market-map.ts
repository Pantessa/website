// MARKET MAP — pure data shaping for the index treemap (VIZ lane). Client-
// safe, no I/O, pinned in the harness. Cells come from lib/markets
// marketSections (the symbols the resolver charts) joined with /api/quotes;
// size is HONEST: dollar volume where the feed gives it, else equal — the
// legend says which. Color is the 24h % change, clamped to ±CLAMP_PCT.

import type { MarketSection, MarketSectionId } from '@/lib/markets'

export type MapSection = 'stocks' | 'crypto' | 'perps' | 'all'

export interface MapQuote {
  last: number
  chgPct: number
  /** 24h dollar volume if the feed carries it. */
  volumeUsd?: number | null
}

export interface MapItem {
  symbol: string
  name: string
  section: MarketSectionId
  last: number | null
  chgPct: number | null
  /** The size basis actually used for this cell. */
  weight: number
}

export interface MapCell extends MapItem {
  x: number
  y: number
  w: number
  h: number
}

export interface MapLayout {
  cells: MapCell[]
  /** 'volume' when every sized cell had volume; 'equal' otherwise. */
  sizing: 'volume' | 'equal'
  /** Symbols listed but with no quote — drawn as flat cells, never dropped. */
  unquoted: string[]
}

export const CLAMP_PCT = 5

const SECTION_OF: Record<MapSection, MarketSectionId[]> = {
  stocks: ['equities'],
  crypto: ['crypto'],
  perps: ['perps'],
  all: ['equities', 'crypto', 'perps'],
}

/** Items for a section filter, joined with quotes. Weight = volume when EVERY
 *  quoted item has a positive volume (an honest basis), else 1 (equal cells).
 *  Unquoted symbols keep weight = the median so they neither vanish nor dominate. */
export function mapItems(sections: readonly MarketSection[], quotes: Readonly<Record<string, MapQuote | undefined>>, filter: MapSection): { items: MapItem[]; sizing: 'volume' | 'equal'; unquoted: string[] } {
  const ids = SECTION_OF[filter] ?? SECTION_OF.all
  const rows = sections.filter((s) => ids.includes(s.id)).flatMap((s) => s.rows.map((r) => ({ ...r, section: s.id })))
  const quoted = rows.filter((r) => quotes[r.symbol])
  const allHaveVolume = quoted.length > 0 && quoted.every((r) => (quotes[r.symbol]?.volumeUsd ?? 0) > 0)
  const sizing: 'volume' | 'equal' = allHaveVolume ? 'volume' : 'equal'
  const vols = quoted.map((r) => quotes[r.symbol]!.volumeUsd ?? 0).filter((v) => v > 0).sort((a, b) => a - b)
  const median = vols.length ? vols[Math.floor(vols.length / 2)] : 1
  const unquoted: string[] = []
  const items: MapItem[] = rows.map((r) => {
    const q = quotes[r.symbol]
    if (!q) unquoted.push(r.symbol)
    const weight = sizing === 'volume' ? (q ? q.volumeUsd! : median) : 1
    return { symbol: r.symbol, name: r.name, section: r.section, last: q?.last ?? null, chgPct: q?.chgPct ?? null, weight: Math.max(weight, 1e-9) }
  })
  return { items, sizing, unquoted }
}

/** Squarified treemap (Bruls et al.) — rows of near-square cells, largest
 *  first. Deterministic for a given input order. */
export function squarify(items: readonly MapItem[], width: number, height: number, gap = 2): MapCell[] {
  const sorted = [...items].sort((a, b) => b.weight - a.weight)
  const total = sorted.reduce((a, i) => a + i.weight, 0)
  if (!sorted.length || total <= 0 || width <= 0 || height <= 0) return []
  const area = width * height
  const scaled = sorted.map((i) => ({ item: i, a: (i.weight / total) * area }))
  const out: MapCell[] = []
  let x = 0
  let y = 0
  let w = width
  let h = height
  let row: { item: MapItem; a: number }[] = []
  const worst = (r: typeof row, side: number) => {
    const s = r.reduce((a, c) => a + c.a, 0)
    if (!s) return Infinity
    let mx = 0
    let mn = Infinity
    for (const c of r) {
      if (c.a > mx) mx = c.a
      if (c.a < mn) mn = c.a
    }
    const s2 = s * s
    return Math.max((side * side * mx) / s2, s2 / (side * side * mn))
  }
  const layoutRow = (r: typeof row) => {
    const s = r.reduce((a, c) => a + c.a, 0)
    const horizontal = w >= h // lay the row along the shorter side
    if (horizontal) {
      const rw = s / h
      let cy = y
      for (const c of r) {
        const ch = c.a / rw
        out.push(cellOf(c.item, x, cy, rw, ch, gap))
        cy += ch
      }
      x += rw
      w -= rw
    } else {
      const rh = s / w
      let cx = x
      for (const c of r) {
        const cw = c.a / rh
        out.push(cellOf(c.item, cx, y, cw, rh, gap))
        cx += cw
      }
      y += rh
      h -= rh
    }
  }
  for (const c of scaled) {
    const side = Math.min(w, h)
    if (row.length && worst([...row, c], side) > worst(row, side)) {
      layoutRow(row)
      row = []
    }
    row.push(c)
  }
  if (row.length) layoutRow(row)
  return out
}

function cellOf(item: MapItem, x: number, y: number, w: number, h: number, gap: number): MapCell {
  const g = Math.min(gap, w / 4, h / 4)
  return { ...item, x: x + g / 2, y: y + g / 2, w: Math.max(0, w - g), h: Math.max(0, h - g) }
}

export function marketMapLayout(sections: readonly MarketSection[], quotes: Readonly<Record<string, MapQuote | undefined>>, filter: MapSection, width: number, height: number): MapLayout {
  const { items, sizing, unquoted } = mapItems(sections, quotes, filter)
  return { cells: squarify(items, width, height), sizing, unquoted }
}

/** -1..1 polarity for the diverging fill: chgPct clamped to ±CLAMP_PCT. */
export function polarity(chgPct: number | null): number {
  if (chgPct == null || !Number.isFinite(chgPct)) return 0
  return Math.max(-1, Math.min(1, chgPct / CLAMP_PCT))
}

/** The cell fill: a diverging mix of the up/down tokens toward the surface
 *  at the neutral midpoint (never a hue at zero). Returns a CSS color-mix. */
export function cellFill(chgPct: number | null): string {
  const p = polarity(chgPct)
  if (p === 0) return 'var(--mk-surface-2)'
  const pct = Math.round(18 + Math.abs(p) * 72) // 18%..90% of the tone
  return `color-mix(in oklch, var(${p > 0 ? '--mk-up' : '--mk-down'}) ${pct}%, var(--mk-surface-2))`
}

/** Which text size fits a cell (0 = none). */
export function labelTier(w: number, h: number): 0 | 1 | 2 {
  if (w < 34 || h < 18) return 0
  if (w < 64 || h < 34) return 1
  return 2
}
