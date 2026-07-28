// First-party "house" intent links — the canonical demo set, minted with
// deterministic slugs so landing CTAs and docs can reference them forever.
// Single source: the seed script (scripts/seed-house-links.ts), the landing
// spread (components/LinkEconomy.tsx), and the /links start-here strip all read
// THIS list. House links have creator=null: they earn nothing and never
// appear in any creator's dashboard — they exist so the leaderboard and the
// landing never demo an empty product.

import { composeMcps } from '@/lib/intent-links'

export type HouseLink = {
  slug: string
  ask: string
  label: string
  /** Extra mark keys for venues the runtime uses but composeMcps can't see —
   *  native layers build most asks with no MCP at all (the ETH DCA swaps on
   *  Uniswap without the uniswap MCP in the set). Resolved by
   *  getProtocolMark, so any registry-matchable key works. */
  venueMarks?: string[]
}

export const HOUSE_LINKS: HouseLink[] = [
  { slug: 'buy-aapl', ask: 'Buy $10 of AAPL', label: 'Buy a stock' },
  // The recurring buy builds on the Uniswap venue (native swap layer — no
  // MCP in the set), so the venue mark is declared here.
  { slug: 'dca-eth', ask: 'DCA $25 into ETH weekly', label: 'Set a recurring buy', venueMarks: ['uniswap'] },
  { slug: 'stake-eth', ask: 'Stake 0.05 ETH with Lido', label: 'Stake ETH' },
  // The Guardian/jobs aha as a PURE intent — the visitor asks for the
  // position; the system discovers the empty HL account and offers the whole
  // funding path itself (deposit prepended, bridge legs from wherever the
  // USDC lives) as one job chip. The plumbing is the demo, not the ask.
  // Retired predecessors stay live in the DB, just unsurfaced: /i/stop-loss
  // (assumed an open position) and the verbose four-clause phrasing.
  // Explicit leverage is REAL here (2026-07-23): the build signs a guarded
  // updateLeverage (2x cross) ahead of the order — never decorative copy.
  {
    slug: 'protected-long',
    ask: 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
    label: 'Open & protect a position — funding handled for you',
  },
  { slug: 'bridge-usdc', ask: 'Swap 5 USDC from Base to Arbitrum', label: 'Move stables across chains' },
  { slug: 'my-nfts', ask: 'Show my NFTs', label: 'Browse your NFTs' },
]

/** Short display names for mark keys — tooltips only, so they stay terse.
 *  Unknown keys fall back to the key itself. */
const MARK_NAMES: Record<string, string> = {
  uniswap: 'Uniswap',
  'robinhood-free': 'Robinhood',
  'hyperliquid-free': 'Hyperliquid',
  'opensea-free': 'OpenSea',
  'lido-free': 'Lido',
  aave: 'Aave',
  'snapshot-free': 'Snapshot',
  'cow-free': 'CoW',
  'near-intents-mcp-yeetful': 'NEAR Intents',
  'yeetful-tool-wallet': 'Yeetful wallet',
}

/** The marks a house-link chip wears — the apps this ask actually runs
 *  through. Derived from composeMcps (the REAL set the /i runtime opens
 *  with, NEAR Intents included as the cross-chain companion) plus any
 *  declared venue marks, so the chips stay in sync as compose evolves.
 *  Capped at 3, like the chat's responder stack. */
export function houseLinkMarks(link: HouseLink): Array<{ key: string; name: string }> {
  const keys = [...(link.venueMarks ?? []), ...composeMcps(link.ask)]
  return [...new Set(keys)].slice(0, 3).map((key) => ({ key, name: MARK_NAMES[key] ?? key }))
}
