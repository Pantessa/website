// lib/gas-floor.ts — how much native ETH a same-chain swap must leave behind
// for its own gas, MEASURED from the chain's current fees.
//
// Born 2026-09-24. A wallet holding 0.00257 ETH (~$6.95) on Ethereum asked for
// $2 of UNI and was told it couldn't afford the swap: the swap gate kept a
// STATIC 0.003 ETH back for mainnet gas (DEST_GAS_FLOOR_ETH, sized in July
// 2026), while the live cost of a Uniswap v3 swap at that moment was
// ~0.00013 ETH (0.14 gwei base fee + 0.5 gwei tip × ~200k gas). The floor
// was 23× the price and walled a wallet that could pay ten times over.
//
// The rule: read eth_feeHistory, price SWAP_GAS_UNITS at (2 × base fee + the
// median tip) with a 1.5× safety margin, and clamp the answer between the
// chain's send floor (lib/funding-plan MIN_GAS_TO_SEND_ETH — never below what
// a single transaction needs) and the old static floor (DEST_GAS_FLOOR_ETH —
// never above what we used to demand). A read that fails answers the static
// floor: fail CLOSED to the conservative number, never to zero.
//
// DEST_GAS_FLOOR_ETH itself is untouched: it still sizes the gas LEG a
// funding plan bridges onto a chain (a leg is bought once, generously).

import { DEST_GAS_FLOOR_ETH, MIN_GAS_TO_SEND_ETH } from '@/lib/funding-plan'
import { publicClientFor } from '@/lib/chains'

/** Gas units a same-chain swap can take: an ERC-20 approve plus a v3 swap
 *  with a fee sweep (~250k measured on Base), cushioned. */
export const SWAP_GAS_UNITS = 300_000
/** Safety margin over the measured cost — fees move between the read and the
 *  signature. */
export const SWAP_GAS_SAFETY = 1.5

/** PURE: the floor in ETH for one chain given a fee read (wei). Unknown
 *  chains use mainnet's bounds. A null read = the static floor. */
export function gasFloorFromFees(chainId: number, fees: { baseFeeWei: bigint; tipWei: bigint } | null): number {
  const staticFloor = DEST_GAS_FLOOR_ETH[chainId] ?? DEST_GAS_FLOOR_ETH[1]
  const minFloor = MIN_GAS_TO_SEND_ETH[chainId] ?? MIN_GAS_TO_SEND_ETH[1]
  if (!fees || fees.baseFeeWei < BigInt(0) || fees.tipWei < BigInt(0)) return staticFloor
  const perGasWei = fees.baseFeeWei * BigInt(2) + fees.tipWei
  const costEth = (Number(perGasWei) / 1e18) * SWAP_GAS_UNITS * SWAP_GAS_SAFETY
  if (!Number.isFinite(costEth)) return staticFloor
  return Math.min(staticFloor, Math.max(minFloor, costEth))
}

/** Live: read the last five blocks' fees and price the floor. Never throws. */
export async function liveSwapGasFloorEth(chainId: number, timeoutMs = 4000): Promise<{ floorEth: number; measured: boolean }> {
  const client = publicClientFor(chainId)
  const fallback = { floorEth: gasFloorFromFees(chainId, null), measured: false }
  if (!client) return fallback
  try {
    const hist = await Promise.race([
      client.getFeeHistory({ blockCount: 5, rewardPercentiles: [50] }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ])
    if (!hist || !hist.baseFeePerGas.length) return fallback
    const baseFeeWei = hist.baseFeePerGas[hist.baseFeePerGas.length - 1]
    const tips = (hist.reward ?? []).map((r) => r[0]).filter((t): t is bigint => typeof t === 'bigint')
    const tipWei = tips.length ? tips.reduce((a, b) => (a > b ? a : b), BigInt(0)) : BigInt(0)
    return { floorEth: gasFloorFromFees(chainId, { baseFeeWei, tipWei }), measured: true }
  } catch {
    return fallback
  }
}
