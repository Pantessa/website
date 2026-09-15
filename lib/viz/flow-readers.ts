// FLOW READERS — one read per dapp, each its own failure domain (VIZ lane).
// Server only. A reader returns null when the venue simply doesn't list the
// symbol (row omitted), a FlowSource with usd when it reads, a FlowSource
// with usd:null + gap when the venue applies but can't be read, and THROWS
// on transport failure (lib/viz/flow turns that into a labelled gap).
// Nothing here is signed or written — reads only.

import { erc20Abi, parseAbi, type Address } from 'viem'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { chartPairFor } from '@/lib/charts'
import { ensureTokenList, dynamicTokenBySymbol } from '@/lib/token-list'
import { readQuotes } from '@/lib/quotes'
import { callMcpTool } from '@/lib/mcp-call'
import { AAVE_MCP } from '@/lib/aave-exec'
import type { AaveReserveRow } from '@/lib/aave-supply'
import type { FlowSource } from '@/components/markets/viz/FlowPanel'

/** Uniswap v3 factories — bytecode-verified 2026-09-15 (24,535 bytes each
 *  via eth_getCode on Base / Ethereum / Arbitrum / Optimism). Robinhood
 *  Chain's stocks trade in v4-only pools (no factory getPool) — a labelled gap. */
export const UNI_V3_FACTORY: Readonly<Record<number, Address>> = {
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  10: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
}
const FEE_TIERS = [100, 500, 3000, 10000] as const
const FACTORY_ABI = parseAbi(['function getPool(address,address,uint24) view returns (address)'])
const ZERO = '0x0000000000000000000000000000000000000000'
const CHAIN_LABEL: Record<number, string> = { 8453: 'Base', 1: 'Ethereum', 42161: 'Arbitrum', 10: 'Optimism', 4663: 'Robinhood Chain' }

/** stETH on Ethereum — Lido's liquid staking token (totalSupply = ETH staked through Lido). */
const STETH: Address = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

async function lastPrice(symbol: string): Promise<number | null> {
  try {
    const { quotes } = await readQuotes([symbol])
    const q = quotes[symbol.toUpperCase()]
    return q && q.last > 0 ? q.last : null
  } catch {
    return null
  }
}

/** The token's address on a chain: the chain's pinned map first (ETH→WETH), then the warmed list. */
async function tokenOn(chainId: number, symbol: string): Promise<{ address: Address; decimals: number } | null> {
  const chain = chainById(chainId)
  if (!chain) return null
  const pinned = chain.tokens[symbol] ?? (symbol === 'ETH' ? chain.tokens.WETH : undefined)
  if (pinned) return pinned
  await ensureTokenList(chainId)
  const t = dynamicTokenBySymbol(symbol, chainId)
  return t ? { address: t.address as Address, decimals: t.decimals } : null
}

// ── Hyperliquid: open interest + funding ────────────────────────────────────
export async function readHyperliquid(symbol: string): Promise<FlowSource | null> {
  const res = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    signal: AbortSignal.timeout(4_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`)
  const [meta, ctxs] = (await res.json()) as [{ universe?: { name: string; isDelisted?: boolean }[] }, { openInterest?: string; markPx?: string; funding?: string; dayNtlVlm?: string }[]]
  const i = meta?.universe?.findIndex((u) => u.name === symbol && !u.isDelisted) ?? -1
  if (i < 0 || !ctxs?.[i]) return null
  const c = ctxs[i]
  const oi = Number(c.openInterest)
  const px = Number(c.markPx)
  const funding = Number(c.funding)
  const vol = Number(c.dayNtlVlm)
  if (!(oi >= 0) || !(px > 0)) return { id: 'hyperliquid', venue: 'Hyperliquid', measure: 'open interest', chain: 'Hyperliquid L1', usd: null, gap: 'ctx malformed' }
  const bits = [Number.isFinite(funding) ? `funding ${(funding * 100).toFixed(4)}%/h` : null, vol > 0 ? `24h vol ${fmtUsdShort(vol)}` : null].filter(Boolean)
  return { id: 'hyperliquid', venue: 'Hyperliquid', measure: 'open interest', chain: 'Hyperliquid L1', usd: oi * px, detail: bits.join(' · ') || undefined }
}

// ── Uniswap v3: pool balances vs the chain's stable, every fee tier ─────────
export async function readUniswap(symbol: string): Promise<FlowSource[] | null> {
  const pair = chartPairFor(symbol)
  if (pair?.source === 'robinhood') {
    return [{ id: 'uniswap', venue: 'Uniswap v4', measure: 'pool liquidity', chain: 'Robinhood Chain', usd: null, gap: 'v4 pools need a PoolManager read — not wired yet' }]
  }
  const price = await lastPrice(symbol)
  const out = await Promise.all(
    Object.entries(UNI_V3_FACTORY).map(async ([idStr, factory]): Promise<FlowSource | null> => {
      const chainId = Number(idStr)
      const client = publicClientFor(chainId)
      const stable = primaryStable(chainId)
      if (!client || !stable) return null
      const token = await tokenOn(chainId, symbol)
      if (!token || token.address.toLowerCase() === stable.address.toLowerCase()) return null
      try {
        const pools = (
          await Promise.all(FEE_TIERS.map((fee) => client.readContract({ address: factory, abi: FACTORY_ABI, functionName: 'getPool', args: [token.address, stable.address, fee] })))
        ).filter((p) => p && p !== ZERO) as Address[]
        if (!pools.length) return null
        const bals = await Promise.all(
          pools.map(async (pool) => {
            const [s, t] = await Promise.all([
              client.readContract({ address: stable.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
              client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
            ])
            return { stable: Number(s) / 10 ** stable.decimals, token: Number(t) / 10 ** token.decimals }
          }),
        )
        const stableUsd = bals.reduce((a, b) => a + b.stable, 0)
        const tokenAmt = bals.reduce((a, b) => a + b.token, 0)
        const usd = price != null ? stableUsd + tokenAmt * price : null
        return {
          id: 'uniswap',
          venue: 'Uniswap v3',
          measure: `pool balances vs ${stable.symbol}`,
          chain: CHAIN_LABEL[chainId] ?? String(chainId),
          usd,
          detail: `${pools.length} pool${pools.length === 1 ? '' : 's'}`,
          gap: usd == null ? `no ${symbol} price to value the token side` : undefined,
        }
      } catch (err) {
        return { id: 'uniswap', venue: 'Uniswap v3', measure: 'pool balances', chain: CHAIN_LABEL[chainId] ?? String(chainId), usd: null, gap: `unread — ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 60)}` }
      }
    }),
  )
  const rows = out.filter((r): r is FlowSource => r != null)
  return rows.length ? rows : null
}

// ── Aave: reserve size (supplied USD across spokes) ─────────────────────────
export async function readAave(symbol: string): Promise<FlowSource | null> {
  const symbols = symbol === 'ETH' ? ['WETH', 'ETH'] : [symbol]
  const res = (await callMcpTool(AAVE_MCP, 'reserves', { symbols, chainId: 1 }, { timeoutMs: 5_000 })) as { reserves?: AaveReserveRow[] } | null
  const rows = (res?.reserves ?? []).filter((r) => symbols.includes((r.asset?.symbol ?? '').toUpperCase()))
  if (!rows.length) return null
  // suppliedUsd arrives formatted ("$91,106,249.55"); a row with no readable
  // number counts as unread, and a set with none is a gap, never $0.
  const nums = rows.map((r) => usdOf(r.suppliedUsd)).filter((n): n is number => n != null)
  if (!nums.length) return { id: 'aave', venue: 'Aave', measure: 'supplied', chain: 'Ethereum', usd: null, gap: 'reserves carry no supplied USD' }
  const usd = nums.reduce((a, n) => a + n, 0)
  const borrowed = rows.map((r) => usdOf((r as AaveReserveRow & { borrowedUsd?: string | null }).borrowedUsd)).filter((n): n is number => n != null).reduce((a, n) => a + n, 0)
  const bestApy = rows.reduce<number | null>((a, r) => (r.supplyApyPct != null && (a == null || r.supplyApyPct > a) ? r.supplyApyPct : a), null)
  return { id: 'aave', venue: 'Aave', measure: 'supplied', chain: 'Ethereum', usd, detail: `${rows.length} spoke${rows.length === 1 ? '' : 's'}${borrowed > 0 ? ` · ${fmtUsdShort(borrowed)} borrowed` : ''}${bestApy != null ? ` · best ${bestApy.toFixed(2)}% APY` : ''}` }
}

// ── Lido: ETH staked (stETH supply) — ETH only ──────────────────────────────
export async function readLido(symbol: string): Promise<FlowSource | null> {
  if (symbol !== 'ETH') return null
  const client = publicClientFor(1)
  if (!client) return null
  const [supply, price] = await Promise.all([client.readContract({ address: STETH, abi: erc20Abi, functionName: 'totalSupply' }), lastPrice('ETH')])
  const eth = Number(supply) / 1e18
  return { id: 'lido', venue: 'Lido', measure: 'ETH staked (stETH supply)', chain: 'Ethereum', usd: price != null ? eth * price : null, detail: `${fmtUsdShort(eth).replace('$', '')} ETH`, gap: price == null ? 'no ETH price' : undefined }
}

// ── Robinhood Chain: stock tokens minted on-chain — stocks only ─────────────
export async function readRobinhood(symbol: string): Promise<FlowSource | null> {
  const pair = chartPairFor(symbol)
  if (pair?.source !== 'robinhood') return null
  const client = publicClientFor(4663)
  if (!client) return null
  await ensureTokenList(4663)
  const t = dynamicTokenBySymbol(symbol, 4663)
  if (!t) return { id: 'robinhood', venue: 'Robinhood Chain', measure: 'tokens minted', chain: 'Robinhood Chain', usd: null, gap: 'token list has no address yet' }
  const [supply, price] = await Promise.all([client.readContract({ address: t.address as Address, abi: erc20Abi, functionName: 'totalSupply' }), lastPrice(symbol)])
  const n = Number(supply) / 10 ** t.decimals
  return { id: 'robinhood', venue: 'Robinhood Chain', measure: 'stock tokens minted', chain: 'Robinhood Chain', usd: price != null ? n * price : null, detail: `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${symbol}`, gap: price == null ? 'no tape price' : undefined }
}

/** "$91,106,249.55" → 91106249.55; anything unreadable → null. */
export function usdOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[^0-9.eE+-]/g, ''))
  return Number.isFinite(n) && v.trim() !== '' ? n : null
}

function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export const FLOW_READERS_LIVE = [
  { id: 'uniswap', venue: 'Uniswap v3', measure: 'pool balances', read: readUniswap },
  { id: 'hyperliquid', venue: 'Hyperliquid', measure: 'open interest', read: readHyperliquid },
  { id: 'aave', venue: 'Aave', measure: 'supplied', read: readAave },
  { id: 'lido', venue: 'Lido', measure: 'ETH staked', read: readLido },
  { id: 'robinhood', venue: 'Robinhood Chain', measure: 'stock tokens minted', read: readRobinhood },
]
