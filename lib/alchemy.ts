// Alchemy multichain reads for the connected-wallet splash: a wallet's token
// portfolio (balances priced to USD) and its recent transactions across
// Ethereum, Base, Arbitrum, and Robinhood Chain in a couple of calls. This is
// what lets the "Uniswap" auto card show a whole-wallet view instead of
// Base-only on-chain reads.
//
// Gated behind ALCHEMY_API_KEY: when the key is unset, `alchemyEnabled()` is
// false and callers fall back to the keyless Base-only path — so nothing here
// is required to keep the splash working, it just makes it multichain.

import type { ActivityRow, HoldingRow } from './splash/types'

/** The chains the splash covers, in display order (richest ecosystems first). */
interface NetChain {
  /** Alchemy network slug (the `{network}.g.alchemy.com` subdomain). */
  net: string
  /** Human label shown on tiles. */
  label: string
  /** Native currency symbol. */
  native: string
  /** `https://…/tx/` explorer prefix. */
  explorerTx: string
}

const CHAINS: NetChain[] = [
  { net: 'eth-mainnet', label: 'Ethereum', native: 'ETH', explorerTx: 'https://etherscan.io/tx/' },
  { net: 'base-mainnet', label: 'Base', native: 'ETH', explorerTx: 'https://basescan.org/tx/' },
  { net: 'arb-mainnet', label: 'Arbitrum', native: 'ETH', explorerTx: 'https://arbiscan.io/tx/' },
  // Arbitrum Orbit L2 (chain 4663, mainnet 2026-07-01) — Data API + Transfers
  // API support probed live 2026-07-13; tokenized stocks trade here on Uniswap.
  { net: 'robinhood-mainnet', label: 'Robinhood Chain', native: 'ETH', explorerTx: 'https://robinhoodchain.blockscout.com/tx/' },
]

const NETWORKS = CHAINS.map((c) => c.net)
const CHAIN_BY_NET = new Map(CHAINS.map((c) => [c.net, c]))

/** True when a real Alchemy key is configured (else callers use the Base-only
 *  MCP fallback). */
export function alchemyEnabled(): boolean {
  return !!process.env.ALCHEMY_API_KEY
}

function apiKey(): string {
  const k = process.env.ALCHEMY_API_KEY
  if (!k) throw new Error('ALCHEMY_API_KEY not set')
  return k
}

async function postJson(url: string, body: unknown, timeoutMs = 12_000): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Alchemy ${res.status}`)
  return res.json()
}

// ── Portfolio (balances priced to USD, multichain) ───────────────────────────

interface AlchemyToken {
  address?: string
  network?: string
  tokenAddress?: string | null
  tokenBalance?: string | null
  tokenMetadata?: { symbol?: string | null; decimals?: number | null; name?: string | null } | null
  tokenPrices?: { currency?: string; value?: string }[] | null
}

/** Alchemy returns `tokenBalance` as a decimal string (native) or 0x-hex — both
 *  parse through BigInt. */
function balanceToUnits(raw: string | null | undefined, decimals: number): number {
  if (!raw) return 0
  try {
    const atoms = BigInt(raw)
    if (atoms === BigInt(0)) return 0
    return Number(atoms) / 10 ** decimals
  } catch {
    return 0
  }
}

export interface MultichainPortfolio {
  totalUsd: number
  holdings: HoldingRow[]
  /** How many of the covered chains actually returned holdings. */
  chainsWithHoldings: number
  chainLabels: string[]
}

/**
 * A wallet's token portfolio across all covered chains, priced to USD, in one
 * Alchemy Data API call. Only priced holdings (and native tokens) survive, so
 * unpriced spam airdrops are filtered out. Sorted richest-first.
 */
export async function getMultichainPortfolio(address: string): Promise<MultichainPortfolio> {
  const url = `https://api.g.alchemy.com/data/v1/${apiKey()}/assets/tokens/by-address`
  const json = (await postJson(url, {
    addresses: [{ address, networks: NETWORKS }],
    withMetadata: true,
    withPrices: true,
    includeNativeTokens: true,
    includeErc20Tokens: true,
  })) as { data?: { tokens?: AlchemyToken[] } }

  const tokens = Array.isArray(json.data?.tokens) ? json.data!.tokens! : []
  const seenChains = new Set<string>()
  const holdings: HoldingRow[] = []

  for (const t of tokens) {
    const chain = CHAIN_BY_NET.get(t.network ?? '')
    if (!chain) continue
    const isNative = !t.tokenAddress
    const decimals = typeof t.tokenMetadata?.decimals === 'number' ? t.tokenMetadata.decimals : 18
    const balance = balanceToUnits(t.tokenBalance, decimals)
    if (balance <= 0) continue
    const symbol = (isNative ? chain.native : t.tokenMetadata?.symbol || '') .trim()
    if (!symbol) continue
    const usdStr = (t.tokenPrices ?? []).find((p) => (p.currency ?? 'usd').toLowerCase() === 'usd')?.value
    const priceUsd = usdStr != null && Number.isFinite(Number(usdStr)) ? Number(usdStr) : null
    const valueUsd = priceUsd === null ? null : Math.round(balance * priceUsd * 100) / 100
    // Drop unpriced non-native dust (spam airdrops) — keep native even if unpriced.
    if (!isNative && (valueUsd === null || valueUsd < 0.01)) continue
    seenChains.add(chain.label)
    holdings.push({
      symbol,
      address: t.tokenAddress || '0x0000000000000000000000000000000000000000',
      balance: String(balance),
      priceUsd,
      valueUsd,
      native: isNative || undefined,
      chain: chain.label,
    })
  }

  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
  const totalUsd = Math.round(holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0) * 100) / 100
  return {
    totalUsd,
    holdings,
    chainsWithHoldings: seenChains.size,
    chainLabels: CHAINS.filter((c) => seenChains.has(c.label)).map((c) => c.label),
  }
}

// ── Recent transactions (asset transfers, multichain) ────────────────────────

interface AlchemyTransfer {
  hash?: string
  from?: string
  to?: string | null
  value?: number | null
  asset?: string | null
  category?: string
  metadata?: { blockTimestamp?: string }
  blockNum?: string
}

async function transfersFor(net: string, address: string, direction: 'from' | 'to'): Promise<AlchemyTransfer[]> {
  const url = `https://${net}.g.alchemy.com/v2/${apiKey()}`
  const params: Record<string, unknown> = {
    category: ['external', 'erc20'],
    withMetadata: true,
    excludeZeroValue: true,
    order: 'desc',
    maxCount: '0xf', // 15 per direction per chain — plenty to merge down from
  }
  if (direction === 'from') params.fromAddress = address
  else params.toAddress = address
  const json = (await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'alchemy_getAssetTransfers',
    params: [params],
  })) as { result?: { transfers?: AlchemyTransfer[] } }
  return Array.isArray(json.result?.transfers) ? json.result!.transfers! : []
}

function tsOf(t: AlchemyTransfer): number {
  const iso = t.metadata?.blockTimestamp
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

function shortAddr(a: string | null | undefined): string {
  if (!a) return '—'
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/**
 * A wallet's most recent transactions across the covered chains — sent and
 * received external/ERC-20 transfers, merged and sorted newest-first. Each
 * chain is fetched independently so one slow/failed chain never blanks the
 * others.
 */
export async function getRecentActivity(address: string, limit = 6): Promise<ActivityRow[]> {
  const lower = address.toLowerCase()
  const jobs = CHAINS.flatMap((c) => [
    transfersFor(c.net, address, 'from')
      .then((ts) => ts.map((t) => ({ t, chain: c })))
      .catch(() => []),
    transfersFor(c.net, address, 'to')
      .then((ts) => ts.map((t) => ({ t, chain: c })))
      .catch(() => []),
  ])
  const settled = (await Promise.all(jobs)).flat()

  // De-dupe on (hash, chain) — a self-transfer shows up in both directions.
  const byKey = new Map<string, { t: AlchemyTransfer; chain: NetChain }>()
  for (const entry of settled) {
    if (!entry.t.hash) continue
    const key = `${entry.chain.net}:${entry.t.hash}`
    if (!byKey.has(key)) byKey.set(key, entry)
  }

  const rows: ActivityRow[] = [...byKey.values()]
    .map(({ t, chain }) => {
      const from = (t.from ?? '').toLowerCase()
      const to = (t.to ?? '').toLowerCase()
      const direction: ActivityRow['direction'] =
        from === lower && to === lower ? 'self' : from === lower ? 'out' : 'in'
      const amount = typeof t.value === 'number' && Number.isFinite(t.value) ? t.value : null
      return {
        hash: t.hash as string,
        chain: chain.label,
        direction,
        asset: (t.asset || chain.native).trim(),
        amount: amount === null ? '' : trimAmount(amount),
        counterparty: shortAddr(direction === 'out' ? t.to : t.from),
        timestamp: tsOf(t),
        explorerUrl: chain.explorerTx + t.hash,
      }
    })
    .sort((a, b) => b.timestamp - a.timestamp)

  return rows.slice(0, limit)
}

// ── Transfer counterparties (protocol-interaction probe fuel) ────────────────

/**
 * The distinct counterparty addresses (lowercase) of a wallet's most recent
 * transfers on one chain — the `to` of what it sent, the `from` of what it
 * received. One call per direction, newest-first, capped at 1000: a "recent
 * history" read, not an archive crawl. Feeds the splash affinity probe
 * ("has this wallet ever touched contract X?" — lib/splash/affinity.ts).
 */
export async function transferCounterparties(
  net: string,
  address: string,
  direction: 'from' | 'to',
): Promise<string[]> {
  const url = `https://${net}.g.alchemy.com/v2/${apiKey()}`
  const params: Record<string, unknown> = {
    category: ['external', 'erc20'],
    withMetadata: false,
    excludeZeroValue: true,
    order: 'desc',
    maxCount: '0x3e8',
  }
  if (direction === 'from') params.fromAddress = address
  else params.toAddress = address
  const json = (await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'alchemy_getAssetTransfers',
    params: [params],
  })) as { result?: { transfers?: AlchemyTransfer[] } }
  const transfers = Array.isArray(json.result?.transfers) ? json.result!.transfers! : []
  const side = direction === 'from' ? 'to' : 'from'
  return [...new Set(transfers.map((t) => (t[side] ?? '').toLowerCase()).filter(Boolean))]
}

function trimAmount(n: number): string {
  if (n === 0) return '0'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}
