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
// A TYPED ask lights the first-party apps its sentence needs too, under the
// narrower typedAskAppSlugs rule (2026-09-24); the route's belt (followAskApps)
// covers a send that didn't, and the add-the-dapp door is what an EMBED turn
// (host-owned set) still meets.
//
// Pure: no browser APIs, no server imports. The harness proves every chip a
// surface composes lands on its gate with these apps (scripts/test-api.ts,
// "apps follow the ask").

import { composeMcps, isCrossChainAsk } from '@/lib/intent-links'
import { moneyShaped } from '@/lib/ask-failure-shape'

/** The slugs a chip's ask runs with — composeMcps without the link cap (a
 *  link carries ≤4; a chip only ADDS to a set that's already there). */
export function askAppSlugs(ask: string): string[] {
  return composeMcps(ask, Infinity)
}

/**
 * The slugs a TYPED ask runs with (2026-09-24). Until now a typed ask kept
 * the user's own set and met the add-the-dapp door: "Supply $25 of USDC to
 * Aave" on the default set answered "it just needs the Aave dapp — click
 * here, then press send again", two extra steps on a phone for a visitor
 * who never knew the rail was a prerequisite. The rail is a RECORD of what
 * the chat used now, not a checklist: a money-shaped ask adds the
 * first-party apps its sentence composes, additively, before it sends.
 *
 * Narrower than a chip's rule on purpose:
 *   - only a MONEY-SHAPED ask (lib/ask-failure-shape, the intent net's own
 *     door) — "how long does a bridge take" never lights Hyperliquid on
 *     the word "long";
 *   - NEAR Intents rides only when the sentence IS a cross-chain move. A
 *     same-chain buy that turns out to need a funding leg gets NEAR from
 *     the route's own belt (followAskApps) at the door, not from here.
 * The embed never reaches this: its set is its host's.
 */
export function typedAskAppSlugs(ask: string): string[] {
  if (!moneyShaped(ask)) return []
  const slugs = askAppSlugs(ask)
  return isCrossChainAsk(ask) ? slugs : slugs.filter((s) => !NEAR_SLUGS.has(s))
}

const NEAR_SLUGS = new Set(['near-intents-mcp-yeetful', 'near-intents-free', 'near-intents'])

/**
 * The first-party FREE apps a send may turn on without asking. The catalog
 * carries custom rows (a user's own MCP, gated:false once approved) and paid
 * x402 rows; neither is ever added to a set on a sentence's say-so — those
 * keep the door (SECURITY-AUDIT-2026-09-08 §A: only the user lights a
 * third-party row). The list is the free fleet + the internal
 * `yeetful-tool-*` utilities, on every spelling the databases use
 * (APP_FAMILIES).
 */
export const FIRST_PARTY_APP_SLUGS: ReadonlySet<string> = new Set([
  'uniswap-free',
  'snapshot-free',
  'cow-free',
  'hyperliquid-free',
  'hyperliquid',
  'opensea-free',
  'robinhood-free',
  'aave',
  'aave-free',
  'morpho-free',
  'morpho',
  'lido-free',
  'lido',
  'near-intents-mcp-yeetful',
  'near-intents-free',
  'near-intents',
])

export function isFirstPartyApp(row: AppRow): boolean {
  return row.gated === false && (FIRST_PARTY_APP_SLUGS.has(row.slug) || row.slug.startsWith('yeetful-tool-'))
}

/**
 * The route's belt behind typedAskAppSlugs: the apps a typed ask needs that
 * the set it arrived with doesn't carry, resolved against the live directory
 * and fenced to first-party free rows. Pure — the route hands it the catalog
 * it already loaded. Every door site (Aave, Morpho, Lido, the guardian, the
 * cross-chain swap) reads `activeServers` for its agent, so adding the row
 * here answers the BUILD where the door used to be; the response echoes
 * `addedMcps` so the client lights the rail and offers the undo.
 */
export function followAskApps<T extends AppRow>(ask: string, active: readonly T[], catalog: readonly T[]): T[] {
  const slugs = typedAskAppSlugs(ask)
  if (slugs.length === 0) return []
  const firstParty = catalog.filter(isFirstPartyApp)
  const activeIds = new Set(active.map((r) => r.id))
  const activeSlugs = new Set(active.map((r) => r.slug))
  const out: T[] = []
  for (const id of resolveAppIds(slugs, firstParty)) {
    const row = firstParty.find((r) => r.id === id)
    if (!row || activeIds.has(row.id) || activeSlugs.has(row.slug) || out.some((r) => r.id === row.id)) continue
    out.push(row)
  }
  return out
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
