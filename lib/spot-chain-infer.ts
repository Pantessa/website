// lib/spot-chain-infer.ts — the chain a swap builds on when the ask named
// none and the picker says ALL CHAINS. Server-side: warms the token lists,
// reads the wallet for a sell, measures depth for a coin the table doesn't
// carry, then asks the pure rule (lib/token-home inferSpotChain).
//
// Born 2026-10-06: "Buy $50 of UNI" from /t/UNI and "let's buy $2 worth of
// uni" both built on Base — the registry default — into a 1% pool on a
// bridged copy, when UNI's market is on Ethereum and the wallet held $619 of
// USDC there. Nothing in the sentence or the picker asked for Base; the
// default did. This module answers "where does this token actually trade?"
// so the default is the token's chain, not the cheapest one. A chain named
// in the message or picked still wins (the route never calls this then), and
// the spend retarget still follows the money afterwards: nothing was pinned.

import { erc20Abi } from 'viem'
import { APP_CHAINS, chainById, publicClientFor } from '@/lib/chains'
import { resolveToken, tokenDecimals } from '@/lib/cow'
import { dynamicTokenCount, ensureTokenList } from '@/lib/token-list'
import { inferSpotChain, spotHomeChainId, type SpotChainVerdict, type SpotDepthFact } from '@/lib/token-home'
import { spotDepthProbe } from '@/lib/usd-probe'

/** Robinhood Chain is the stock chain (its own inference runs first in the
 *  route); every other registry chain is a spot candidate. */
export const SPOT_INFER_CHAIN_IDS: readonly number[] = APP_CHAINS.map((c) => c.id).filter((id) => id !== 4663)

const STABLE_RE = /^(?:USDC(?:\.E)?|USDT|DAI|USDG|USDE|USDS|EURC|USDB)$/i
const GAS_RE = /^(?:ETH|WETH)$/i

/**
 * The token whose MARKET decides the chain, and which side it sits on. The
 * buy token leads ("buy $2 of UNI", "swap 50 USDC for UNI"); a buy of a
 * stable or of ETH hands over to the sell side ("sell 0.1 UNI", "swap 0.1
 * UNI for USDC"); a swap between two stables, a buy of ETH with a stable, or
 * a raw 0x address in the slot means nothing to infer (null).
 */
export function spotInferenceToken(intent: { buyToken?: string; sellToken?: string }): { symbol: string; side: 'buy' | 'sell' } | null {
  const buy = intent.buyToken?.trim()
  const sell = intent.sellToken?.trim()
  const plain = (s: string | undefined): s is string => !!s && !/^0x[0-9a-fA-F]{40}$/.test(s)
  const neutral = (s: string): boolean => STABLE_RE.test(s) || GAS_RE.test(s)
  if (plain(buy) && !neutral(buy)) return { symbol: buy.toUpperCase(), side: 'buy' }
  if (plain(sell) && !neutral(sell)) return { symbol: sell.toUpperCase(), side: 'sell' }
  return null
}

interface DepthCacheEntry {
  at: number
  facts: SpotDepthFact[]
}
const DEPTH_TTL_MS = 60 * 60 * 1000
const depthStore = globalThis as typeof globalThis & { __spotDepthCache?: Map<string, DepthCacheEntry> }

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])

/** Measured depth on every listed chain, cached an hour per symbol. */
async function depthOn(symbol: string, chainIds: readonly number[]): Promise<SpotDepthFact[]> {
  const cache = (depthStore.__spotDepthCache ??= new Map())
  const key = `${symbol}:${[...chainIds].sort((a, b) => a - b).join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < DEPTH_TTL_MS) return hit.facts
  const probes = await Promise.all(chainIds.map((id) => withTimeout(spotDepthProbe(id, symbol).catch(() => null), 6_000, null)))
  const facts: SpotDepthFact[] = []
  probes.forEach((p) => {
    if (p) facts.push({ chainId: p.chainId, outPerUsd: p.outPerUsd, decayBps: p.decayBps, trusted: p.trusted })
  })
  if (cache.size >= 500) cache.clear()
  cache.set(key, { at: Date.now(), facts })
  return facts
}

/** Whole units of `symbol` the wallet holds on each chain. A chain whose read
 *  fails twice (a public RPC's rate limit, a timeout) lands in `unread` —
 *  never reported as zero, and the pure rule treats it as missing evidence. */
async function heldOn(symbol: string, wallet: string, chainIds: readonly number[]): Promise<{ held: { chainId: number; units: number }[]; unread: number[] }> {
  const held: { chainId: number; units: number }[] = []
  const unread: number[] = []
  await Promise.all(
    chainIds.map(async (chainId) => {
      const client = publicClientFor(chainId)
      const addr = resolveToken(symbol, chainId)
      if (!client || !addr) return
      const dec = tokenDecimals(symbol, chainId) ?? 18
      const read = () =>
        withTimeout(
          client.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] }).catch(() => null),
          5_000,
          null,
        )
      let atoms = await read()
      if (atoms === null) {
        await new Promise((r) => setTimeout(r, 400))
        atoms = await read()
      }
      if (atoms === null) unread.push(chainId)
      else held.push({ chainId, units: Number(atoms) / 10 ** dec })
    }),
  )
  return { held, unread }
}

export interface SpotChainLiveInput {
  symbol: string
  side: 'buy' | 'sell'
  targetChainId: number
  wallet?: string | null
}

/**
 * The verdict for a live ask. Never throws: a list that won't warm, a wallet
 * read that times out or a pool that won't quote each fall back toward the
 * target chain, the way the route behaved before this existed.
 */
export async function inferSpotChainLive(i: SpotChainLiveInput): Promise<SpotChainVerdict> {
  const symbol = i.symbol.toUpperCase()
  const target = chainById(i.targetChainId)
  const fallback: SpotChainVerdict = { chainId: i.targetChainId, reason: 'default', note: `${symbol} on ${target?.name ?? i.targetChainId} by default` }
  try {
    const pinnedOnTarget = !!target?.tokens[symbol]
    if (pinnedOnTarget) return inferSpotChain({ symbol, side: i.side, targetChainId: i.targetChainId, listedOn: null, pinnedOnTarget: true })
    await Promise.all(SPOT_INFER_CHAIN_IDS.map((id) => withTimeout(ensureTokenList(id).catch(() => {}), 8_500, undefined)))
    const warmed = SPOT_INFER_CHAIN_IDS.some((id) => dynamicTokenCount(id) > 0)
    const listedOn = warmed ? SPOT_INFER_CHAIN_IDS.filter((id) => resolveToken(symbol, id) !== null) : null
    const home = spotHomeChainId(symbol)
    let held: { chainId: number; units: number }[] | null = null
    let heldUnread: number[] | null = null
    if (i.side === 'sell' && i.wallet && /^0x[0-9a-fA-F]{40}$/.test(i.wallet)) {
      const candidates = listedOn ?? [i.targetChainId, ...(home !== null ? [home] : [])]
      const reads = await heldOn(symbol, i.wallet, [...new Set(candidates)])
      held = reads.held
      heldUnread = reads.unread
    }
    let depth: SpotDepthFact[] | null = null
    if (i.side === 'buy' && home === null && listedOn && listedOn.length >= 2) depth = await depthOn(symbol, listedOn)
    return inferSpotChain({ symbol, side: i.side, targetChainId: i.targetChainId, listedOn, pinnedOnTarget, heldOn: held, heldUnread, depth })
  } catch {
    return fallback
  }
}
