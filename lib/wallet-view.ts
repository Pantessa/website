// lib/wallet-view.ts — one wallet, every chain, what can move.
//
// The read behind the Wallet panel (components/WalletPanel.tsx). The ask it
// answers is the embedded-wallet user's: "how much do I have, and WHERE?" A
// CDP wallet is created by email + OTP and has no extension UI, so the app is
// the only place its owner will ever see a balance — and MetaMask shows one
// chain at a time, so "I funded it, where did it land?" is the same question
// from the other lane.
//
// Two sources, merged:
//   · Alchemy's multichain portfolio (lib/alchemy.ts) — every priced token
//     on every covered chain in one call. Optional: when the key is unset the
//     panel still renders from RPC.
//   · Direct RPC reads (lib/chains.ts publicClientFor) — native ETH + the
//     chain's primary stable on EVERY app chain. Always run: they are the
//     freshness floor (Alchemy's balance index lags a block or two), and they
//     are the GAS read. A chain with tokens and no gas is the state the
//     funding layer has to apologise for ("$20 USDC Base (no gas)"), so the
//     panel names it before the user hits that wall.
//
// Pure pieces (gasStateFor, mergeChains) are exported for the harness; the
// I/O shell (composeWalletView) fails soft per chain and never throws for one
// bad RPC — a chain that didn't answer is `failedChains`, never "empty".

import { erc20Abi, formatEther, formatUnits } from 'viem'
import { APP_CHAINS, primaryStable, publicClientFor, type AppChain } from '@/lib/chains'
import { alchemyEnabled, getMultichainPortfolio, getRecentActivity } from '@/lib/alchemy'
import { usdPerToken } from '@/lib/usd-probe'
import type { ActivityRow, HoldingRow } from '@/lib/splash/types'

/** How much native ETH a chain needs before the wallet can sign a plain
 *  ERC-20 move there. Mirrors lib/funding-plan's MIN_GAS_TO_SEND_ETH — the
 *  floor the funding scan uses to call a USDC balance "stranded". Robinhood
 *  Chain (Orbit, ETH gas, cheap) takes the L2 floor. */
export const GAS_FLOOR_ETH: Record<number, number> = { 1: 0.001, 8453: 0.00003, 42161: 0.00003, 10: 0.00003, 4663: 0.00003 }
/** Comfortable headroom — below this the row says "low", not "none". Mirrors
 *  lib/funding-plan's GAS_RESERVE_ETH (what a plan keeps back). */
export const GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002, 10: 0.0002, 4663: 0.0002 }

export type GasState = 'ok' | 'low' | 'none' | 'empty'

/** The gas verdict for one chain row.
 *    empty — nothing on the chain at all (no gas, no tokens): not a problem
 *    none  — tokens are here but the wallet can't pay to move them
 *    low   — can sign, but a plan would keep more back
 *    ok    — fine */
export function gasStateFor(chainId: number, nativeEth: number, tokenUsd: number): GasState {
  const floor = GAS_FLOOR_ETH[chainId] ?? 0.0002
  const reserve = GAS_RESERVE_ETH[chainId] ?? 0.002
  if (nativeEth >= reserve) return 'ok'
  if (nativeEth >= floor) return 'low'
  return tokenUsd >= 0.5 ? 'none' : 'empty'
}

export interface WalletChainView {
  id: number
  key: string
  name: string
  short: string
  color: string
  /** Everything on the chain, priced (native included). */
  totalUsd: number
  nativeEth: number
  nativeUsd: number | null
  gas: GasState
  /** Priced holdings, richest first, native first when present. */
  holdings: HoldingRow[]
  /** The RPC read didn't answer — balances shown are Alchemy's (or absent).
   *  Never rendered as zero. */
  unread?: true
}

export interface WalletView {
  address: string
  totalUsd: number
  /** Every app chain, in registry order — empty chains included so the
   *  panel can say "nothing on Arbitrum" rather than omit the row. */
  chains: WalletChainView[]
  activity: ActivityRow[]
  ethUsd: number | null
  /** Which reads composed this: rpc always; alchemy when keyed. */
  sources: ('rpc' | 'alchemy')[]
  failedChains: string[]
  updatedAt: string
}

/** One chain's direct reads. */
export interface RpcChainRead {
  chainId: number
  nativeEth: number
  /** Primary stable balance (USDC, or USDG on Robinhood Chain), whole units. */
  stable: { symbol: string; address: `0x${string}`; balance: number } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Merge Alchemy's holdings (by chain label) with the RPC reads into one row
 *  per app chain. RPC native wins on freshness; Alchemy supplies prices and
 *  the long tail of tokens. Pure — the harness composes states by hand. */
export function mergeChains(
  chains: AppChain[],
  rpc: Map<number, RpcChainRead>,
  alchemyHoldings: HoldingRow[],
  ethUsd: number | null,
): WalletChainView[] {
  const byLabel = new Map<string, HoldingRow[]>()
  for (const h of alchemyHoldings) {
    const label = h.chain ?? ''
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label)!.push(h)
  }
  return chains.map((c) => {
    const read = rpc.get(c.id)
    const fromAlchemy = byLabel.get(c.name) ?? []
    const alchemyNative = fromAlchemy.find((h) => h.native)
    const nativeEth = read ? read.nativeEth : alchemyNative ? Number(alchemyNative.balance) : 0
    const nativeUsd = ethUsd !== null ? round2(nativeEth * ethUsd) : alchemyNative?.valueUsd ?? null
    const tokens: HoldingRow[] = fromAlchemy.filter((h) => !h.native)
    // The RPC stable read is fresher than the index — swap it in when the
    // token is already listed, add it when Alchemy missed it (or is off).
    if (read?.stable && read.stable.balance > 0) {
      const sym = read.stable.symbol
      const i = tokens.findIndex((h) => h.symbol.toUpperCase() === sym.toUpperCase())
      const row: HoldingRow = {
        symbol: sym,
        address: read.stable.address,
        balance: String(read.stable.balance),
        priceUsd: 1,
        valueUsd: round2(read.stable.balance),
        chain: c.name,
      }
      if (i >= 0) tokens[i] = { ...tokens[i], ...row }
      else tokens.push(row)
    }
    tokens.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
    const tokenUsd = tokens.reduce((s, h) => s + (h.valueUsd ?? 0), 0)
    const holdings: HoldingRow[] =
      nativeEth > 0
        ? [
            {
              symbol: 'ETH',
              address: '0x0000000000000000000000000000000000000000',
              balance: String(nativeEth),
              priceUsd: ethUsd,
              valueUsd: nativeUsd,
              native: true,
              chain: c.name,
            },
            ...tokens,
          ]
        : tokens
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      short: c.short,
      color: c.color,
      totalUsd: round2(tokenUsd + (nativeUsd ?? 0)),
      nativeEth,
      nativeUsd,
      gas: gasStateFor(c.id, nativeEth, tokenUsd),
      holdings,
      ...(read ? {} : { unread: true as const }),
    }
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Native + primary-stable reads on one chain, one retry (public RPCs
 *  rate-limit in bursts). Null when the chain didn't answer. */
export async function readChainBalances(chainId: number, address: `0x${string}`): Promise<RpcChainRead | null> {
  const client = publicClientFor(chainId)
  if (!client) return null
  const stable = primaryStable(chainId)
  const read = () =>
    Promise.all([
      client.getBalance({ address }),
      stable ? client.readContract({ address: stable.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) : Promise.resolve(BigInt(0)),
    ])
  try {
    const [wei, atoms] = await read().catch(async () => {
      await sleep(400)
      return read()
    })
    return {
      chainId,
      nativeEth: Number(formatEther(wei)),
      stable: stable ? { symbol: stable.symbol, address: stable.address, balance: Number(formatUnits(atoms, stable.decimals)) } : null,
    }
  } catch {
    return null
  }
}

/** The whole view. Never throws for a single failed source. */
export async function composeWalletView(address: `0x${string}`): Promise<WalletView> {
  const withAlchemy = alchemyEnabled()
  const [ethProbe, rpcReads, portfolio, activity] = await Promise.all([
    usdPerToken(8453, 'ETH').catch(() => null),
    Promise.all(APP_CHAINS.map((c) => readChainBalances(c.id, address))),
    withAlchemy ? getMultichainPortfolio(address).catch(() => null) : Promise.resolve(null),
    withAlchemy ? getRecentActivity(address, 8).catch(() => [] as ActivityRow[]) : Promise.resolve([] as ActivityRow[]),
  ])
  const rpc = new Map<number, RpcChainRead>()
  const failedChains: string[] = []
  APP_CHAINS.forEach((c, i) => {
    const r = rpcReads[i]
    if (r) rpc.set(c.id, r)
    else failedChains.push(c.name)
  })
  const ethUsd = ethProbe?.usd ?? null
  const chains = mergeChains(APP_CHAINS, rpc, portfolio?.holdings ?? [], ethUsd)
  const sources: WalletView['sources'] = portfolio ? ['rpc', 'alchemy'] : ['rpc']
  return {
    address,
    totalUsd: round2(chains.reduce((s, c) => s + c.totalUsd, 0)),
    chains,
    activity,
    ethUsd,
    sources,
    failedChains,
    updatedAt: new Date().toISOString(),
  }
}
