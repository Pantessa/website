// The splash board — pure, client-safe. Decides which tile is the hero and
// the ORDER of the cards; widths are uniform and heights are the client's.
//
// History: the first cut equalized every row to its tallest card (a two-row
// Aave position in a card 80% empty). The second planned mixed widths
// (6/8/4 of 12) with natural heights — tighter, but column edges never lined
// up and the board read as scattered (Nate, 2026-09-09). Now: three equal
// columns, each card measured by SplashDashboard's MasonryCell and given
// exactly that many 8px row tracks, the grid packing dense — so every edge
// aligns and a short card leaves no void below it. Richest cards lead.

import type { SplashTile } from './types'

export interface PlannedCard {
  /** The MCP's tiles, first-seen order (one card per MCP). */
  group: SplashTile[]
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

/** A rough "how tall will this card be" in row units — ordering only, never
 *  layout: the richest cards lead so the top of the board is the fullest and
 *  the masonry has fewer holes to fill. */
export function estimateHeight(group: SplashTile[]): number {
  let h = 3 // header + chips
  for (const t of group) {
    if (t.viz) h += t.viz.kind === 'allocation' ? 2 : t.viz.kind === 'positions' ? 1 + t.viz.items.length : t.viz.kind === 'cadence' ? 2 + t.viz.items.length : 3
    switch (t.render) {
      case 'rows':
        h += (t.headline ? 1.5 : 0) + t.rows.length * 1.3
        break
      case 'holdings':
        h += 1.5 + t.holdings.length * 1.4
        break
      case 'nfts':
        h += 4 + Math.ceil(Math.min(t.nfts.length, 12) / 3) * 2.5
        break
      case 'proposals':
        h += 1.5 + Math.min(t.proposals.length, 4) * 2
        break
      case 'activity':
        h += t.rows.length * 1.5
        break
      default:
        h += 2
    }
  }
  return h
}

export function planLayout(tiles: SplashTile[], { hero = true }: { hero?: boolean } = {}): SplashLayout {
  const heroTile = hero ? tiles.find((t) => t.id === 'briefing') ?? null : null
  const groups = groupBySlug(tiles.filter((t) => t !== heroTile))
  // Stable sort: richest first, first-seen order among equals.
  const cards = groups
    .map((group, i) => ({ group, i, h: estimateHeight(group) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map(({ group }) => ({ group }))
  return { hero: heroTile, cards }
}
