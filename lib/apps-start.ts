// THE APPS PAGE'S FIRST RUN — the rules (pure, client-safe; 2026-11-18).
//
// Nate, on a new wallet's Apps page reading "Nothing needs you right now":
// "pretty blank … make this a nice onboarding screen with some simple getting
// started text, maybe show the logos of all the apps they can try or a load
// your wallet with some ETH using credit card".
//
// Who sees it: a wallet the holdings read calls EMPTY, with nothing on the
// page saying otherwise. The holdings read covers wallet balances only, so
// money an open app reports (a Hyperliquid account, a position) or anything
// that needs the user turns the screen off. A failed read is not "empty".

import { appFamily, type AppFamily } from '@/lib/apps-page'
import { fleetRank } from '@/lib/free-fleet'
import type { SuggestedPrompt } from '@/lib/splash/types'

export const START_EYEBROW = 'GET STARTED'
export const START_HEADLINE = 'Add funds, then just ask.'

export interface StartAsk {
  family: AppFamily
  label: string
  prompt: string
}

/** Answers that cost the wallet nothing. Same words as each app's own first
 *  asks (lib/splash/sources). */
export const START_FREE_ASKS: readonly StartAsk[] = [
  { family: 'uniswap', label: 'Price of ETH', prompt: 'What is the current price of ETH in USDC on Uniswap?' },
  { family: 'snapshot', label: 'Find popular DAOs', prompt: 'What are the most active DAOs on Snapshot right now?' },
  { family: 'hyperliquid', label: 'Top markets', prompt: 'What are the top Hyperliquid markets by volume today?' },
  { family: 'opensea', label: 'Trending NFT collections', prompt: 'What NFT collections are trending on OpenSea right now?' },
]

/** Asks that move money. From an empty wallet the chat answers these with its
 *  funding step, which keeps the ask and resumes it when the money lands. */
export const START_FUNDED_ASKS: readonly StartAsk[] = [
  { family: 'uniswap', label: 'Swap $10 of ETH to USDC', prompt: 'Swap $10 of ETH to USDC' },
  { family: 'robinhood', label: 'Buy $10 of AAPL', prompt: 'Buy $10 of AAPL on Robinhood Chain' },
  { family: 'aave', label: 'Earn on 10 USDC', prompt: 'Supply 10 USDC to Aave on Ethereum' },
]

export interface StartRow<S> extends StartAsk {
  server: S
}

/** The rows this directory can honor: an ask whose app isn't listed is dropped,
 *  and a family with several listings answers with its free one. */
export function startRows<S extends { slug: string; name: string }>(servers: readonly S[]): { free: StartRow<S>[]; funded: StartRow<S>[] } {
  const ranked = [...servers].sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
  const pick = (asks: readonly StartAsk[]) =>
    asks.flatMap((ask) => {
      const server = ranked.find((s) => appFamily(s) === ask.family)
      return server ? [{ ...ask, server }] : []
    })
  return { free: pick(START_FREE_ASKS), funded: pick(START_FUNDED_ASKS) }
}

/** The chat's suggestions on this screen: free asks only (a "Buy $10" as a
 *  first suggestion to an empty wallet is a wall), and only from apps that are
 *  open, because a suggestion carries no app with it. */
export function startSuggestions(rows: { free: StartRow<{ slug: string }>[] }, activeSlugs: readonly string[], cap = 3): SuggestedPrompt[] {
  return rows.free
    .filter((r) => activeSlugs.includes(r.server.slug))
    .slice(0, cap)
    .map((r) => ({ label: r.label, prompt: r.prompt }))
}

export type StartPhase = 'deciding' | 'start' | 'off'

export function startPhase(s: {
  /** The holdings read: undefined in flight, null failed. */
  read: { empty: boolean } | null | undefined
  /** The page's own scan has settled. */
  ready: boolean
  totalUsd: number | null
  needs: number
  hidden: boolean
  /** A card purchase just landed: stay up to say so. */
  landed: boolean
}): StartPhase {
  if (s.landed) return 'start'
  if (s.hidden || s.read === null) return 'off'
  if (s.read === undefined) return 'deciding'
  if (!s.read.empty) return 'off'
  if (!s.ready) return 'deciding'
  return s.needs > 0 || (s.totalUsd != null && s.totalUsd > 0) ? 'off' : 'start'
}

export const startHiddenKey = (address: string) => `pantessa.apps.start.hidden.${address.toLowerCase()}`
