// The splash bento — pure, client-safe. Decides which tile is the hero and
// how wide each MCP's card is, so the grid packs without holes.
//
// Why a planner instead of CSS alone: the old uniform grid equalized every
// row to its tallest card, so a two-row Aave position sat in a card 80%
// empty beside the briefing. Natural heights need widths that fill rows:
// a 12-column grid, "wide" cards at 6, "narrow" at 4, wides first in pairs,
// narrows in triples, and the leftovers stretched so no row ends short.
// Heights are the client's job: SplashDashboard's MasonryCell measures each
// card and claims that many 8px row tracks, and the grid packs DENSE — so a
// short card beside a tall one leaves no void, the next card slides up into
// it (Nate, 2026-09-09: "less scattered").

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

/** A rough "how tall will this card be" in row units — ordering only, never
 *  layout: richest cards lead their band so the top of the board is the
 *  fullest and the masonry has fewer holes to fill. */
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
        h += 4 + Math.ceil(Math.min(t.nfts.length, 12) / 4) * 2
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
  const byRichness = (a: SplashTile[], b: SplashTile[]) => estimateHeight(b) - estimateHeight(a)
  const wides = groups.filter((g) => wantsWide(g)).sort(byRichness)
  const narrows = groups.filter((g) => !wantsWide(g)).sort(byRichness)
  const spans = planSpans(wides.length, narrows.length)
  // Spans were planned wides-first, then narrows — assign in that order.
  const ordered = [...wides, ...narrows]
  return {
    hero: heroTile,
    cards: ordered.map((group, i) => ({ group, span: spans[i] ?? 4 })),
  }
}
