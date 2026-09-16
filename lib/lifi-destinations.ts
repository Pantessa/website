// ─────────────────────────────────────────────────────────────────────────
//  LiFi funding DESTINATIONS — the chains a wallet's money is bridged ONTO
//  by the funding plan (lib/lifi-bridge.ts) because NEAR Intents can't
//  deliver there. Pure and client-safe on purpose, like lib/funding-origins:
//  the jobs grammar, the wallet flags and the chat copy all read this table
//  without pulling the bridge module's DB + LiFi imports into the bundle.
//
//  Robinhood Chain (4663) was the only member from 2026-07-15 to 2026-09-16;
//  Circle's Arc (5042) joined on its mainnet day. The two differ in ONE
//  fact that every consumer must respect: on Robinhood Chain gas is ETH, so
//  a plan may need a separate gas leg (origin USDC → native ETH); on Arc
//  the gas token IS USDC, so the value leg is the gas — `gasLeg: false`
//  and "including gas" is never part of an Arc funding sentence.
// ─────────────────────────────────────────────────────────────────────────

export interface LifiDestination {
  chainId: number
  /** The registry key (lib/chains). */
  key: 'robinhood' | 'arc'
  /** Display name ("Robinhood Chain", "Arc"). */
  name: string
  /** The lower-case word the funding grammar reads after "fund" — the parse
   *  contract with lib/jobs parseRobinhoodFunding ("fund robinhood chain
   *  with $12 from base", "fund arc with $12 from base"). */
  word: string
  /** True when a SEPARATE native-gas leg exists (ETH gas); false when the
   *  landed stable pays gas itself. */
  gasLeg: boolean
}

export const ROBINHOOD_CHAIN_ID = 4663
export const ARC_CHAIN_ID = 5042

export const LIFI_DESTINATIONS: Readonly<Record<number, LifiDestination>> = {
  [ROBINHOOD_CHAIN_ID]: { chainId: ROBINHOOD_CHAIN_ID, key: 'robinhood', name: 'Robinhood Chain', word: 'robinhood chain', gasLeg: true },
  // LiFi routes Base / Ethereum USDC → Arc USDC through the SAME canonical
  // origin diamond as the Robinhood legs (probed live 2026-09-16: Base via
  // across in 4s / relaydepository in 1s, Ethereum via across in 2s, ~$0.04
  // of fees on $10; Arbitrum only via Polymer at ~18 min). The bridge
  // module pins the fast tools for this destination.
  [ARC_CHAIN_ID]: { chainId: ARC_CHAIN_ID, key: 'arc', name: 'Arc', word: 'arc', gasLeg: false },
}

/** The destination record for a chain id, or null when the chain is not a
 *  LiFi-funded destination (its money moves on the NEAR Intents plan). */
export function lifiDestination(chainId: number | null | undefined): LifiDestination | null {
  return (chainId != null && LIFI_DESTINATIONS[chainId]) || null
}

export const isLifiFundedChain = (chainId: number | null | undefined): boolean => lifiDestination(chainId) !== null

/** Every destination, Robinhood Chain first (registry order). */
export const LIFI_DESTINATION_CHAINS: readonly number[] = [ROBINHOOD_CHAIN_ID, ARC_CHAIN_ID]

/** One funding-ask segment: lib/jobs.ts parseRobinhoodFunding's grammar.
 *  A non-USDC token rides the "using usdc.e" / "using eth" clause (before
 *  "including gas"); a gas-less destination never carries "including gas"
 *  whatever the caller asked — the sentence must round-trip the parser. */
export function fundSegment(usd: number, originWord: string, gas: boolean, token = 'USDC', dest: LifiDestination = LIFI_DESTINATIONS[ROBINHOOD_CHAIN_ID]): string {
  return `Fund ${dest.word} with $${usd} from ${originWord.toLowerCase()}${token === 'USDC' ? '' : ` using ${token.toLowerCase()}`}${gas && dest.gasLeg ? ' including gas' : ''}`
}
