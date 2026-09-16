// Apps follow the ask — the dapps a COMPOSED ask needs in the chat's set, and
// how to find them in whichever directory the page loaded.
//
// A chip is a sentence one of our own surfaces wrote: a /markets row, the
// EARN board, a /t order, a chart level, a clarify chip, the ask door. The
// venue gates in the chat route refuse to build without their dapp in the
// set — "Supplying to Aave runs right here — it just needs the Aave dapp in
// this chat's set" answered a tap on the EARN board's Aave row, and "2x Short
// $25 of HYPE on Hyperliquid" hit the same wall (prod, 2026-09-16,
// /p/WVONZuJSbfra). The page that composed the sentence knows what it needs,
// so before a chip's ask sends, the set gains the dapps that sentence
// composes: the SAME set an intent link for it opens with (lib/intent-links
// composeMcps, uncapped), NEAR Intents riding along as the funding companion
// for an ask that has to bridge first.
//
// A TYPED ask keeps the user's own set; the route's add-the-dapp door still
// answers it.
//
// Pure: no browser APIs, no server imports. The harness proves every chip a
// surface composes lands on its gate with these apps (scripts/test-api.ts,
// "apps follow the ask").

import { composeMcps } from '@/lib/intent-links'

/** The slugs a chip's ask runs with — composeMcps without the link cap (a
 *  link carries ≤4; a chip only ADDS to a set that's already there). */
export function askAppSlugs(ask: string): string[] {
  return composeMcps(ask, Infinity)
}

/** The directory fields the resolver reads — satisfied by McpServer. */
export interface AppRow {
  id: string
  slug: string
  name: string
  endpoint?: string | null
  gated?: boolean
}

/**
 * One dapp, however a database spelled it. The route recognizes a venue's
 * dapp by NAME (lib/aave-supply aaveAgentOf `/\baave\b/`, lib/morpho-supply
 * morphoAgentOf, lib/lido-stake lidoAgentOf, lib/hyperliquid-exec hlAgentOf,
 * lib/swap-intent crossChainAgentOf), while the slugs drift: prod's Aave row
 * is `aave` but the seed script and the route's own "Add Aave with this ask
 * ready" link say `aave-free`; NEAR Intents is `near-intents-mcp-yeetful` on
 * prod and `near-intents-free` in the seed; lib/symbol-venues says
 * `near-intents`. A slug in a family resolves to the first alias the loaded
 * directory has, then to a FREE row the route would recognize — never a paid
 * catalog row that merely shares the word.
 */
const APP_FAMILIES: ReadonlyArray<{ slugs: readonly string[]; recognizes: (r: AppRow) => boolean }> = [
  { slugs: ['aave', 'aave-free'], recognizes: (r) => /\baave\b/i.test(`${r.slug} ${r.name}`) },
  { slugs: ['morpho-free', 'morpho'], recognizes: (r) => /\bmorpho\b/i.test(`${r.slug} ${r.name}`) },
  { slugs: ['lido-free', 'lido'], recognizes: (r) => /\blido\b/i.test(`${r.slug} ${r.name}`) },
  // hlAgentOf reads the slug `hyperliquid-free` or the NAME, never another slug.
  { slugs: ['hyperliquid-free', 'hyperliquid'], recognizes: (r) => /hyperliquid/i.test(r.name) },
  // crossChainAgentOf also accepts "cross-chain" anywhere in a description;
  // the resolver only lights a row that IS NEAR Intents.
  { slugs: ['near-intents-mcp-yeetful', 'near-intents-free', 'near-intents'], recognizes: (r) => /\bnear[\s-]?intents\b/i.test(`${r.slug} ${r.name}`) },
]

function resolveOne<T extends AppRow>(slug: string, rows: readonly T[]): T | null {
  const exact = rows.find((r) => r.slug === slug)
  if (exact) return exact
  const family = APP_FAMILIES.find((f) => f.slugs.includes(slug))
  if (!family) return null
  for (const alias of family.slugs) {
    const hit = rows.find((r) => r.slug === alias)
    if (hit) return hit
  }
  // A free row the route recognizes by name — one with an endpoint first (the
  // route calls an add-MCP shell row "not fully connected" and builds nothing).
  const named = rows.filter((r) => r.gated === false && family.recognizes(r))
  return named.find((r) => !!r.endpoint) ?? named[0] ?? null
}

/** Directory ids for these slugs, deduped, in order. An unknown slug is
 *  skipped: the send still goes, and the route's refusal names what to add. */
export function resolveAppIds<T extends AppRow>(slugs: readonly string[], rows: readonly T[]): string[] {
  const ids: string[] = []
  for (const slug of slugs) {
    const row = resolveOne(slug, rows)
    if (row && !ids.includes(row.id)) ids.push(row.id)
  }
  return ids
}

/** The ids a send still has to turn on before it fires. */
export function missingAppIds<T extends AppRow>(slugs: readonly string[], rows: readonly T[], activeIds: readonly string[]): string[] {
  return resolveAppIds(slugs, rows).filter((id) => !activeIds.includes(id))
}
