// lib/watchlist-holdings.ts — what a wallet HOLDS, as watchlist symbols
// (server-only). The read behind GET /api/watchlists/holdings: the Wallet
// panel's one-wallet-every-chain view (lib/wallet-view, the same cache), cut
// down to the symbols a watchlist can hold. lib/watchlists planHeldAutofill
// decides what to add; this file only says what is held.
//
// A row counts only when we know what it IS:
//   · native gas on an app chain → ETH
//   · a Robinhood Chain row at a curated STOCK address → that stock, and only
//     when the ticker charts as the stock (never as a coin)
//   · any other token must sit at an address the chain registry or the
//     curated lists (tokens.uniswap.org + CoinGecko) name — an airdrop that
//     calls itself "UNI" is not UNI — and chart as a coin or perp (a Base
//     token named "AAPL" is not Apple stock)
// Stables chart flat (chartPairFor refuses them), dust under HELD_MIN_USD is
// not a holding, and an unpriced curated row still counts (a stock bought a
// minute ago that the quoter hasn't priced is real).

import { APP_CHAINS, chainById } from '@/lib/chains'
import { chartPairFor } from '@/lib/charts'
import { dynamicTokenByAddress, ensureTokenList } from '@/lib/token-list'
import { STOCK_CHAIN_ID, getWalletViewCached, robinhoodStockTokens, type WalletChainView } from '@/lib/wallet-view'
import { normalizeWatchSymbol, type HeldSymbol } from '@/lib/watchlists'
import type { HoldingRow } from '@/lib/splash/types'

/** Below this (summed across chains) a priced holding is dust, not a position. */
export const HELD_MIN_USD = 1

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** The symbol the chain registry or the curated lists give an address, or null. */
export function curatedSymbolFor(chainId: number, address: string): string | null {
  const chain = chainById(chainId)
  if (!chain || !ADDRESS_RE.test(address)) return null
  const a = address.toLowerCase()
  if (chain.wrappedNative.toLowerCase() === a) return 'WETH'
  for (const [sym, t] of Object.entries(chain.tokens)) if (t.address.toLowerCase() === a) return sym
  return dynamicTokenByAddress(a, chainId)?.symbol ?? null
}

type CuratedLookup = (chainId: number, address: string) => string | null

function watchSymbolForRow(chainId: number, h: HoldingRow, curated: CuratedLookup, stocks: ReadonlySet<string>): string | null {
  if (h.native) {
    const pair = chartPairFor(h.symbol || 'ETH')
    return pair && pair.source !== 'robinhood' ? pair.symbol : null
  }
  const addr = h.address.toLowerCase()
  if (chainId === STOCK_CHAIN_ID && stocks.has(addr)) {
    const sym = normalizeWatchSymbol(curated(chainId, addr) ?? h.symbol)
    return sym && chartPairFor(sym)?.source === 'robinhood' ? sym : null
  }
  const listed = curated(chainId, addr)
  if (!listed) return null
  const pair = chartPairFor(listed)
  return pair && pair.source !== 'robinhood' ? pair.symbol : null
}

/** Wallet rows → the watchable symbols they hold, richest first (ties keep
 *  wallet order). Pure given the curated lookup and the stock-address set;
 *  the harness passes both. */
export function heldWatchSymbols(
  chains: readonly Pick<WalletChainView, 'id' | 'name' | 'holdings'>[],
  opts: { curatedSymbol?: CuratedLookup; stockAddresses?: ReadonlySet<string>; minUsd?: number } = {},
): HeldSymbol[] {
  const curated = opts.curatedSymbol ?? curatedSymbolFor
  const stocks = opts.stockAddresses ?? new Set(robinhoodStockTokens().map((t) => t.address.toLowerCase()))
  const minUsd = opts.minUsd ?? HELD_MIN_USD
  const acc = new Map<string, { value: number; priced: boolean; chains: string[]; order: number }>()
  for (const c of chains) {
    for (const h of c.holdings) {
      if (!(Number(h.balance) > 0)) continue
      const symbol = watchSymbolForRow(c.id, h, curated, stocks)
      if (!symbol) continue
      let e = acc.get(symbol)
      if (!e) {
        e = { value: 0, priced: false, chains: [], order: acc.size }
        acc.set(symbol, e)
      }
      if (h.valueUsd != null && Number.isFinite(h.valueUsd)) {
        e.value += h.valueUsd
        e.priced = true
      }
      if (!e.chains.includes(c.name)) e.chains.push(c.name)
    }
  }
  return [...acc.entries()]
    .map(([symbol, e]) => ({ symbol, valueUsd: e.priced ? Math.round(e.value * 100) / 100 : null, chains: e.chains, order: e.order }))
    .filter((h) => h.valueUsd === null || h.valueUsd >= minUsd)
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.order - b.order)
    .map(({ symbol, valueUsd, chains: on }) => ({ symbol, valueUsd, chains: on }))
}

/** The whole read: the cached wallet view plus warmed curated lists → held
 *  symbols. Never throws for one bad chain (the view fails soft per chain);
 *  a chain that didn't answer simply contributes nothing this visit. */
export async function readHeldSymbols(address: `0x${string}`): Promise<{ held: HeldSymbol[]; failedChains: string[]; cached: boolean }> {
  const [{ view, cached }] = await Promise.all([
    getWalletViewCached(address),
    Promise.all(APP_CHAINS.map((c) => ensureTokenList(c.id).catch(() => {}))),
  ])
  return { held: heldWatchSymbols(view.chains), failedChains: view.failedChains, cached }
}
