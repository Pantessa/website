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
import { APP_CHAINS, chainById, primaryStable, publicClientFor, type AppChain } from '@/lib/chains'
import { alchemyEnabled, getMultichainPortfolio, getRecentActivity } from '@/lib/alchemy'
import { usdPerToken } from '@/lib/usd-probe'
import { dynamicTokensFor, ensureTokenList, type TokenInfo } from '@/lib/token-list'
import { robinhoodRowActions } from '@/lib/robinhood-row-actions'
import type { ActivityRow, HoldingRow } from '@/lib/splash/types'

/** Robinhood Chain — the one app chain whose listed tokens are STOCKS the
 *  index doesn't price. Its curated list (tokens.uniswap.org, chain 4663) =
 *  stocks + exactly two infra classes (wrapped gas, stables); everything
 *  else on it is a stock proof (the chat route derives it the same way). */
export const STOCK_CHAIN_ID = 4663
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

/** Every curated STOCK token on Robinhood Chain (list warmed by the caller),
 *  infra excluded — pure, so the harness primes a list and checks the cut. */
export function robinhoodStockTokens(): TokenInfo[] {
  const rh = chainById(STOCK_CHAIN_ID)
  if (!rh) return []
  const infra = new Set<string>([...Object.keys(rh.stables), rh.wrappedNative?.toLowerCase() ?? ''].map((a) => a.toLowerCase()))
  return dynamicTokensFor(STOCK_CHAIN_ID).filter((t) => !infra.has(t.address.toLowerCase()))
}

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
  /** Curated ERC-20s read straight from the chain (Robinhood Chain STOCKS —
   *  the index lists them unpriced, and a buy that settled seconds ago must
   *  show before any indexer catches up). Nonzero balances only. */
  tokens?: { symbol: string; address: `0x${string}`; balance: number; stock?: true }[]
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
    // Chain-read ERC-20s (Robinhood stocks) win over the index by address —
    // fresher, and the index doesn't price them anyway (priced after the
    // merge by the venue quoter; see composeWalletView).
    for (const t of read?.tokens ?? []) {
      if (!(t.balance > 0)) continue
      const i = tokens.findIndex((h) => h.address.toLowerCase() === t.address.toLowerCase())
      const prior = i >= 0 ? tokens[i] : null
      const row: HoldingRow = {
        symbol: t.symbol,
        address: t.address,
        balance: String(t.balance),
        priceUsd: prior?.priceUsd ?? null,
        valueUsd: prior?.priceUsd != null ? round2(t.balance * prior.priceUsd) : null,
        chain: c.name,
      }
      if (i >= 0) tokens[i] = { ...prior, ...row }
      else tokens.push(row)
    }
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
    // Robinhood Chain rows carry their "act on this" chips (sell / buy more /
    // DCA a held stock, put idle USDG to work) — the same rulebook as the
    // splash card, so the drawer is a place to ACT, not just to look.
    if (c.id === STOCK_CHAIN_ID) {
      const stockAddrs = new Set(robinhoodStockTokens().map((t) => t.address.toLowerCase()))
      for (let i = 0; i < tokens.length; i++) {
        const h = tokens[i]
        const isStock = stockAddrs.has(h.address.toLowerCase()) || read?.tokens?.some((t) => t.stock && t.address.toLowerCase() === h.address.toLowerCase())
        const actions = robinhoodRowActions({ symbol: h.symbol, balance: h.balance, priceUsd: h.priceUsd, kind: isStock ? 'stock' : undefined })
        if (actions.length) tokens[i] = { ...h, actions }
      }
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
    const tokens = chainId === STOCK_CHAIN_ID ? await readStockBalances(address).catch(() => undefined) : undefined
    return {
      chainId,
      nativeEth: Number(formatEther(wei)),
      stable: stable ? { symbol: stable.symbol, address: stable.address, balance: Number(formatUnits(atoms, stable.decimals)) } : null,
      ...(tokens ? { tokens } : {}),
    }
  } catch {
    return null
  }
}

/** Every curated stock the wallet holds on Robinhood Chain, straight from
 *  the chain: ONE Multicall3 aggregate over the warmed list (~200 tokens,
 *  batchSize 0 = a single eth_call — this RPC 429s parallel reads and
 *  rejects JSON-RPC batch envelopes, so never fan out). Fail-soft: a
 *  failed read means "no stock rows", never a crash of the whole view. */
export async function readStockBalances(address: `0x${string}`): Promise<NonNullable<RpcChainRead['tokens']>> {
  const client = publicClientFor(STOCK_CHAIN_ID)
  if (!client) return []
  await ensureTokenList(STOCK_CHAIN_ID).catch(() => {})
  const list = robinhoodStockTokens()
  if (list.length === 0) return []
  const results = await client.multicall({
    contracts: list.map((t) => ({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const })),
    allowFailure: true,
    multicallAddress: MULTICALL3,
    batchSize: 0,
  })
  const out: NonNullable<RpcChainRead['tokens']> = []
  results.forEach((r, i) => {
    if (r.status !== 'success' || typeof r.result !== 'bigint' || r.result <= BigInt(0)) return
    const t = list[i]
    const balance = Number(formatUnits(r.result, t.decimals))
    if (balance > 0) out.push({ symbol: t.symbol, address: t.address as `0x${string}`, balance, stock: true })
  })
  return out
}

/** Price the rows the index couldn't — Robinhood stocks quote against USDG
 *  on the venue's own pools (lib/usd-probe). Bounded: only held rows, only
 *  on the stock chain, only when unpriced. Mutates in place, fail-soft. */
export async function priceUnpricedStockRows(chains: WalletChainView[]): Promise<void> {
  const rh = chains.find((c) => c.id === STOCK_CHAIN_ID)
  if (!rh) return
  const targets = rh.holdings.filter((h) => !h.native && h.priceUsd == null).slice(0, 12)
  if (targets.length === 0) return
  await Promise.all(
    targets.map(async (h) => {
      const probe = await usdPerToken(STOCK_CHAIN_ID, h.address).catch(() => null)
      if (!probe) return
      h.priceUsd = probe.usd
      h.valueUsd = round2(Number(h.balance) * probe.usd)
      // Re-run the chips with the price in hand (ETH → USDG sizing needs it).
      const actions = robinhoodRowActions({ symbol: h.symbol, balance: h.balance, priceUsd: h.priceUsd, kind: h.actions?.some((a) => /^Sell |^Buy more /.test(a.label)) ? 'stock' : undefined })
      if (actions.length) h.actions = actions
    }),
  )
  rh.holdings.sort((a, b) => (a.native ? -1 : b.native ? 1 : (b.valueUsd ?? -1) - (a.valueUsd ?? -1)))
  const tokenUsd = rh.holdings.filter((h) => !h.native).reduce((s, h) => s + (h.valueUsd ?? 0), 0)
  rh.totalUsd = round2(tokenUsd + (rh.nativeUsd ?? 0))
  rh.gas = gasStateFor(rh.id, rh.nativeEth, tokenUsd)
}

// ── The shared read cache ───────────────────────────────────────────────────
// One cache for every surface that reads a wallet by address: the Wallet
// panel (GET /api/wallet) and the watchlist's holdings autofill (GET
// /api/watchlists/holdings). 45s per address, so a panel left open and a rail
// on every page cost one Alchemy call a minute between them. `fresh` bypasses
// it, bounded to one fresh read per address every 8s so no button becomes an
// Alchemy amplifier. Concurrent misses share one compose. Anchored on
// globalThis so every route bundle in the process sees the same map.
export const WALLET_VIEW_TTL_MS = 45_000
export const WALLET_VIEW_FRESH_GAP_MS = 8_000
const WALLET_VIEW_CACHE_MAX = 500

const viewStore = globalThis as typeof globalThis & {
  __walletViewCache?: Map<string, { at: number; view: WalletView }>
  __walletViewInflight?: Map<string, Promise<WalletView>>
}

export async function getWalletViewCached(address: `0x${string}`, opts: { fresh?: boolean } = {}): Promise<{ view: WalletView; cached: boolean }> {
  const cache = (viewStore.__walletViewCache ??= new Map())
  const inflight = (viewStore.__walletViewInflight ??= new Map())
  const key = address.toLowerCase()
  const hit = cache.get(key)
  const age = hit ? Date.now() - hit.at : Infinity
  if (hit && (age < WALLET_VIEW_FRESH_GAP_MS || (!opts.fresh && age < WALLET_VIEW_TTL_MS))) return { view: hit.view, cached: true }
  let pending = inflight.get(key)
  if (!pending) {
    pending = composeWalletView(address).finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  const view = await pending
  if (cache.size >= WALLET_VIEW_CACHE_MAX && !cache.has(key)) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), view })
  return { view, cached: false }
}

/** The whole view. Never throws for a single failed source. */
export async function composeWalletView(address: `0x${string}`): Promise<WalletView> {
  const withAlchemy = alchemyEnabled()
  // Warm the stock list first: the Robinhood read AND the index's
  // unpriced-but-curated keep (lib/alchemy) both consult it.
  await ensureTokenList(STOCK_CHAIN_ID).catch(() => {})
  const [ethProbe, rpcReads, portfolio, activity] = await Promise.all([
    usdPerToken(8453, 'ETH').catch(() => null),
    Promise.all(APP_CHAINS.map((c) => readChainBalances(c.id, address))),
    withAlchemy ? getMultichainPortfolio(address).catch(() => null) : Promise.resolve(null),
    // Twelve rows: the /wallet page lists the whole feed, the modal shows six.
    // Same Alchemy calls either way (15 per direction per chain, merged down).
    withAlchemy ? getRecentActivity(address, 12).catch(() => [] as ActivityRow[]) : Promise.resolve([] as ActivityRow[]),
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
  await priceUnpricedStockRows(chains).catch(() => {})
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
