// The splash bento — pure, client-safe. Decides which tile is the hero and
// how wide each MCP's card is, so the grid packs without holes.
//
// Why a planner instead of CSS alone: the old uniform grid equalized every
// row to its tallest card, so a two-row Aave position sat in a card 80%
// empty beside the briefing. Natural heights need widths that fill rows:
// a 12-column grid, "wide" cards at 6, "narrow" at 4, wides first in pairs,
// narrows in triples, and the leftovers stretched so no row ends short.

import type { SplashTile } from './types'

export type CardSpan = 4 | 6 | 8 | 12

export interface PlannedCard {
  /** The MCP's tiles, first-seen order (one card per MCP). */
  group: SplashTile[]
  span: CardSpan
}

export interface SplashLayout {
  /** The wallet briefing, rendered as the hero band (null → no hero). */
  hero: SplashTile | null
  cards: PlannedCard[]
}

/** Group tiles by their MCP, preserving first-seen order. */
export function groupBySlug(tiles: SplashTile[]): SplashTile[][] {
  const bySlug = new Map<string, SplashTile[]>()
  for (const t of tiles) {
    const arr = bySlug.get(t.mcpSlug) ?? []
    arr.push(t)
    bySlug.set(t.mcpSlug, arr)
  }
  return [...bySlug.values()]
}

/** Cards that carry a distribution or a list of things (holdings, NFTs,
 *  positions, proposals, transactions) read better wide. */
export function wantsWide(group: SplashTile[]): boolean {
  return group.some(
    (t) =>
      t.render === 'holdings' ||
      t.render === 'nfts' ||
      t.render === 'proposals' ||
      t.render === 'activity' ||
      t.viz?.kind === 'positions' ||
      t.viz?.kind === 'allocation' ||
      (t.render === 'rows' && t.rows.length >= 5),
  )
}

/**
 * Pack widths so every row of the 12-column grid is full: wides (6) in
 * pairs, narrows (4) in triples, the odd wide widened to 8 and paired with a
 * narrow, a trailing pair of narrows split 6/6, a lone trailing narrow
 * stretched to 12.
 */
export function planSpans(wide: number, narrow: number): CardSpan[] {
  const spans: CardSpan[] = []
  let w = wide
  let n = narrow
  while (w >= 2) {
    spans.push(6, 6)
    w -= 2
  }
  if (w === 1) {
    if (n >= 1) {
      spans.push(8, 4)
      n -= 1
    } else {
      spans.push(12)
    }
  }
  while (n >= 3) {
    spans.push(4, 4, 4)
    n -= 3
  }
  if (n === 2) spans.push(6, 6)
  else if (n === 1) spans.push(12)
  return spans
}

export function planLayout(tiles: SplashTile[], { hero = true }: { hero?: boolean } = {}): SplashLayout {
  const heroTile = hero ? tiles.find((t) => t.id === 'briefing') ?? null : null
  const groups = groupBySlug(tiles.filter((t) => t !== heroTile))
  const wides = groups.filter((g) => wantsWide(g))
  const narrows = groups.filter((g) => !wantsWide(g))
  const spans = planSpans(wides.length, narrows.length)
  // Spans were planned wides-first, then narrows — assign in that order.
  const ordered = [...wides, ...narrows]
  return {
    hero: heroTile,
    cards: ordered.map((group, i) => ({ group, span: spans[i] ?? 4 })),
  }
}
