// The chat dock's pure rules (squad apps-page, DOCK lane, 2026-11-17; the app
// row and its picker re-cut 2026-11-19): how many app marks fit the row, what
// the picker lists and says about each app, and when a key press means "take
// me to the chat".
// No React, no DOM: scripts/apps-dock-pins.ts pins every rule here.

import { appFamily, type AppFamily } from '@/lib/apps-page'
import { fleetRank } from '@/lib/free-fleet'
import { cleanServerName } from '@/lib/utils'

// ── The app row ─────────────────────────────────────────────────────────────

/** The row's plan for its one line (2026-11-19). Every app that is on shows
 *  as its MARK alone (the name lives in the picker, the tooltip and the
 *  accessible name), followed by ONE button that opens the picker. `mark` is a
 *  mark's width, `gap` the space after each one, `add` the button with its
 *  words, `addCompact` the button as its icon. In order: every mark and the
 *  whole button; then every mark and the icon; then as many marks as fit with
 *  one seat kept for a "+N" count of the rest. An unmeasured row (no width
 *  yet) shows everything, so the first paint never hides an app. */
export function marksPlan(p: { width: number; count: number; mark: number; gap: number; add: number; addCompact: number }): {
  shown: number
  more: number
  compact: boolean
} {
  const need = (n: number, add: number) => n * (p.mark + p.gap) + add
  if (!(p.width > 0) || need(p.count, p.add) <= p.width) return { shown: p.count, more: 0, compact: false }
  if (need(p.count, p.addCompact) <= p.width) return { shown: p.count, more: 0, compact: true }
  const seats = Math.floor((p.width - p.addCompact) / (p.mark + p.gap))
  const shown = Math.max(0, Math.min(p.count - 1, seats - 1))
  return { shown, more: p.count - shown, compact: true }
}

interface ServerLike {
  id: string
  slug: string
  name: string
  gated?: boolean
  description?: string | null
  priceUsd?: number | string | null
}

const nameKey = (s: { name: string }) => cleanServerName(s.name).trim().toLowerCase()

/** The directory can carry two rows that read the same ("Aave" and "Aave
 *  (Free)"): offer each name once, never one already on the page. The first
 *  in the given order wins. */
export function onePerName<T extends { name: string }>(list: T[], onPage: { name: string }[] = []): T[] {
  const seen = new Set(onPage.map(nameKey))
  const out: T[] = []
  for (const s of list) {
    const k = nameKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

// ── The picker ────────────────────────────────────────────────────────────────

export type TrayView = 'free' | 'paid'

/** The picker's "More apps": every app NOT on the page, free (the fleet's order) or
 *  paid (as the catalog came). An app on the page is listed under "Your
 *  apps", so it is never listed twice. */
export function trayApps<T extends ServerLike>(servers: T[], activeIds: string[], view: TrayView): T[] {
  const on = new Set(activeIds)
  const rest = servers.filter((s) => !on.has(s.id))
  const list =
    view === 'free'
      ? rest.filter((s) => s.gated === false).sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
      : rest.filter((s) => s.gated !== false)
  return onePerName(list, servers.filter((s) => on.has(s.id)))
}

/** Most rows a search shows under "More apps" (the paid catalog is long). */
export const PICKER_SEARCH_MAX = 40

/** Does every word of `query` appear in the app's name, its one line or its
 *  slug? An empty query matches everything. */
export function pickerMatches(s: { slug: string; name: string; description?: string | null }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${cleanServerName(s.name)} ${trayLine(s)} ${s.slug}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The picker's two lists. `pinnedIds` is the set that was on WHEN THE PICKER
 *  OPENED, in its order: those rows are "Your apps" for as long as it stays
 *  open, so a row never jumps away from the cursor when its switch flips (an
 *  app switched off stays where it was, one tap from back). Everything else is
 *  "More apps": free or paid by the switch, or both at once while a search is
 *  typed (free first, capped). */
export function pickerSections<T extends ServerLike>(p: { servers: T[]; pinnedIds: string[]; view: TrayView; query: string }): { yours: T[]; more: T[] } {
  const q = p.query.trim()
  const byId = new Map(p.servers.map((s) => [s.id, s]))
  const yours = p.pinnedIds.map((id) => byId.get(id)).filter((s): s is T => !!s && pickerMatches(s, q))
  const more = q
    ? onePerName([...trayApps(p.servers, p.pinnedIds, 'free'), ...trayApps(p.servers, p.pinnedIds, 'paid')].filter((s) => pickerMatches(s, q))).slice(0, PICKER_SEARCH_MAX)
    : trayApps(p.servers, p.pinnedIds, p.view)
  return { yours, more }
}

/** What a first-party app adds to the page, in one plain line. The servers'
 *  own descriptions are written for a model (tool lists, "free and
 *  non-gated", API names); the picker speaks to a person. */
const FAMILY_LINE: Partial<Record<AppFamily, string>> = {
  uniswap: 'Swaps on Uniswap, quoted across every pool.',
  snapshot: 'DAO votes for the tokens you hold.',
  hyperliquid: 'Perps and spot, with a stop on every position.',
  cow: 'Limit orders that wait for your price.',
  near: 'Swaps from one chain to another.',
  aave: 'Lend and borrow. Puts idle stablecoins to work.',
  lido: 'Stake ETH and track your stETH.',
  morpho: 'Lending vaults on Base and Ethereum.',
  robinhood: 'Tokenized stocks and ETFs.',
  opensea: 'Your NFTs, with sell and transfer.',
}
const SLUG_LINE: Record<string, string> = {
  'yeetful-tool-wallet': 'Every token you hold, on every chain.',
  'yeetful-tool-funding': 'Finds the money for an ask from anywhere in your wallet.',
}

/** The first sentence of a description, with the catalog's boilerplate taken
 *  out, at most `max` characters (cut on a word, with an ellipsis). */
export function firstSentence(text: string | undefined | null, max = 96): string {
  let t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  // "X, free and non-gated: what it does" → "what it does".
  t = t.replace(/^[^:]{0,80}?,?\s*free and non-gated:\s*/i, '')
  t = t.replace(/\byeetful\b/gi, 'Pantessa')
  const end = t.search(/[.!?](\s|$)/)
  if (end > 0) t = t.slice(0, end + 1)
  if (t.length > max) {
    const cut = t.slice(0, max - 1)
    const sp = cut.lastIndexOf(' ')
    t = `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:(—-]+$/, '')}…`
  }
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function trayLine(s: { slug: string; name: string; description?: string | null }): string {
  if (SLUG_LINE[s.slug]) return SLUG_LINE[s.slug]
  const fam = appFamily(s)
  return FAMILY_LINE[fam] ?? firstSentence(s.description)
}

/** A paid row's price, "$0.01/call"; nothing when the price is unknown. */
export function trayPrice(s: { gated?: boolean; priceUsd?: number | string | null }): string | null {
  if (s.gated === false) return null
  const n = typeof s.priceUsd === 'string' ? Number(s.priceUsd) : s.priceUsd
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  return `$${n}/call`
}

// ── Finding the chat ────────────────────────────────────────────────────────

/** "/" with no modifier, pressed outside anything that takes typing, opens
 *  the dock and puts the cursor in the composer. */
export function isChatShortcut(e: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  target: { tagName?: string; isContentEditable?: boolean; type?: string } | null
}): boolean {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false
  const t = e.target
  if (!t) return true
  if (t.isContentEditable) return false
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (tag === 'INPUT') {
    const type = (t.type ?? 'text').toLowerCase()
    return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type)
  }
  return true
}

/** The composer's placeholder in the dock, with the shortcut named. */
export const DOCK_SHORTCUT_HINT = 'Press / from anywhere on the page to type here.'
