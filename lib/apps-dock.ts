// The chat dock's pure rules (squad apps-page, DOCK lane, 2026-11-17): how
// many offered app chips fit the row, what the "Browse all" tray lists and
// says about each app, and when a key press means "take me to the chat".
// No React, no DOM: scripts/apps-dock-pins.ts pins every rule here.

import { appFamily, type AppFamily } from '@/lib/apps-page'
import { fleetRank } from '@/lib/free-fleet'
import { cleanServerName } from '@/lib/utils'

// ── The chip row ────────────────────────────────────────────────────────────

/** How many of the offered (off) chips fit in `available` px, in order, with
 *  `gap` px before each one. Never a partial chip; a non-positive room or a
 *  missing measurement (0 or less) stops the count there, so a chip that has
 *  not been measured yet is never shown on a guess. */
export function fitOffered(available: number, widths: number[], gap: number): number {
  let used = 0
  let n = 0
  for (const w of widths) {
    if (!(w > 0)) break
    const next = used + gap + w
    if (next > available) break
    used = next
    n += 1
  }
  return n
}

/** The row's plan for its one line. `onFull` / `onCompact` are each on-chip's
 *  width with its name and with its mark alone; `browse` is "Browse all".
 *  The names show whenever every on-chip fits with them; otherwise the
 *  on-chips go to marks (the name stays in the tooltip and the accessible
 *  name); if even the marks do not fit, the list scrolls sideways. Offered
 *  chips only take what is left, and only while every name shows. */
export function rowPlan(p: { width: number; onFull: number[]; onCompact: number[]; browse: number; browseCompact?: number; offered: number[]; gap: number }): {
  compact: boolean
  fit: number
  overflowing: boolean
} {
  const fixed = (ws: number[], browse: number) => ws.reduce((sum, w) => sum + w + p.gap, 0) + browse
  const fullRoom = p.width - fixed(p.onFull, p.browse)
  const compact = fullRoom < 0 && p.onCompact.length > 0
  const room = compact ? p.width - fixed(p.onCompact, p.browseCompact ?? p.browse) : fullRoom
  return { compact, fit: room > 0 && !compact ? fitOffered(room, p.offered, p.gap) : 0, overflowing: room < -1 }
}

/** Most offered chips the row ever considers (the rest live in the tray). */
export const OFFERED_MAX = 8

interface ServerLike {
  id: string
  slug: string
  name: string
  gated?: boolean
  description?: string | null
  priceUsd?: number | string | null
}

/** The off apps the row offers, best first: free first-party apps only
 *  (never an internal utility, never a paid one), in the fleet's order. */
export function offeredApps<T extends ServerLike>(servers: T[], activeIds: string[], cap = OFFERED_MAX): T[] {
  const on = new Set(activeIds)
  const picked = servers
    .filter((s) => !on.has(s.id) && s.gated === false && !/^yeetful-tool-/.test(s.slug))
    .sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
  return onePerName(picked, servers.filter((s) => on.has(s.id))).slice(0, cap)
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

// ── The tray ────────────────────────────────────────────────────────────────

export type TrayView = 'free' | 'paid'

/** The tray's list: every app NOT on the page, free (the fleet's order) or
 *  paid (as the catalog came). An app on the page is removed from the row,
 *  so the tray never lists it twice. */
export function trayApps<T extends ServerLike>(servers: T[], activeIds: string[], view: TrayView): T[] {
  const on = new Set(activeIds)
  const rest = servers.filter((s) => !on.has(s.id))
  const list =
    view === 'free'
      ? rest.filter((s) => s.gated === false).sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
      : rest.filter((s) => s.gated !== false)
  return onePerName(list, servers.filter((s) => on.has(s.id)))
}

/** What a first-party app adds to the page, in one plain line. The servers'
 *  own descriptions are written for a model (tool lists, "free and
 *  non-gated", API names); the tray speaks to a person. */
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
