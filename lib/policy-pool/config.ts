// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — runtime config (BUILDER lane owns this file)
//
//  One hooked Uniswap v4 pool, addressed by its key. Every surface reads the
//  env through here and nowhere else; `policyPoolConfig()` is null while
//  POLICY_POOL_HOOK is unset (feature off — surfaces say "not deployed yet").
//  Env shape (fixed in /Users/nate/pantessa/squad-policy-pool-2026-11-02/README.md):
//    POLICY_POOL_CHAIN_ID=84532|8453   POLICY_POOL_HOOK=0x…
//    POLICY_POOL_CURRENCY0=0x0         POLICY_POOL_CURRENCY1=0x…
//    POLICY_POOL_FEE=500               POLICY_POOL_TICK_SPACING=10
//    POLICY_POOL_DEPLOY_BLOCK=<n>      POLICY_SIGNER_ADDRESS=0x…
//    POLICY_SIGNER_PRIVATE_KEY=0x…     POLICY_POOL_MAX_USD=500
//  Pure except `policyPoolClient` (a viem client for the pool's chain).
// ─────────────────────────────────────────────────────────────────────────

import { createPublicClient, fallback, getAddress, http, isAddress, type Address, type Chain, type Hex, type PublicClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { BASE_SEPOLIA_CHAIN_ID, chainById, publicClientFor, uniswapV4PinsFor, type UniswapV4Pins } from '@/lib/chains'
import { poolIdFor, type PoolKeyLike } from '@/lib/policy-pool/spec'
import { policyCapUsd } from '@/lib/policy-pool/policy'

/** The venue slug an ask / a desk call names ("venue: 'policy-pool'"). */
export const POLICY_POOL_VENUE = 'policy-pool' as const
/** The build path stamped on a policy-pool swap (build_path attribution, fee tiers). */
export const POLICY_POOL_BUILD_PATH = 'native-swap-policy-pool' as const
/** The refresh recipe kind the SendTxChain card re-quotes through. */
export const POLICY_POOL_REFRESH_KIND = 'policy-pool-swap' as const

export const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000'

export interface PolicyPoolConfig {
  chainId: number
  chainName: string
  hook: Address
  /** The policy signer the hook trusts (POLICY_SIGNER_ADDRESS). */
  signer: Address
  poolKey: PoolKeyLike & { hooks: Address }
  poolId: Hex
  /** Per-order cap in dollars (POLICY_POOL_MAX_USD, default 500 — lib/policy-pool/policy). */
  maxUsd: number
  /** The block the hook was deployed at, for the indexer's first scan; null when unset. */
  deployBlock: number | null
  /** The chain's Universal Router / Quoter / Permit2 (lib/chains UNISWAP_V4_PINS). */
  pins: UniswapV4Pins
  /** True on Base mainnet: the demo runner refuses here without Nate's explicit yes (rule 4). */
  mainnet: boolean
}

function intEnv(v: string | undefined): number | null {
  const s = v?.trim()
  if (!s || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

function addrEnv(v: string | undefined): Address | null {
  const s = v?.trim()
  return s && isAddress(s) ? getAddress(s) : null
}

/** Human name for the pool's chain (testnets are not AppChains). */
export function policyPoolChainName(chainId: number): string {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return 'Base Sepolia'
  return chainById(chainId)?.name ?? `chain ${chainId}`
}

/**
 * The pool from env, or null when the feature is off (POLICY_POOL_HOOK unset).
 * A HOOK that is set beside a malformed sibling value throws by name — a
 * half-configured pool must never read as "off" and silently route elsewhere.
 */
export type EnvLike = Record<string, string | undefined>

export function policyPoolConfig(env: EnvLike = process.env): PolicyPoolConfig | null {
  const hookRaw = env.POLICY_POOL_HOOK?.trim()
  if (!hookRaw) return null
  const hook = addrEnv(hookRaw)
  if (!hook) throw new Error('POLICY_POOL_HOOK is set but is not an address.')
  // A zero hook would attest swaps into a pool that enforces nothing — the
  // signature would be theatre. Refused by name, never read as "off".
  if (hook.toLowerCase() === NATIVE_CURRENCY) throw new Error('POLICY_POOL_HOOK is the zero address — an unhooked pool enforces no policy; set the deployed PolicyPoolHook.')
  const chainId = intEnv(env.POLICY_POOL_CHAIN_ID)
  if (chainId === null) throw new Error('POLICY_POOL_CHAIN_ID must be a chain id (84532 or 8453).')
  const pins = uniswapV4PinsFor(chainId)
  if (!pins) throw new Error(`No Uniswap v4 pins for chain ${chainId} (lib/chains UNISWAP_V4_PINS) — the policy pool can't be built there.`)
  const currency0 = addrEnv(env.POLICY_POOL_CURRENCY0)
  const currency1 = addrEnv(env.POLICY_POOL_CURRENCY1)
  if (!currency0 || !currency1) throw new Error('POLICY_POOL_CURRENCY0 / POLICY_POOL_CURRENCY1 must both be addresses.')
  if (currency0.toLowerCase() >= currency1.toLowerCase()) throw new Error('POLICY_POOL_CURRENCY0 must sort below POLICY_POOL_CURRENCY1 (v4 pool keys are ordered).')
  const fee = intEnv(env.POLICY_POOL_FEE)
  const tickSpacing = intEnv(env.POLICY_POOL_TICK_SPACING)
  if (fee === null || fee > 0xffffff) throw new Error('POLICY_POOL_FEE must be a fee in pips (e.g. 500).')
  if (tickSpacing === null || tickSpacing <= 0 || tickSpacing > 0x7fffff) throw new Error('POLICY_POOL_TICK_SPACING must be a positive tick spacing (e.g. 10).')
  const signer = addrEnv(env.POLICY_SIGNER_ADDRESS)
  if (!signer) throw new Error('POLICY_SIGNER_ADDRESS must be the policy signer address the hook trusts.')
  const poolKey = { currency0, currency1, fee, tickSpacing, hooks: hook }
  return {
    chainId,
    chainName: policyPoolChainName(chainId),
    hook,
    signer,
    poolKey,
    poolId: poolIdFor(poolKey),
    maxUsd: policyCapUsd(env as NodeJS.ProcessEnv),
    deployBlock: intEnv(env.POLICY_POOL_DEPLOY_BLOCK),
    pins,
    mainnet: chainId === 8453,
  }
}

/** The pool is configured AND lives on this chain. */
export function isPolicyPoolChain(chainId: number, env: EnvLike = process.env): boolean {
  try {
    return policyPoolConfig(env)?.chainId === chainId
  } catch {
    return false
  }
}

// ── A viem client for the pool's chain ──────────────────────────────────────
// First-class chains reuse lib/chains' cached clients. Base Sepolia is not
// an AppChain, so it gets its own: Alchemy's base-sepolia JSON-RPC when the
// key is present (bearer header, never in the URL viem prints), viem's chain
// default (sepolia.base.org) as the fallback. Cached per process.
let sepoliaClient: PublicClient | null = null

export function policyPoolClient(chainId: number): PublicClient | null {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    if (!sepoliaClient) {
      const key = typeof window === 'undefined' ? process.env.ALCHEMY_API_KEY : undefined
      const endpoints = key ? [http('https://base-sepolia.g.alchemy.com/v2/', { fetchOptions: { headers: { Authorization: `Bearer ${key}` } } })] : []
      sepoliaClient = createPublicClient({ chain: baseSepolia as Chain, transport: endpoints.length ? fallback([...endpoints, http()]) : http() })
    }
    return sepoliaClient
  }
  return publicClientFor(chainId)
}

/** Explorer tx prefix for the pool's chain. */
export function policyPoolExplorerTx(chainId: number): string {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return 'https://sepolia.basescan.org/tx/'
  return chainById(chainId)?.explorerTx ?? ''
}
