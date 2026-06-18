// Launchpad contracts (x402-launch). Shared by the client (the Launch button
// writes `factory.launch`) and the server (reads `factory.mcpById` to confirm a
// launch — the on-chain registry IS our index, so no listener/indexer needed).

import { createPublicClient, http, getAddress, zeroAddress, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'

/** The launchpad chain. NEXT_PUBLIC_ so the client reads the same value. */
export const LAUNCH_CHAIN =
  (process.env.NEXT_PUBLIC_LAUNCH_CHAIN ?? process.env.LAUNCH_CHAIN) === 'base' ? base : baseSepolia

/** Deployed YeetfulLaunchFactory (Base Sepolia default; override per env/chain). */
export const LAUNCH_FACTORY = (process.env.NEXT_PUBLIC_LAUNCH_FACTORY ??
  '0x6bFeAD6c2Bc71a06226b8b0eB9D9422086c3fc95') as Address

export const FACTORY_ABI = [
  {
    type: 'function',
    name: 'launch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'mcpId', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'creator', type: 'address' },
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'staking', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'mcpById',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'string' }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'staking', type: 'address' },
      { name: 'creator', type: 'address' },
    ],
  },
] as const

/**
 * Read a launched MCP's token + vault straight from the factory's on-chain
 * registry — the trustless source of truth. Returns null if not launched.
 * This is how the launch endpoint confirms a launch without an indexer.
 */
export async function readLaunch(mcpId: string): Promise<{ token: Address; staking: Address; creator: Address } | null> {
  const pub = createPublicClient({ chain: LAUNCH_CHAIN, transport: http(process.env.LAUNCH_RPC_URL) })
  const [token, staking, creator] = await pub.readContract({
    address: LAUNCH_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'mcpById',
    args: [mcpId],
  })
  if (!token || token === zeroAddress) return null
  return { token: getAddress(token), staking: getAddress(staking), creator: getAddress(creator) }
}

/** YeetfulStaking — stake the MCP token, earn USDC. (repo x402-launch) */
export const STAKING_ABI = [
  { type: 'function', name: 'stake', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'unstake', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'owed', type: 'uint256' }] },
  { type: 'function', name: 'earned', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'stakedOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      { name: 'staker', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

/** Minimal ERC-20 surface for staking (approve the MCP token to the vault). */
export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const

/** USDC has 6 decimals; the MCP token (Flaunch memecoin) has 18. */
export const USDC_DECIMALS = 6
export const TOKEN_DECIMALS = 18
