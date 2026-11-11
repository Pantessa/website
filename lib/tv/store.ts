// What the Advanced chart keeps on this browser. Client-only; every touch of
// localStorage is fenced (private mode, a thumbnail capture) and the chart
// draws fine with nothing stored. `layoutForChart` is pure and pinned.
//
// ONE layout for every market: the library's own saved state. It holds the
// indicators, the chart type and the scales (set up once, there on every
// symbol) AND every drawing, each bound by the library to the symbol it was
// drawn on, so UNI's levels show on UNI and nowhere else. Nothing of ours is
// stored beside it except a per-symbol mark that the drawings made on the
// built-in chart have been moved over (they are moved once).

const LAYOUT_KEY = 'pantessa.tv.layout.v1'
const MOVED_KEY = (symbol: string) => `pantessa.tv.moved.v1:${symbol.toUpperCase()}`
/** A layout bigger than this is not written (a browser's quota is shared with everything else). */
export const TV_LAYOUT_MAX_BYTES = 1_500_000

/**
 * A saved layout, opened on THIS page's symbol and frame. The layout
 * remembers the market and the interval it was saved on; the page decides
 * both, so they are written into the copy before the library reads it (one
 * history load, not a load of the old market and then a switch). Anything
 * that does not look like a layout comes back as null. Pure.
 */
export function layoutForChart(layout: unknown, symbol: string, resolution: string): object | null {
  if (typeof layout !== 'object' || layout === null) return null
  let copy: { charts?: unknown }
  try {
    copy = JSON.parse(JSON.stringify(layout)) as { charts?: unknown }
  } catch {
    return null
  }
  if (!Array.isArray(copy.charts) || copy.charts.length === 0) return null
  let aimed = false
  for (const chart of copy.charts as { panes?: unknown }[]) {
    if (!chart || !Array.isArray(chart.panes)) continue
    for (const pane of chart.panes as { sources?: unknown }[]) {
      if (!pane || !Array.isArray(pane.sources)) continue
      for (const source of pane.sources as { type?: unknown; state?: Record<string, unknown> }[]) {
        if (source?.type !== 'MainSeries' || typeof source.state !== 'object' || source.state === null) continue
        source.state.symbol = symbol
        source.state.shortName = symbol
        source.state.interval = resolution
        aimed = true
      }
    }
  }
  return aimed ? copy : null
}

export function readStoredLayout(): object | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredLayout(state: object): void {
  try {
    const text = JSON.stringify(state)
    if (text.length <= TV_LAYOUT_MAX_BYTES) window.localStorage.setItem(LAYOUT_KEY, text)
  } catch {
    /* nothing to keep */
  }
}

export function clearStoredLayout(): void {
  try {
    window.localStorage.removeItem(LAYOUT_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** Have the built-in chart's drawings for this symbol been moved over already? */
export function legacyMoved(symbol: string): boolean {
  try {
    return window.localStorage.getItem(MOVED_KEY(symbol)) !== null
  } catch {
    return true
  }
}

export function markLegacyMoved(symbol: string): void {
  try {
    window.localStorage.setItem(MOVED_KEY(symbol), '1')
  } catch {
    /* they may be moved again next time: harmless */
  }
}

// ── Drawings that arrived from outside (a forked post, the AI's levels) ──
// They are drawn onto the chart once and then live in the layout like any
// other drawing. Without a mark, the same fork link would draw them again on
// every reload. The mark is a short hash of the state that was applied.

const APPLIED_KEY = (symbol: string) => `pantessa.tv.applied.v1:${symbol.toUpperCase()}`
const APPLIED_KEEP = 24

/** A short, stable fingerprint of a string (FNV-1a, base 36). Pure. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(36)}${text.length.toString(36)}`
}

export function externalApplied(symbol: string, stateKey: string): boolean {
  try {
    const raw = window.localStorage.getItem(APPLIED_KEY(symbol))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) && list.includes(fingerprint(stateKey))
  } catch {
    return false
  }
}

export function markExternalApplied(symbol: string, stateKey: string): void {
  try {
    const raw = window.localStorage.getItem(APPLIED_KEY(symbol))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    const fp = fingerprint(stateKey)
    if (!list.includes(fp)) window.localStorage.setItem(APPLIED_KEY(symbol), JSON.stringify([...list, fp].slice(-APPLIED_KEEP)))
  } catch {
    /* it may be drawn again next time */
  }
}
