// Wallet-affinity probe: has this wallet actually USED a protocol? The splash
// only paints a protocol card when the answer is yes — "no history, no card"
// (Nate, 2026-07-10). Most MCPs answer this through their own account APIs
// (CoW orders, Snapshot follows, Hyperliquid account, Aave positions — their
// splash sources return null when the account is empty). Uniswap is the
// exception: its card is a generic wallet portfolio, so "uses Uniswap" needs
// an on-chain look — did this wallet's recent transfers ever touch a Uniswap
// router?
//
// Coverage is honest-but-partial by construction: the Alchemy transfers API
// only surfaces value-moving transfers, so we see ETH-input swaps (external
// user → router), ETH-output swaps (external router → user), and v4 token
// output (PoolManager → user). A pure token→token v3 swap moves tokens
// user ↔ pool directly and is invisible here — a false negative, never a
// false positive. Probe failure returns null (unknown) and callers fail OPEN:
// better to show a card too many than hide one on a flaky RPC.

import { alchemyEnabled, transferCounterparties } from '@/lib/alchemy'

/**
 * Uniswap contracts a swap tx or its output touches, per Alchemy network —
 * every Universal Router generation, the v3 SwapRouters, the v2 router, and
 * the v4 PoolManager (which pays out v4 token output directly). All
 * lowercase; membership checks are local so extra addresses cost nothing.
 * Sources: developers.uniswap.org/contracts/v4/deployments + the older
 * per-chain deployment tables (verified 2026-07-10).
 */
export const UNISWAP_CONTRACTS: Record<string, string[]> = {
  'eth-mainnet': [
    '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Universal Router (v4 era)
    '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', // Universal Router 2.1.1
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router 1.2
    '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', // Universal Router (original)
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // SwapRouter02 (v3)
    '0xe592427a0aece92de3edee1f18e0157c05861564', // SwapRouter (v3)
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // V2 Router02
    '0x000000000004444c5dc75cb358380d2e3de08a90', // v4 PoolManager
  ],
  'base-mainnet': [
    '0x6ff5693b99212da76ad316178a184ab56d299b43', // Universal Router (v4 era)
    '0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7', // Universal Router 2.1.1
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router 1.2
    '0x198ef79f1f515f02dfe9e3115ed9fc07183f02fc', // Universal Router (original Base)
    '0x2626664c2603336e57b271c5c0b26f421741e481', // SwapRouter02 (v3)
    '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // V2 Router02
    '0x498581ff718922c3f8e6a244956af099b2652b2b', // v4 PoolManager
  ],
  'arb-mainnet': [
    '0xa51afafe0263b40edaef0df8781ea9aa03e381a3', // Universal Router (v4 era)
    '0x8b844f885672f333bc0042cb669255f93a4c1e6b', // Universal Router 2.1.1
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router 1.2
    '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', // Universal Router (original)
    '0x4c60051384bd2d3c01bfc845cf5f4b44bcbe9de5', // Universal Router (first deploy)
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // SwapRouter02 (v3)
    '0xe592427a0aece92de3edee1f18e0157c05861564', // SwapRouter (v3)
    '0x360e68faccca8ca495c1b759fd9eee466db9fb32', // v4 PoolManager
  ],
  // Robinhood Chain (Arbitrum Orbit, chain 4663) — Uniswap v4 is live there
  // from day one (blog.uniswap.org/robinhood-chain-is-live); addresses from
  // developers.uniswap.org/contracts/v4/deployments (verified 2026-07-13).
  'robinhood-mainnet': [
    '0x8876789976decbfcbbbe364623c63652db8c0904', // Universal Router (v4 era)
    '0x8366a39cc670b4001a1121b8f6a443a643e40951', // v4 PoolManager
  ],
}

/** Pure membership check (exported for tests): did any counterparty land in
 *  the contract set? Both sides lowercase. */
export function touchesContracts(counterparties: string[], contracts: string[]): boolean {
  const set = new Set(contracts)
  return counterparties.some((c) => set.has(c))
}

// In-memory per-wallet cache. Interaction history only ever grows, so a
// positive is durable (24h); a negative can flip the moment they swap (10min).
// Per-instance on serverless — a cold start just re-probes.
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { value: boolean; at: number }>()

/**
 * Has this wallet's recent transfer history touched a Uniswap router on
 * Ethereum, Base, Arbitrum, or Robinhood Chain? true / false / null = unknown
 * (no Alchemy key or every probe failed — callers treat unknown as "show the
 * card").
 */
export async function hasUniswapHistory(address: string): Promise<boolean | null> {
  if (!alchemyEnabled()) return null
  const key = address.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < (hit.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) return hit.value

  const jobs = Object.entries(UNISWAP_CONTRACTS).flatMap(([net, contracts]) =>
    (['from', 'to'] as const).map((direction) =>
      transferCounterparties(net, address, direction)
        .then((cps) => touchesContracts(cps, contracts))
        .catch(() => null),
    ),
  )
  const results = await Promise.all(jobs)
  if (results.every((r) => r === null)) return null // all probes failed — unknown, don't cache
  const value = results.some((r) => r === true)
  cache.set(key, { value, at: Date.now() })
  return value
}
