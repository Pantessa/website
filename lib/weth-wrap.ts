// ─────────────────────────────────────────────────────────────────────────
//  WETH wrap — native ETH into the chain's wrapped-native token, so a venue
//  that only lists WETH (Aave v4 on Ethereum) can take money people hold as
//  ETH. "Supply $50 of ETH to Aave" used to refuse outright ("ETH isn't an
//  active, supplyable Aave v4 reserve"): the reserve is WETH and nothing
//  wrapped.
//
//  The plan (pure) decides how much to wrap from the wallet's live ETH + WETH
//  balances; the builder emits ONE call, `WETH.deposit()` with value; the
//  guard re-reads that call and fails closed unless the target is the
//  registry's wrappedNative, the calldata is exactly the deposit selector,
//  and the value is exactly the planned atoms. Nothing here ever comes from a
//  model or a tool: the address is the registry's, the amount is ours.
// ─────────────────────────────────────────────────────────────────────────

import { formatEther, getAddress, isAddress } from 'viem'
import { chainById } from '@/lib/chains'

/**
 * The reserve symbol Aave v4 carries for a symbol a sentence names. ETH maps
 * to WETH because the supply layer wraps native ETH first (lib/aave-exec);
 * every other symbol is exact. BTC is deliberately NOT mapped: Aave lists
 * WBTC and cbBTC, two different tokens (BitGo-custodied vs Coinbase-custodied)
 * and "BTC" names neither, so a BTC supply stays refused until the ask names
 * one. Shared by the builder and the chip verdict (lib/venue-capability), so
 * the two can't disagree.
 */
export function aaveReserveSymbolFor(token: string): string {
  const sym = token.toUpperCase()
  return sym === 'ETH' ? 'WETH' : sym
}

/** `deposit()` — WETH9's payable wrap. */
export const WETH_DEPOSIT_SELECTOR = '0xd0e30db0'

export interface WethWrapTx {
  to: `0x${string}`
  data: `0x${string}`
  /** Wei as a decimal string (the txRequest wire shape). */
  value: string
  chainId: number
}

/** ETH the wallet keeps back for gas after the wrap: the same per-chain
 *  keep-back as lib/wallet-view GAS_RESERVE_ETH and lib/funding-plan (mainnet
 *  0.002 covers the wrap, the approve and the supply at ordinary gas). Kept
 *  here so this module stays pure for the pin scripts. */
const WRAP_GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002, 10: 0.0002, 4663: 0.0002 }

export function wrapGasReserveWei(chainId: number): bigint {
  const eth = WRAP_GAS_RESERVE_ETH[chainId] ?? 0.002
  return BigInt(Math.round(eth * 1e6)) * BigInt(10) ** BigInt(12)
}

export type WrapPlan =
  /** The wallet already holds the WETH: no wrap, supply WETH directly. */
  | { kind: 'covered' }
  /** Wrap `wrapWei` of ETH first (the shortfall over WETH already held). */
  | { kind: 'wrap'; wrapWei: bigint }
  /** ETH + WETH can't cover it after the gas keep-back. */
  | { kind: 'short'; problem: string }

/**
 * How much ETH to wrap so the wallet holds `needWei` of WETH, keeping the gas
 * reserve back. WETH already held counts first, so a wallet that has some
 * wraps only the difference and one that has all of it wraps nothing.
 */
export function planWethWrap(args: {
  chainId: number
  needWei: bigint
  ethWei: bigint
  wethWei: bigint
}): WrapPlan {
  const { chainId, needWei, ethWei, wethWei } = args
  if (needWei <= BigInt(0)) return { kind: 'short', problem: 'That amount rounds to nothing.' }
  if (wethWei >= needWei) return { kind: 'covered' }
  const wrapWei = needWei - wethWei
  const reserve = wrapGasReserveWei(chainId)
  if (ethWei < wrapWei + reserve) {
    const chain = chainById(chainId)?.name ?? `chain ${chainId}`
    const held = wethWei > BigInt(0) ? `${trimEth(ethWei)} ETH and ${trimEth(wethWei)} WETH` : `${trimEth(ethWei)} ETH`
    return {
      kind: 'short',
      problem:
        `The wallet holds ${held} on ${chain}. Supplying ${trimEth(needWei)} ETH means wrapping ${trimEth(wrapWei)} ETH into WETH ` +
        `and keeping about ${trimEth(reserve)} ETH back for gas, which needs ${trimEth(wrapWei + reserve)} ETH. Nothing was built.`,
    }
  }
  return { kind: 'wrap', wrapWei }
}

function trimEth(wei: bigint): string {
  const s = formatEther(wei)
  if (!s.includes('.')) return s
  const [i, f] = s.split('.')
  const cut = f.slice(0, 6).replace(/0+$/, '')
  return cut ? `${i}.${cut}` : i
}

/** The one wrap call, addressed from the registry. Null off-registry or on a
 *  chain whose native is not ETH (Arc's native is USDC). */
export function buildWethWrapTx(chainId: number, wrapWei: bigint): WethWrapTx | null {
  const chain = chainById(chainId)
  if (!chain || chain.nativeSymbol !== 'ETH' || wrapWei <= BigInt(0)) return null
  return { to: chain.wrappedNative, data: WETH_DEPOSIT_SELECTOR, value: wrapWei.toString(), chainId }
}

/**
 * Fail-closed re-read of a wrap call before anyone is offered it: the target
 * must be the registry's wrappedNative for the chain, the calldata exactly the
 * deposit selector (no arguments; anything else is another function), and the
 * value exactly the planned atoms.
 */
export function guardWethWrap(
  tx: { to?: unknown; data?: unknown; value?: unknown; chainId?: unknown },
  expect: { chainId: number; wrapWei: bigint },
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  const chain = chainById(expect.chainId)
  if (!chain || chain.nativeSymbol !== 'ETH') {
    return { ok: false, reasons: [`Chain ${expect.chainId} has no ETH to wrap.`] }
  }
  if (Number(tx.chainId) !== expect.chainId) reasons.push(`The wrap targets chain ${String(tx.chainId)}, not ${expect.chainId}.`)
  const to = typeof tx.to === 'string' && isAddress(tx.to) ? getAddress(tx.to) : null
  if (!to || to !== getAddress(chain.wrappedNative)) {
    reasons.push(`The wrap is addressed to ${String(tx.to)}, not ${chain.name}'s WETH (${chain.wrappedNative}).`)
  }
  if (typeof tx.data !== 'string' || tx.data.toLowerCase() !== WETH_DEPOSIT_SELECTOR) {
    reasons.push(`The wrap's calldata is not WETH deposit() (${WETH_DEPOSIT_SELECTOR}).`)
  }
  let value: bigint | null = null
  try {
    value = typeof tx.value === 'string' || typeof tx.value === 'bigint' || typeof tx.value === 'number' ? BigInt(tx.value) : null
  } catch {
    value = null
  }
  if (value === null || value !== expect.wrapWei || value <= BigInt(0)) {
    reasons.push(`The wrap sends ${value === null ? 'an unreadable amount' : `${value} wei`}, not the planned ${expect.wrapWei} wei.`)
  }
  return reasons.length ? { ok: false, reasons } : { ok: true }
}
