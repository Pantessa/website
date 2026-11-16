// The route table's FOLD (2026-11-16, Nate: "the UI UX is overwhelming, can
// we simplify the UX and still get the point across"). The map used to print
// one row per chain per side: UNI was five spot rows, six limit rows, two
// perp rows, each repeating the same venue, the same price and the same fee.
// The point of the table is "every way to act", so a row is now a WAY:
//
//   • a buy and its sell on one venue + chain are ONE line with two chips
//     (the sell's quote was the buy's mid restated);
//   • a kind quoted on several chains shows its LEAD chain (the best-out
//     chain for spot; the same chain for limit so the two agree) and folds
//     the other chains behind one "compare" toggle.
//
// Pure: no row is invented, dropped or re-priced. Every RouteQuote that came
// in is on exactly one line, and every chip still sends its own row's ask.

import type { RouteQuote, VenueKind } from './symbol-venues'

export interface RouteLine {
  /** Stable key: the pair's shared id, or the lone row's id. */
  key: string
  /** The row whose venue, quote, fee and tags the line shows (the buy side when there is one). */
  primary: RouteQuote
  /** Every row on the line, buy side first. One chip each. */
  acts: RouteQuote[]
  /** Both prices when the two sides rest at different ones (a limit pair); else null. */
  pairLabel: string | null
}

export interface FoldedGroup {
  /** The lines shown at once. */
  lead: RouteLine[]
  /** The other chains' lines, behind the toggle. */
  more: RouteLine[]
  /** The chain the lead lines are on (null when the kind is not folded by chain). */
  leadChainId: number | null
  /** How many chains this kind is quoted on. */
  chains: number
}

/** Kinds whose two sides share one venue line. A loan's supply and borrow are
 *  different products with different numbers, so `lend` never pairs. */
const PAIRED: ReadonlySet<VenueKind> = new Set<VenueKind>(['spot', 'limit', 'stock', 'perp'])
/** Kinds quoted once per chain: one chain leads, the rest fold. */
const BY_CHAIN: ReadonlySet<VenueKind> = new Set<VenueKind>(['spot', 'limit'])

const lineKey = (r: RouteQuote): string => (PAIRED.has(r.kind) && (r.side === 'buy' || r.side === 'sell') ? `${r.kind}:${r.venue}:${r.chainId}` : r.id)

/** Rows → lines, in the order the rows came. */
export function routeLines(rows: readonly RouteQuote[]): RouteLine[] {
  const by = new Map<string, RouteQuote[]>()
  for (const r of rows) {
    const k = lineKey(r)
    const g = by.get(k)
    if (g) g.push(r)
    else by.set(k, [r])
  }
  return [...by.entries()].map(([key, g]) => {
    const acts = [...g].sort((a, b) => Number(a.side === 'sell') - Number(b.side === 'sell'))
    const primary = acts[0]
    const labels = [...new Set(acts.map((a) => (a.quote && a.quote.kind !== 'none' ? a.quote.label : null)).filter((l): l is string => !!l))]
    return { key, primary, acts, pairLabel: labels.length > 1 ? labels.join(' / ') : null }
  })
}

/** One kind's rows → what shows at once and what folds. `preferChainId` lets
 *  the limit group lead with the chain the spot group called best. */
export function foldGroup(kind: VenueKind, rows: readonly RouteQuote[], preferChainId?: number | null): FoldedGroup {
  const lines = routeLines(rows)
  if (!BY_CHAIN.has(kind)) return { lead: lines, more: [], leadChainId: null, chains: new Set(rows.map((r) => r.chainId)).size }
  const chainIds = [...new Set(lines.map((l) => l.primary.chainId))]
  if (chainIds.length <= 1) return { lead: lines, more: [], leadChainId: chainIds[0] ?? null, chains: chainIds.length }
  const best = rows.find((r) => r.best)?.chainId
  const leadChainId = best ?? (preferChainId != null && chainIds.includes(preferChainId) ? preferChainId : chainIds[0])
  return {
    lead: lines.filter((l) => l.primary.chainId === leadChainId),
    more: lines.filter((l) => l.primary.chainId !== leadChainId),
    leadChainId,
    chains: chainIds.length,
  }
}

/** The toggle's words. */
export const foldToggleLabel = (more: number, open: boolean): string =>
  open ? 'Show the best chain only' : `Compare ${more} more chain${more === 1 ? '' : 's'}`
