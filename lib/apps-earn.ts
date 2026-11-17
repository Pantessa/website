// THE APPS PAGE, EARN LANE (squad apps-page, 2026-11-17): the pure rules
// behind the Aave, Lido, Morpho, NEAR Intents and funding sections
// (components/apps/sections/{aave,lido,morpho,near,funding}.tsx). Words and
// numbers only: no React, no fetch. Every number comes from a tile, the
// wallet's money map or the public earn board; a value this file cannot read
// is null and the section leaves it out (never a 0 for unknown).
// Pinned in scripts/apps-earn-pins.ts.

import { crossChainAskSentence, parseCrossChainSwap } from '@/lib/cross-chain-swap'
import { crossChainFloorBlock } from '@/lib/venue-floor'
import { canonicalChainWord, prettyChainWord } from '@/lib/chain-lexicon'
import type { MoneyMap, RowsTile, SplashTile, StatRow, SuggestedPrompt } from '@/lib/splash/types'

// ── Formatting ──────────────────────────────────────────────────────────────

/** "$1,121" from $1,000, "$623.97" under it. */
export function usdWords(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`
  return `${sign}$${abs.toFixed(4)}`
}

/** "4.39%"; at most two places, trailing zeros kept to two. */
export const pctWords = (n: number): string => `${n.toFixed(2)}%`

/** "$1,204.50" / "1,204 USDC" → 1204.5; digit-less → null. */
export function numOf(s: string | null | undefined): number | null {
  if (typeof s !== 'string' || !/\d/.test(s)) return null
  const n = Number(s.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
export const countWord = (n: number): string => (n >= 0 && n < COUNT.length ? COUNT[n] : String(n))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What a principal earns in a year at a rate, to the cent. An estimate:
 *  rates move. Null when either side is unknown. */
export function yearlyEarn(principal: number | null | undefined, ratePct: number | null | undefined): number | null {
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal <= 0) return null
  if (typeof ratePct !== 'number' || !Number.isFinite(ratePct)) return null
  return Math.round(principal * ratePct) / 100
}

const rowsTile = (tiles: SplashTile[], id: string): RowsTile | null => {
  const t = tiles.find((x) => x.id === id && x.render === 'rows')
  return t && t.render === 'rows' ? t : null
}

// ── The wallet's idle money (the briefing's money map) ──────────────────────

/** Stables earning nothing, from the briefing-owned `idle` bucket ("USDC on
 *  Base"). Null when the map holds none (never "0 idle" for an unread map). */
export function idleOf(map: MoneyMap | null | undefined): { usd: number; chains: string[] } | null {
  const idle = (map?.facts ?? []).filter((f) => f.bucket === 'idle' && f.usd > 0)
  if (idle.length === 0) return null
  const chains = [...new Set(idle.map((f) => f.label.replace(/^.*?\bon\s+/i, '')))]
  return { usd: Math.round(idle.reduce((a, f) => a + f.usd, 0) * 100) / 100, chains }
}

// ── Aave ────────────────────────────────────────────────────────────────────

export interface AaveRow {
  symbol: string
  side: 'supplied' | 'borrowed'
  collateral: boolean
  valueUsd: number | null
  /** The tile's own value string ("$20.01"), drawn as it came. */
  value: string
  sub?: string
  /** The asks this row can run (the source's own grammar). */
  actions: SuggestedPrompt[]
}

export interface AaveView {
  suppliedUsd: number | null
  borrowedUsd: number | null
  healthFactor: number | null
  netApyPct: number | null
  rows: AaveRow[]
  prompts: SuggestedPrompt[]
}

/** The `aave-position` tile read into one shape. Null when the wallet has no
 *  Aave position (the tile is absent: the preview or an error stands). */
export function aaveViewOf(tiles: SplashTile[]): AaveView | null {
  const t = rowsTile(tiles, 'aave-position')
  if (!t) return null
  const viz = t.viz?.kind === 'lending' ? t.viz : null
  const rows: AaveRow[] = []
  for (const r of t.rows) {
    const m = r.label.match(/^(\S+)\s+(supplied|borrowed)(\s*·\s*collateral)?/i)
    if (!m) continue
    const symbol = m[1]
    const side = m[2].toLowerCase() as 'supplied' | 'borrowed'
    // The same sentences the source's own chips send (lib/splash/sources
    // aaveSource), sized "all" so they never name money the wallet lacks.
    const actions: SuggestedPrompt[] =
      symbol === 'Token'
        ? []
        : side === 'borrowed'
          ? [{ label: 'Repay', prompt: `Repay all my ${symbol} on Aave` }]
          : [{ label: 'Withdraw', prompt: `Withdraw all my ${symbol} from Aave` }]
    rows.push({ symbol, side, collateral: !!m[3], valueUsd: numOf(r.value), value: r.value ?? '', sub: r.sub, actions })
  }
  return {
    suppliedUsd: viz?.suppliedUsd ?? null,
    borrowedUsd: viz?.borrowedUsd ?? null,
    healthFactor: viz?.healthFactor ?? null,
    netApyPct: viz?.netApyPct ?? null,
    rows,
    prompts: t.prompts,
  }
}

/** "$1,121 is earning 4.39%. $790.26 is earning nothing." The idle half only
 *  when the money map holds idle stables; the rate only when Aave said one. */
export function aaveHeadline(v: AaveView | null, idle: { usd: number } | null): string {
  const idleBit = idle && idle.usd >= 1 ? ` ${usdWords(idle.usd)} is earning nothing.` : ''
  if (!v || !(v.suppliedUsd != null && v.suppliedUsd > 0)) {
    if (v && v.borrowedUsd != null && v.borrowedUsd > 0) return `${usdWords(v.borrowedUsd)} borrowed on Aave.`
    return `Nothing supplied on Aave yet.${idleBit}`
  }
  const rate = v.netApyPct != null ? ` is earning ${pctWords(v.netApyPct)}.` : ' is supplied on Aave.'
  return `${usdWords(v.suppliedUsd)}${rate}${idleBit}`
}

/** A row of the public earn board (GET /api/markets/earn, wire shape). */
export interface EarnBoardRow {
  venue: string
  asset: string
  chainLabel: string
  apyPct: number | null
  tvlUsd: number | null
  detail: string
  askTemplate: string | null
}

export interface AaveOffer {
  asset: string
  apyPct: number
  tvlUsd: number | null
  detail: string
  heldUsd: number
  ask: string
}

/** What the wallet holds that Aave lists, at Aave's best rate, with the
 *  board's own sentence sized to what is held (whole dollars, floor). The
 *  board already keeps only reserves the supply layer would accept (active,
 *  canSupply), so every offer is one the chat builds. Highest rate first. */
export function aaveOffers(board: readonly EarnBoardRow[], held: ReadonlyMap<string, number>, max = 4): AaveOffer[] {
  const out: AaveOffer[] = []
  for (const r of board) {
    if (r.venue !== 'aave' || !r.askTemplate || !r.askTemplate.includes('{usd}')) continue
    if (typeof r.apyPct !== 'number' || !(r.apyPct > 0)) continue
    const h = held.get(r.asset.toUpperCase()) ?? 0
    const usd = Math.floor(h)
    if (usd < 1) continue
    out.push({ asset: r.asset, apyPct: r.apyPct, tvlUsd: r.tvlUsd, detail: r.detail, heldUsd: h, ask: r.askTemplate.replace('{usd}', `$${usd}`) })
  }
  return out.sort((a, b) => b.apyPct - a.apyPct).slice(0, max)
}

// ── Holdings across the page (for Aave's offers and NEAR's chains) ──────────

export interface PlacedHolding {
  symbol: string
  chain: string
  usd: number
  /** Token units as the tile wrote them; null when only dollars are known. */
  balance: string | null
}

/** Every holding the page can see, with its chain. Read from any app's
 *  holdings tile (deduped across apps), else from the money map's ETH and
 *  USDC facts. `source` says which, so the section can say what it counts. */
export function placedHoldings(
  bySlug: ReadonlyMap<string, SplashTile[]>,
  map: MoneyMap | null | undefined,
): { rows: PlacedHolding[]; source: 'holdings' | 'map' | null } {
  const seen = new Set<string>()
  const rows: PlacedHolding[] = []
  for (const tiles of bySlug.values()) {
    for (const t of tiles) {
      if (t.render !== 'holdings') continue
      const tileChain = t.chain && !/·|,/.test(t.chain) ? t.chain : null
      for (const h of t.holdings) {
        const chain = h.chain ?? tileChain
        if (!chain || h.valueUsd == null || !(h.valueUsd > 0)) continue
        const key = `${chain.toLowerCase()}:${h.symbol.toUpperCase()}:${(h.address ?? '').toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({ symbol: h.symbol, chain, usd: h.valueUsd, balance: h.balance ?? null })
      }
    }
  }
  if (rows.length > 0) return { rows, source: 'holdings' }
  for (const f of map?.facts ?? []) {
    if ((f.bucket !== 'idle' && f.bucket !== 'spot' && f.bucket !== 'protected') || !(f.usd > 0)) continue
    const m = f.label.match(/^(ETH|USDC) on (.+)$/)
    if (!m) continue
    rows.push({ symbol: m[1], chain: m[2], usd: f.usd, balance: null })
  }
  return { rows, source: rows.length > 0 ? 'map' : null }
}

/** symbol → dollars held across every chain (WETH counts as ETH: the board
 *  names ETH and the supply layer wraps it). */
export function heldBySymbol(rows: readonly PlacedHolding[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const s = r.symbol.toUpperCase() === 'WETH' ? 'ETH' : r.symbol.toUpperCase()
    out.set(s, (out.get(s) ?? 0) + r.usd)
  }
  return out
}

// ── NEAR Intents: money by chain, and what can move ─────────────────────────

export interface ChainGroup {
  chain: string
  totalUsd: number
  /** Largest first. */
  tokens: PlacedHolding[]
}

/** Holdings grouped by chain, the largest chain first. */
export function chainGroups(rows: readonly PlacedHolding[]): ChainGroup[] {
  const by = new Map<string, ChainGroup>()
  for (const r of rows) {
    const key = r.chain.trim()
    const g = by.get(key) ?? { chain: key, totalUsd: 0, tokens: [] }
    g.totalUsd += r.usd
    g.tokens.push(r)
    by.set(key, g)
  }
  const groups = [...by.values()]
  for (const g of groups) {
    g.totalUsd = Math.round(g.totalUsd * 100) / 100
    g.tokens.sort((a, b) => b.usd - a.usd)
  }
  return groups.sort((a, b) => b.totalUsd - a.totalUsd)
}

/** Stables a move is sized in, 1:1 with the dollar (lib/venue-floor's set). */
const MOVE_STABLES = new Set(['USDC', 'USDT', 'DAI'])
/** Where a move lands: chains NEAR Intents delivers to directly (Robinhood
 *  Chain and Arc are funded through LiFi instead, lib/jobs). */
const MOVE_DESTS = new Set(['ethereum', 'base', 'arbitrum', 'optimism'])
/** Below this a move is not worth its gas; no button. */
export const MOVE_MIN_USD = 5

/** The chain a stable on `from` would move to: the largest OTHER chain the
 *  wallet already uses, among the chains NEAR delivers to. Null if none. */
export function moveDestination(groups: readonly ChainGroup[], from: string): string | null {
  const fromKey = canonicalChainWord(from) ?? from.toLowerCase()
  for (const g of groups) {
    const key = canonicalChainWord(g.chain) ?? g.chain.toLowerCase()
    if (key !== fromKey && MOVE_DESTS.has(key)) return key
  }
  return null
}

/** The cross-chain sentence for moving one holding, or null when there is no
 *  honest one: not a stable, under the minimum, no other chain to go to, a
 *  venue floor refuses it, or the chat's own grammar would not read it. */
export function moveAsk(h: PlacedHolding, groups: readonly ChainGroup[]): { ask: string; to: string; amount: number } | null {
  const sym = h.symbol.toUpperCase()
  if (!MOVE_STABLES.has(sym) || !(h.usd >= MOVE_MIN_USD)) return null
  const units = h.balance != null ? numOf(h.balance) : h.usd
  if (units == null || !(units >= MOVE_MIN_USD)) return null
  const amount = String(Math.floor(units))
  const fromKey = canonicalChainWord(h.chain)
  if (!fromKey) return null
  const to = moveDestination(groups, h.chain)
  if (!to) return null
  const params = { amount, originToken: sym, originChain: fromKey, destinationToken: sym, destinationChain: to }
  if (crossChainFloorBlock(params)) return null
  const ask = crossChainAskSentence(params)
  const parsed = parseCrossChainSwap(ask)
  if (!parsed || 'problem' in parsed) return null
  return { ask, to: prettyChainWord(to), amount: Number(amount) }
}

/** "Your money sits on three chains. Move it in one step." */
export function nearHeadline(groups: readonly ChainGroup[]): string {
  if (groups.length === 0) return 'Move money between chains in one step.'
  if (groups.length === 1) return `Your money sits on ${prettyChainWord(canonicalChainWord(groups[0].chain) ?? groups[0].chain.toLowerCase())}. Move it anywhere in one step.`
  return `Your money sits on ${countWord(groups.length)} chains. Move it in one step.`
}

/** "USDC, ETH, AERO" (the top three tokens on a chain). */
export const tokensLine = (g: ChainGroup, n = 3): string => [...new Set(g.tokens.map((t) => t.symbol))].slice(0, n).join(', ')

// ── Lido ────────────────────────────────────────────────────────────────────

export interface LidoView {
  stEth: string | null
  stakedUsd: number | null
  aprPct: number | null
  yearUsd: number | null
  rows: StatRow[]
  prompts: SuggestedPrompt[]
}

/** The `lido-position` tile read into one shape. Null when nothing is staked. */
export function lidoViewOf(tiles: SplashTile[]): LidoView | null {
  const t = rowsTile(tiles, 'lido-position')
  if (!t) return null
  const viz = t.viz?.kind === 'yield' ? t.viz : null
  const stEth = t.headline?.caption.match(/^([\d.,]+)\s+stETH/)?.[1] ?? null
  const stakedUsd = viz?.principalUsd ?? numOf(t.headline?.value)
  const subApr = t.subtitle?.match(/([\d.]+)%\s*APR/i)?.[1]
  const aprPct = viz?.aprPct ?? (subApr ? Number(subApr) : null)
  return { stEth, stakedUsd, aprPct, yearUsd: yearlyEarn(stakedUsd, aprPct), rows: t.rows, prompts: t.prompts }
}

/** "0.648 stETH is earning 2.34% a year." */
export function lidoHeadline(v: LidoView | null): string {
  if (!v) return 'Nothing staked with Lido yet.'
  const what = v.stEth ? `${v.stEth} stETH` : v.stakedUsd != null ? `${usdWords(v.stakedUsd)} of stETH` : 'Your stETH'
  return v.aprPct != null ? `${what} is earning ${pctWords(v.aprPct)} a year.` : `${what} is staked with Lido.`
}

// ── Morpho ──────────────────────────────────────────────────────────────────

export interface MorphoView {
  positions: StatRow[]
  health: StatRow | null
  prompts: SuggestedPrompt[]
  chains: string[]
}

export function morphoViewOf(tiles: SplashTile[]): MorphoView | null {
  const t = rowsTile(tiles, 'morpho-position')
  if (!t) return null
  const positions = t.rows.filter((r) => r.label !== 'Health factor')
  const health = t.rows.find((r) => r.label === 'Health factor') ?? null
  const chains = (t.subtitle ?? '').split('·').slice(1).map((s) => s.trim()).filter(Boolean)
  return { positions, health, prompts: t.prompts, chains }
}

/** "Two Morpho positions." No dollars: the payload carries none. */
export function morphoHeadline(v: MorphoView | null): string {
  if (!v || v.positions.length === 0) return 'Nothing supplied on Morpho yet.'
  const n = v.positions.length
  const where = v.chains.length > 0 ? ` on ${v.chains.join(' and ')}` : ''
  return `${cap(countWord(n))} Morpho ${n === 1 ? 'position' : 'positions'}${where}.`
}

// ── Funding (the idle-capital read) ─────────────────────────────────────────

export interface FundingView {
  yearUsd: number | null
  moves: StatRow[]
  prompts: SuggestedPrompt[]
}

export function fundingViewOf(tiles: SplashTile[]): FundingView | null {
  const t = tiles.find((x) => x.render === 'rows' && /-rebalance$/.test(x.id))
  if (!t || t.render !== 'rows') return null
  return { yearUsd: numOf(t.headline?.value), moves: t.rows, prompts: t.prompts }
}

/** "Your idle money could earn about $12.34 a year." */
export function fundingHeadline(v: FundingView | null): string {
  if (!v) return 'Nothing is worth moving right now.'
  if (v.yearUsd != null && v.yearUsd > 0) return `Your idle money could earn about ${usdWords(v.yearUsd)} a year.`
  return `${cap(countWord(v.moves.length))} ${v.moves.length === 1 ? 'balance is' : 'balances are'} earning nothing.`
}

// ── Shared: the empty preview's own words ───────────────────────────────────

export function previewOf(tiles: SplashTile[]): { message: string; prompts: SuggestedPrompt[] } | null {
  const t = tiles.find((x) => x.render === 'empty')
  return t && t.render === 'empty' ? { message: t.message, prompts: t.prompts } : null
}

export function errorOf(tiles: SplashTile[]): string | null {
  const t = tiles.find((x) => x.render === 'error')
  return t && t.render === 'error' ? t.message : null
}
