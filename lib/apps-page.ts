// THE APPS PAGE — the rules (pure, client-safe; squad apps-page, 2026-11-17).
//
// Nate, on the card grid the APPS tab used to show: "still feels a bit
// overwhelming … imagine a clean minimal site built with just the
// information you want to see … if just Uniswap is selected it's a killer
// app in itself … less data would show as they deselect items … it also
// still needs the chat app part so users can chat with the app that's open."
//
// So the selected apps ARE the page:
//   1 app      → shown in FULL (a page of its own)
//   2 or 3     → SIDE by side (each app a column)
//   4 or more  → one LINE each
// and the chat is docked beside it, scoped to the apps that are open.
//
// Data rides the pipeline the old splash used (POST /api/splash →
// SplashTile, lib/splash): this file only decides shape and words. No React,
// no fetch, no store — everything here is pinned in scripts/apps-page-pins.ts.

import type { ProposalsTile, RowsTile, SplashTile, StatRow, SuggestedPrompt } from '@/lib/splash/types'
import { mergeMoneyMap, summarizeMoneyMap } from '@/lib/splash/money-map'

// ── Density ─────────────────────────────────────────────────────────────────

export type AppsDensity = 'empty' | 'full' | 'side' | 'lines'

/** How much room each app gets, from how many apps are on the page. */
export function densityFor(count: number): AppsDensity {
  if (!(count > 0)) return 'empty'
  if (count === 1) return 'full'
  if (count <= 3) return 'side'
  return 'lines'
}

/** What one section is asked to draw. `line` is the 4+ posture. */
export type SectionDensity = 'full' | 'side' | 'line'
export const sectionDensityFor = (d: AppsDensity): SectionDensity => (d === 'full' ? 'full' : d === 'side' ? 'side' : 'line')

/** The eyebrow over the headline: "1 APP ON THIS PAGE · SHOWN IN FULL". */
export function densityEyebrow(count: number): string {
  const d = densityFor(count)
  if (d === 'empty') return 'NO APPS ON THIS PAGE'
  const n = `${count} ${count === 1 ? 'APP' : 'APPS'} ON THIS PAGE`
  return `${n} · ${d === 'full' ? 'SHOWN IN FULL' : d === 'side' ? 'SIDE BY SIDE' : 'ONE LINE EACH'}`
}

// ── Families ────────────────────────────────────────────────────────────────
// One section component per family (components/apps/sections). The matchers
// mirror lib/splash/sources' own, so a server the splash knows lands on the
// section that knows its tiles; anything else gets the generic section.

export const APP_FAMILIES = ['uniswap', 'snapshot', 'hyperliquid', 'cow', 'near', 'aave', 'lido', 'morpho', 'robinhood', 'opensea', 'wallet', 'funding', 'other'] as const
export type AppFamily = (typeof APP_FAMILIES)[number]

const FAMILY_MATCHERS: [AppFamily, RegExp][] = [
  ['wallet', /yeetful-tool-wallet|(yeetful|pantessa)\s*wallet/i],
  ['funding', /yeetful-tool-funding|(yeetful|pantessa)\s*(finance|funding)/i],
  ['uniswap', /uniswap/i],
  ['snapshot', /snapshot/i],
  ['hyperliquid', /hyperliquid/i],
  ['cow', /(^|\b)cow(\b|-)/i],
  ['near', /near[-\s]?intents/i],
  ['aave', /aave/i],
  ['lido', /lido/i],
  ['morpho', /morpho/i],
  ['robinhood', /robinhood/i],
  ['opensea', /opensea/i],
]

export function appFamily(s: { slug: string; name: string }): AppFamily {
  const hay = `${s.slug} ${s.name}`
  for (const [family, re] of FAMILY_MATCHERS) if (re.test(hay)) return family
  return 'other'
}

// ── Which place is showing ──────────────────────────────────────────────────

/** The apps page owns the main area when the APPS tab is the lit, open tab
 *  on a desktop and a wallet is connected (its data is the wallet's). In
 *  every other state the classic surface stands: no wallet → the examples
 *  and the apps drawer; a collapsed tab → the full-width conversation; a
 *  phone → its own APPS screen (components/phone). Derived, never stored, so
 *  the spine, the URL (?tab=) and the store keep their existing meaning. */
export function appsViewOn(s: { narrow: boolean; hasWallet: boolean; railTab: string; railOpen: boolean; mainView: string }): boolean {
  return !s.narrow && s.hasWallet && s.railTab === 'mcps' && s.railOpen && s.mainView === 'chat'
}

// ── The chat's scope, in words ──────────────────────────────────────────────

/** "Uniswap" · "Uniswap and Snapshot" · "5 apps" · "no app yet". */
export function chatScopeLabel(names: string[]): string {
  if (names.length === 0) return 'no app yet'
  if (names.length <= 2) return names.join(' and ')
  return `${names.length} apps`
}

/** The composer's placeholder, on the page's bar and in the dock. */
export function askPlaceholder(names: string[]): string {
  if (names.length === 0) return 'Pick an app to chat with'
  if (names.length === 1) return `Ask ${names[0]} anything`
  return `Ask your ${names.length} apps anything`
}

// ── Tiles → the page ────────────────────────────────────────────────────────

/** The wallet-level tiles no app owns: the briefing ("what needs you") and
 *  the wallet's recurring buys. They are the page's own, shown whatever the
 *  set is — never an app's section. */
export const BRIEFING_TILE_ID = 'briefing'
export const DCA_TILE_ID = 'dca-schedules'

export interface PageTiles {
  briefing: RowsTile | null
  recurring: RowsTile | null
  /** slug → that app's tiles, first-seen order. */
  bySlug: Map<string, SplashTile[]>
}

export function splitPageTiles(tiles: SplashTile[], activeSlugs: string[]): PageTiles {
  const active = new Set(activeSlugs)
  const bySlug = new Map<string, SplashTile[]>()
  let briefing: RowsTile | null = null
  let recurring: RowsTile | null = null
  for (const t of tiles) {
    if (t.id === BRIEFING_TILE_ID && t.render === 'rows') {
      briefing = t
      continue
    }
    if (t.id === DCA_TILE_ID && t.render === 'rows') {
      recurring = t
      continue
    }
    if (!active.has(t.mcpSlug)) continue
    const arr = bySlug.get(t.mcpSlug) ?? []
    arr.push(t)
    bySlug.set(t.mcpSlug, arr)
  }
  return { briefing, recurring, bySlug }
}

/** A briefing row that asks for something: it carries an action. Rows with
 *  none are calm observations and never raise the "needs you" strip. */
export function needsYouRows(briefing: RowsTile | null): StatRow[] {
  return (briefing?.rows ?? []).filter((r) => (r.actions?.length ?? 0) > 0)
}

/** Where the "needs you" strip sits. It is the WALLET's list, not an app's:
 *  when one app is the whole page and that app is not the wallet's own
 *  holdings view, the app leads and the strip follows it (Hyperliquid alone
 *  opened on a spot-ETH stop and idle USDC before its own first row). With
 *  two or more apps, or a portfolio app alone, it leads. */
export function needsLeads(density: AppsDensity, onlyFamily: AppFamily | null): boolean {
  if (density !== 'full') return true
  return onlyFamily === 'uniswap' || onlyFamily === 'wallet'
}

// ── One line per app (the 4+ posture, and the generic fallback) ─────────────

export interface AppLine {
  /** The sentence: one fact, plain words. */
  text: string
  /** The one button (the app's first suggested ask), or null. */
  act: SuggestedPrompt | null
  /** True when the app has nothing to report: quiet apps fold into ONE line. */
  quiet: boolean
}

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function proposalsLine(t: ProposalsTile): string {
  const n = t.proposals.length
  if (n === 0) return 'No votes open in the spaces you follow.'
  const first = t.proposals[0]
  return n === 1 ? `1 vote is open: ${first.title}` : `${n} votes are open. Next to close: ${first.title}`
}

/** One sentence for an app, from whatever its tiles hold. Sections override
 *  this with their own words; this is the floor every app stands on. */
export function lineFor(tiles: SplashTile[]): AppLine {
  const act = tiles.flatMap((t) => t.prompts)[0] ?? null
  for (const t of tiles) {
    if (t.render === 'holdings' && t.holdings.length > 0) {
      const total = t.totalUsd != null ? `${usd0(t.totalUsd)} in ` : ''
      return { text: `${total}${t.holdings.length} ${t.holdings.length === 1 ? 'position' : 'positions'}.`, act, quiet: false }
    }
    if (t.render === 'proposals') return { text: proposalsLine(t), act, quiet: t.proposals.length === 0 }
    if (t.render === 'rows' && (t.headline || t.rows.length > 0)) {
      const head = t.headline ? `${t.headline.value} ${t.headline.caption}` : `${t.rows[0].label}${t.rows[0].value ? `: ${t.rows[0].value}` : ''}`
      const more = !t.headline && t.rows.length > 1 ? ` and ${t.rows.length - 1} more` : ''
      return { text: `${head}${more}.`.replace(/\.\.$/, '.'), act, quiet: false }
    }
    if (t.render === 'nfts' && t.nfts.length > 0) return { text: `${t.nfts.length} ${t.nfts.length === 1 ? 'NFT' : 'NFTs'}.`, act, quiet: false }
    if (t.render === 'activity' && t.rows.length > 0) return { text: `${t.rows.length} recent transfers.`, act, quiet: false }
  }
  const empty = tiles.find((t) => t.render === 'empty')
  const err = tiles.find((t) => t.render === 'error')
  if (err && err.render === 'error') return { text: err.message, act: null, quiet: false }
  return { text: empty && empty.render === 'empty' ? empty.message : 'Nothing to report.', act, quiet: true }
}

/** "Nothing new from Hyperliquid, CoW Protocol or NEAR Intents." */
export function quietSentence(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `Nothing new from ${names[0]}.`
  return `Nothing new from ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}.`
}

// ── The page's one total ────────────────────────────────────────────────────

/** The dollars the headline may name: what the APPS ON THE PAGE carry, and
 *  never less than a section on the same page prints. The wallet-level map
 *  is NOT counted: with OpenSea alone it read "You have $20 on this page"
 *  for money no open app shows. So: the larger of the open apps' own facts
 *  and the biggest holdings total among their tiles (a portfolio's facts
 *  cover only its long tail, so its total leads). `appTiles` must be the
 *  open apps' tiles only (lib/apps-page splitPageTiles bySlug). null when
 *  nothing on the page carries a dollar. */
export function pageTotalUsd(appTiles: SplashTile[]): number | null {
  const tiles = appTiles
  const merged = mergeMoneyMap(null, tiles)
  const mapTotal = merged ? summarizeMoneyMap(merged).totalUsd : 0
  const held = tiles.reduce((m, t) => (t.render === 'holdings' && t.totalUsd != null && t.totalUsd > m ? t.totalUsd : m), 0)
  const total = Math.max(mapTotal, held)
  return total > 0 ? total : null
}

// ── The headline ────────────────────────────────────────────────────────────

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

/** The page's one headline when no single app owns it (2+ apps, or an app
 *  with no headline of its own): what the page can see, then what it asks of
 *  you. Never a number it was not given. */
export function pageHeadline(p: { count: number; totalUsd: number | null; needs: number; loading?: boolean }): string {
  if (p.count <= 0) return 'Pick an app to start.'
  // While the apps are still reading, "Nothing needs you" would be a claim
  // the page cannot make yet (Nate, 2026-11-19).
  if (p.loading) return p.count === 1 ? 'Loading your app…' : 'Loading your apps…'
  const money = p.totalUsd != null && p.totalUsd > 0 ? `You have ${usd0(p.totalUsd)} on this page. ` : ''
  if (p.needs <= 0) return `${money}Nothing needs you right now.`
  const n = p.needs < COUNT_WORDS.length ? COUNT_WORDS[p.needs] : String(p.needs)
  return `${money}${n} ${p.needs === 1 ? 'thing needs' : 'things need'} you.`
}

// ── The dock ────────────────────────────────────────────────────────────────

/** Suggestions for an empty dock: the open apps' own first asks, one per app
 *  first (so every open app is represented), then seconds, capped. */
export function dockSuggestions(groups: SuggestedPrompt[][], cap = 3): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = []
  const seen = new Set<string>()
  for (let depth = 0; depth < 4 && out.length < cap; depth++) {
    for (const g of groups) {
      const p = g[depth]
      if (!p || seen.has(p.prompt)) continue
      seen.add(p.prompt)
      out.push(p)
      if (out.length >= cap) break
    }
  }
  return out
}
