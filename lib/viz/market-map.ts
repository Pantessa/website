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
  /** 'volume' when ≥VOLUME_COVERAGE of the quoted cells had volume; 'equal' otherwise. */
  sizing: 'volume' | 'equal'
  /** Symbols listed but with no quote — drawn as flat cells, never dropped. */
  unquoted: string[]
  /** Quoted symbols no feed gave a volume for — sized at the median, named. */
  medianSized: string[]
}

export const CLAMP_PCT = 5

const SECTION_OF: Record<MapSection, MarketSectionId[]> = {
  stocks: ['equities'],
  crypto: ['crypto'],
  perps: ['perps'],
  all: ['equities', 'crypto', 'perps'],
}

/** Unquoted cells draw at this fraction of the smallest quoted cell — visible, never dominant. */
export const UNQUOTED_SCALE = 0.2

/** The share of quoted items that must carry a volume before cells size by it. */
export const VOLUME_COVERAGE = 0.9

/** Items for a section filter, joined with quotes. Weight = volume when at
 *  least VOLUME_COVERAGE of the quoted items carry a positive volume (an
 *  honest basis — the few without one take the MEDIAN and are named in
 *  `medianSized`), else 1 (equal cells). Unquoted symbols keep the median
 *  weight too, so they neither vanish nor dominate. */
export function mapItems(sections: readonly MarketSection[], quotes: Readonly<Record<string, MapQuote | undefined>>, filter: MapSection): { items: MapItem[]; sizing: 'volume' | 'equal'; unquoted: string[]; medianSized: string[] } {
  const ids = SECTION_OF[filter] ?? SECTION_OF.all
  const rows = sections.filter((s) => ids.includes(s.id)).flatMap((s) => s.rows.map((r) => ({ ...r, section: s.id })))
  const quoted = rows.filter((r) => quotes[r.symbol])
  const withVol = quoted.filter((r) => (quotes[r.symbol]?.volumeUsd ?? 0) > 0)
  const sizing: 'volume' | 'equal' = quoted.length > 0 && withVol.length >= Math.ceil(quoted.length * VOLUME_COVERAGE) ? 'volume' : 'equal'
  const vols = withVol.map((r) => quotes[r.symbol]!.volumeUsd as number).sort((a, b) => a - b)
  const median = vols.length ? vols[Math.floor(vols.length / 2)] : 1
  const unquoted: string[] = []
  const medianSized: string[] = []
  const items: MapItem[] = rows.map((r) => {
    const q = quotes[r.symbol]
    if (!q) unquoted.push(r.symbol)
    let weight = 1
    if (sizing === 'volume') {
      const v = q?.volumeUsd ?? 0
      if (v > 0) weight = v
      else if (q) {
        weight = median
        medianSized.push(r.symbol)
      }
    }
    // An UNQUOTED symbol (no feed answer) stays on the map — listed in the
    // foot, never dropped — but draws SMALL: a blank tile the size of a real
    // one reads as a broken chart (MKR/JUP on the 09-16 shot). One fifth of
    // the smallest quoted weight keeps it findable without stealing area.
    if (!q) weight = Math.max(1e-9, (sizing === 'volume' ? Math.min(...vols, median) : 1) * UNQUOTED_SCALE)
    return { symbol: r.symbol, name: r.name, section: r.section, last: q?.last ?? null, chgPct: q?.chgPct ?? null, weight: Math.max(weight, 1e-9) }
  })
  // The All map mixes volume bases (a stock's last NYSE session vs a coin's
  // 24h on Coinbase vs a perp's on Hyperliquid), so on 'all' each section is
  // normalised to the same average cell: within a section, size still follows
  // volume; across sections, a section's area is its share of the listing.
  // The foot says so. (The un-normalised cross-basis map is the alternative.)
  if (filter === 'all' && sizing === 'volume') normalizeBySection(items)
  return { items, sizing, unquoted, medianSized }
}

/** Scale each section's weights so its mean weight is 1 (mutates in place). */
export function normalizeBySection(items: MapItem[]): void {
  const sum = new Map<MarketSectionId, { total: number; n: number }>()
  for (const i of items) {
    const s = sum.get(i.section) ?? { total: 0, n: 0 }
    s.total += i.weight
    s.n += 1
    sum.set(i.section, s)
  }
  for (const i of items) {
    const s = sum.get(i.section)!
    const mean = s.total / s.n
    i.weight = mean > 0 ? i.weight / mean : 1
  }
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
  const { items, sizing, unquoted, medianSized } = mapItems(sections, quotes, filter)
  return { cells: squarify(items, width, height), sizing, unquoted, medianSized }
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
