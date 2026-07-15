// App Mode panel contract: which structured panels the current MCP working
// set can host, and how splash tiles (the existing per-MCP data pipeline —
// lib/splash) map into them.
//
// The design goal mirrors the splash contract one level up: panels are
// DECLARED, never hand-built per protocol. A panel kind is a render primitive
// (portfolio, swap, governance, earn, positions, activity); an MCP earns a
// panel by matching a kind here and feeding it through the same sources that
// power the splash. A new MCP that reuses an existing kind = zero new
// frontend. Actions inside panels route through the SAME guarded tx pipeline
// chat uses — panels pre-fill what chat would build, they never grow a second
// build path.

import type { McpServer } from '@/lib/store'
import type { SplashTile } from '@/lib/splash/types'
import { splashCapable } from '@/lib/splash/types'

export type PanelKind = 'portfolio' | 'swap' | 'governance' | 'earn' | 'positions' | 'activity'

export interface PanelDescriptor {
  kind: PanelKind
  /** MCP slugs that can feed this panel (display + attribution). */
  slugs: string[]
  /** Grid columns the panel wants on wide screens (portfolio/swap lead). */
  span: 1 | 2
}

/** Set-based matchers: which panel kinds an MCP can host. Kept as loose
 *  slug/name regexes like splashCapable — the free fleet's slugs are stable
 *  (`uniswap-free`, `snapshot-free`, …) but customs vary. */
const KIND_MATCHERS: Record<Exclude<PanelKind, 'portfolio' | 'activity'>, RegExp> = {
  swap: /uniswap|cow/i,
  governance: /snapshot/i,
  earn: /lido|aave/i,
  positions: /hyperliquid/i,
}

const matches = (s: McpServer, re: RegExp) => re.test(`${s.slug} ${s.name}`)

/** True when the working set can host at least one App Mode panel — gates the
 *  Chat ↔ App toggle's visibility (mirror of splashCapable's role). */
export function panelCapable(servers: McpServer[]): boolean {
  return servers.some(
    (s) =>
      splashCapable(s) ||
      Object.values(KIND_MATCHERS).some((re) => matches(s, re)),
  )
}

/** Which panels the current set hosts, in display order. Portfolio and
 *  activity ride on ANY panel-capable set (every wallet has holdings and
 *  history — the wallet MCP / Alchemy sources feed them); the action panels
 *  (swap, governance, earn, positions) require their MCP in the set. */
export function derivePanels(servers: McpServer[]): PanelDescriptor[] {
  if (servers.length === 0) return []
  const forKind = (re: RegExp) => servers.filter((s) => matches(s, re)).map((s) => s.slug)
  const panels: PanelDescriptor[] = []

  const swap = forKind(KIND_MATCHERS.swap)
  // Portfolio anchors the workspace — double-width on wide grids.
  panels.push({ kind: 'portfolio', slugs: servers.filter(splashCapable).map((s) => s.slug), span: 2 })
  if (swap.length) panels.push({ kind: 'swap', slugs: swap, span: 1 })
  const governance = forKind(KIND_MATCHERS.governance)
  if (governance.length) panels.push({ kind: 'governance', slugs: governance, span: 1 })
  const earn = forKind(KIND_MATCHERS.earn)
  if (earn.length) panels.push({ kind: 'earn', slugs: earn, span: 1 })
  const positions = forKind(KIND_MATCHERS.positions)
  if (positions.length) panels.push({ kind: 'positions', slugs: positions, span: 1 })
  panels.push({ kind: 'activity', slugs: [], span: 1 })

  return panels
}

/** Where a resolved splash tile renders in App Mode. Data-driven — the tile's
 *  shape (+ producing MCP for the ambiguous `rows` primitive) decides the
 *  panel, so a new MCP reusing a primitive lands in the right place free. */
export function tilePanelKind(tile: SplashTile): PanelKind | null {
  switch (tile.render) {
    case 'holdings':
      return 'portfolio'
    case 'proposals':
      return 'governance'
    case 'activity':
      return 'activity'
    case 'rows':
      return KIND_MATCHERS.positions.test(tile.mcpSlug) ? 'positions' : 'earn'
    case 'empty':
    case 'error':
      return null
  }
}

export const PANEL_TITLES: Record<PanelKind, string> = {
  portfolio: 'Portfolio',
  swap: 'Swap',
  governance: 'Governance',
  earn: 'Earn',
  positions: 'Positions',
  activity: 'Activity',
}
