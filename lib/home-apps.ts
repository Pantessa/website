// THE APPS ROW on the splash (2026-10-13 — Nate: "a row with all the logos as
// an entry into the apps page; when they click it shows the MCP that they
// clicked is selected … allow users to click apps without needing to sign
// into the wallet"). It sits where the guide card sat. Every logo is a real
// link to the chat's APPS drawer with that one app on — the chat's own
// `?mcps=` deep link (components/ChatWorkspace resolves it through
// lib/ask-apps' families, so prod's `aave` and the seed's `aave-free` both
// land) with `?tab=mcps` so the drawer is the first thing shown. The chat
// surface is public to LOOK at (lib/app-entry isPublicAppPath), so a stranger
// arrives on the drawer with no door; the wallet is asked for when they act.
//
// Pure: the table and the hrefs. Pinned by scripts/home-apps-pins.ts; drawn
// by components/home/AppsRow.tsx.

export interface HomeApp {
  /** The directory slug (prod's spelling where the two differ; the families resolve the rest). */
  slug: string
  name: string
  /** One line, what it does here. */
  does: string
}

/** The first-party fleet, in the order a stranger should meet it: where the
 *  money moves first, then where it earns, then the rest. */
export const HOME_APPS: readonly HomeApp[] = [
  { slug: 'uniswap-free', name: 'Uniswap', does: 'spot swaps on Base, Ethereum, Arbitrum and Optimism' },
  { slug: 'robinhood-free', name: 'Robinhood Chain', does: 'tokenized stocks, 24/7' },
  { slug: 'hyperliquid-free', name: 'Hyperliquid', does: 'perps, and a stop that acts' },
  { slug: 'cow-free', name: 'CoW', does: 'MEV-protected swaps and limit orders' },
  { slug: 'aave', name: 'Aave', does: 'supply, borrow, repay' },
  { slug: 'morpho-free', name: 'Morpho', does: 'lend on curated markets' },
  { slug: 'lido-free', name: 'Lido', does: 'stake ETH' },
  { slug: 'near-intents', name: 'NEAR Intents', does: 'any chain to any chain' },
  { slug: 'opensea-free', name: 'OpenSea', does: 'NFTs — list, buy, send' },
  { slug: 'snapshot-free', name: 'Snapshot', does: 'DAO votes, signed by you' },
  { slug: 'yeetful-tool-wallet', name: 'Pantessa wallet', does: 'your balances on every chain' },
]

/** The drawer with every app: the spine's own APPS destination. */
export const HOME_APPS_ALL_HREF = '/chat?tab=mcps'

/** The drawer open with this one app on (the chat's `?mcps=` deep link). */
export function homeAppHref(slug: string): string {
  return `/chat?tab=mcps&mcps=${encodeURIComponent(slug)}`
}

export const HOME_APPS_EYEBROW = 'Your apps · every dapp, one chat'
export const HOME_APPS_WHY = 'Pick one and the chat opens with it on. A wallet is asked for when you act, never to look.'
