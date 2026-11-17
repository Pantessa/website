// THE PORTFOLIO SECTIONS' RULES (squad apps-page, lane PORTFOLIO, 2026-11-17).
// Pure, client-safe: words and numbers the Uniswap / Pantessa Wallet /
// Robinhood / OpenSea sections and the page's Needs-you and Recurring blocks
// compose from the splash tiles. Nothing here fetches, prices or invents: a
// value the tile does not carry is null, and a sentence leaves it out.
// Pinned in scripts/apps-portfolio-pins.ts.

import type { ActivityRow, HoldingRow, HoldingsTile, NftRow, RowsTile, SplashTile, StatRow } from '@/lib/splash/types'

// ── Numbers ─────────────────────────────────────────────────────────────────

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** A count in a sentence: a word up to nine, digits after ("five", "12"). */
export function spellCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  const i = Math.round(n)
  return i < WORDS.length ? WORDS[i] : i.toLocaleString('en-US')
}

/** "$6,306" from a thousand up, "$623.97" below, "$0.0042" for dust. */
export function usdText(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`
  if (abs === 0) return '$0'
  return `${sign}$${abs.toFixed(abs < 0.01 ? 4 : 2)}`
}

/** A token balance for a table cell: four places under a thousand, two above. */
export function balanceText(s: string): string {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n > 0 && n < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ── Holdings ────────────────────────────────────────────────────────────────

export interface HoldingsCounts {
  /** Every position the scan found (the tile ships only the largest rows). */
  positions: number
  /** Chains that hold something, or null when the tile does not say. */
  chains: number | null
  /** The one chain's name when everything sits on one. */
  chainName: string | null
}

/** How many positions and chains a holdings tile stands for. The sources say
 *  it in the subtitle ("35 across 5 chains", "4 on Base", "2 stocks · 5
 *  total"); the rows are only the largest few. Unknown stays null. */
export function holdingsCounts(tile: HoldingsTile): HoldingsCounts {
  const sub = (tile.subtitle ?? '').trim()
  const shown = tile.holdings.length
  const rowChains = [...new Set(tile.holdings.map((h) => h.chain ?? tile.chain).filter(Boolean))]
  let m = sub.match(/^(\d+)\s+across\s+(\d+)\s+chains?$/i)
  if (m) {
    const chains = Number(m[2])
    return { positions: Math.max(Number(m[1]), shown), chains, chainName: chains === 1 && rowChains.length === 1 ? rowChains[0]! : null }
  }
  m = sub.match(/^(\d+)\s+on\s+(.+)$/i)
  if (m) return { positions: Math.max(Number(m[1]), shown), chains: 1, chainName: m[2].trim() }
  m = sub.match(/(\d+)\s+total$/i)
  if (m) {
    const single = !tile.chain.includes('·')
    return { positions: Math.max(Number(m[1]), shown), chains: single ? 1 : null, chainName: single ? tile.chain : null }
  }
  // No count in the subtitle: the rows are all we know. Their chains are a
  // floor, so they are only a count when every chain label is one.
  const single = rowChains.length === 1 && !String(rowChains[0]).includes('·')
  return { positions: shown, chains: single ? 1 : null, chainName: single ? (rowChains[0] as string) : null }
}

/** Largest first; rows with no price sink to the end in their own order. */
export function rankHoldings(rows: HoldingRow[]): HoldingRow[] {
  return rows
    .map((h, i) => ({ h, i }))
    .sort((a, b) => {
      const av = a.h.valueUsd
      const bv = b.h.valueUsd
      if (av == null && bv == null) return a.i - b.i
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av || a.i - b.i
    })
    .map((x) => x.h)
}

/** The biggest priced position, or null when nothing is priced. */
export function biggestHolding(rows: HoldingRow[]): HoldingRow | null {
  const first = rankHoldings(rows)[0]
  return first && first.valueUsd != null && first.valueUsd > 0 ? first : null
}

/** "$6,306 in 35 positions on five chains." The money leads when the tile
 *  priced it; chains follow when the tile counted them; one chain is named. */
export function holdingsSentence(p: { totalUsd: number | null; counts: HoldingsCounts; noun?: [string, string]; lead?: string }): string {
  const [one, many] = p.noun ?? ['position', 'positions']
  const { positions, chains, chainName } = p.counts
  const things = `${positions.toLocaleString('en-US')} ${plural(positions, one, many)}`
  const where = chains == null ? '' : chains === 1 ? (chainName ? ` on ${chainName}` : ' on one chain') : ` on ${spellCount(chains)} chains`
  const money = p.totalUsd != null && p.totalUsd > 0 ? `${usdText(p.totalUsd)} in ` : ''
  const body = `${money}${things}${where}.`
  if (!p.lead) return body.charAt(0).toUpperCase() + body.slice(1)
  return `${p.lead} ${body}`
}

/** A holdings tile out of an app's group (the multichain one or a source's own). */
export function holdingsTileOf(tiles: SplashTile[]): HoldingsTile | null {
  return (tiles.find((t) => t.render === 'holdings' && t.holdings.length > 0) as HoldingsTile | undefined) ?? null
}

/** The shared multichain tiles (Uniswap and the Pantessa Wallet both build
 *  them; the scan keeps the first by id). */
export const SHARED_PORTFOLIO_IDS = ['portfolio-holdings', 'recent-activity'] as const

/** When this app came back without the shared portfolio tiles but another app
 *  on the page has them, that app's name: "Your holdings are shown under …". */
export function holdingsShownUnder(slug: string, own: SplashTile[], bySlug: Map<string, SplashTile[]>): string | null {
  if (own.some((t) => (SHARED_PORTFOLIO_IDS as readonly string[]).includes(t.id))) return null
  for (const [other, tiles] of bySlug) {
    if (other === slug) continue
    const hit = tiles.find((t) => t.id === 'portfolio-holdings')
    if (hit) return hit.mcpName
  }
  return null
}

/** The chain labels a tile read ("Ethereum · Base · Arbitrum" → three). */
export function chainLabelsOf(tile: HoldingsTile): string[] {
  return tile.chain.split('·').map((s) => s.trim()).filter(Boolean)
}

// ── Activity ────────────────────────────────────────────────────────────────

/** "Received 0.5 ETH" · "Sent 20 USDC" · "Moved ETH to yourself". */
export function activityWords(r: ActivityRow): string {
  const what = `${r.amount ? `${r.amount} ` : ''}${r.asset}`
  if (r.direction === 'in') return `Received ${what}`
  if (r.direction === 'out') return `Sent ${what}`
  return `Moved ${what} to yourself`
}

/** "3h ago" from unix seconds against `now` (ms); '' when unknown. */
export function agoText(unixSec: number, now = Date.now()): string {
  if (!(unixSec > 0)) return ''
  const s = Math.max(0, Math.floor((now - unixSec * 1000) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`
}

// ── NFTs ────────────────────────────────────────────────────────────────────

export interface NftCounts {
  /** How many the tile carries (the gallery). */
  shown: number
  /** How many the scan found ("12+" → 12), never fewer than shown. */
  total: number
  /** True when the scan stopped at its cap ("12+"). */
  more: boolean
  /** Collections and chains AMONG THE SHOWN ones. */
  collections: number
  chains: number
}

export function nftCounts(nfts: NftRow[], subtitle?: string): NftCounts {
  const m = (subtitle ?? '').match(/^\s*(\d+)(\+)?/)
  return {
    shown: nfts.length,
    total: Math.max(m ? Number(m[1]) : 0, nfts.length),
    more: !!m?.[2],
    collections: new Set(nfts.map((n) => n.collection || n.collectionName)).size,
    chains: new Set(nfts.map((n) => n.chain)).size,
  }
}

/** "12 or more NFTs." (the collections of a partial view are not counted) ·
 *  "3 NFTs in two collections." · "1 NFT in one collection." */
export function nftSentence(c: NftCounts): string {
  if (c.total === 0) return 'No NFTs in this wallet.'
  const n = `${c.total}${c.more ? ' or more' : ''} ${c.total === 1 && !c.more ? 'NFT' : 'NFTs'}`
  const all = c.total === c.shown && !c.more
  const where = all && c.collections > 0 ? ` in ${spellCount(c.collections)} ${plural(c.collections, 'collection', 'collections')}` : ''
  return `${n}${where}.`
}

// ── Needs you ───────────────────────────────────────────────────────────────

/** One briefing row as ONE sentence: the label, then its value and small
 *  print joined the way a person would say it. Ends with a full stop. */
export function needsSentence(r: StatRow): string {
  const parts = [r.label, r.value, r.sub].map((s) => (s ?? '').trim()).filter(Boolean)
  let out = parts.join('. ').replace(/\.\s*\./g, '.')
  if (!/[.!?]$/.test(out)) out += '.'
  return out
}

/** The briefing rows a holdings section points at: rows with an action whose
 *  chart symbol is one of the holdings. Counted, never redrawn (the page's
 *  Needs-you strip draws them). */
export function needsAboutHoldings(briefing: RowsTile | null, symbols: string[]): number {
  const set = new Set(symbols.map((s) => s.toUpperCase()))
  // The row's own words name the token ("$158.16 USDC idle on Arbitrum"); its
  // chartSymbol can be the swap's OTHER side (ETH), so it is not the test.
  return (briefing?.rows ?? []).filter((r) => (r.actions?.length ?? 0) > 0 && (r.label.match(/[A-Za-z][A-Za-z0-9]{1,9}/g) ?? []).some((w) => set.has(w.toUpperCase()))).length
}

/** The token a row is ABOUT: its chart symbol when its own words name it
 *  (the briefing's USDC rows chart ETH, the swap's other side). */
export function rowTokenOf(r: StatRow): string | null {
  if (!r.chartSymbol) return null
  const sym = r.chartSymbol.replace(/[^A-Za-z0-9]/g, '')
  return new RegExp(`(^|[^A-Za-z])${sym}([^A-Za-z]|$)`, 'i').test(r.label) ? r.chartSymbol : null
}

// ── Recurring buys ──────────────────────────────────────────────────────────

export const isDueRow = (r: StatRow) => /due now/i.test(r.value ?? '')

/** Due rows first, the rest in their own order. */
export function dueFirst(rows: StatRow[]): StatRow[] {
  return [...rows.filter(isDueRow), ...rows.filter((r) => !isDueRow(r))]
}

/** "3 recurring buys, 1 due." · "2 recurring buys, none due." */
export function recurringSentence(tile: RowsTile | null): string | null {
  const rows = tile?.rows ?? []
  if (rows.length === 0) return null
  const due = rows.filter(isDueRow).length
  const head = `${rows.length} recurring ${plural(rows.length, 'buy', 'buys')}`
  return `${head}, ${due === 0 ? 'none' : due} due.`
}

/** "$43 a month" from the tile's cadence chart, or null when it has none. */
export function recurringMonthly(tile: RowsTile | null): string | null {
  const v = tile?.viz
  if (!v || v.kind !== 'cadence' || !(v.monthlyUsd > 0)) return null
  return `$${Math.round(v.monthlyUsd).toLocaleString('en-US')} a month`
}

/** "2 stocks · 5 total" → 2; a subtitle that does not count stocks → null. */
export function stockCount(subtitle?: string): number | null {
  const m = (subtitle ?? '').match(/(\d+)\s+stocks?\b/i)
  return m ? Number(m[1]) : null
}

const stop = (s: string) => (/[.!?:]$/.test(s) ? s : `${s}.`)

/** A needs-you row as the three pieces of one sentence, each ending in a
 *  full stop: what it is, the number that matters, the small print. */
export function needsPieces(r: StatRow): { lead: string; value: string | null; sub: string | null } {
  const lead = (r.label ?? '').trim()
  const value = (r.value ?? '').trim()
  const sub = (r.sub ?? '').trim()
  return { lead: stop(lead), value: value ? stop(value) : null, sub: sub ? stop(sub.charAt(0).toUpperCase() + sub.slice(1)) : null }
}
