// FILLS — the wallet's own signed executions on a symbol (VIZ lane). Server
// only. Two sources, both fenced `isInternal:false` (the harness/drill rows
// never paint on a stranger's chart) and both PUBLIC BY ADDRESS like
// /api/wallet (a signed turn is on-chain public data; nothing here spends):
//   · embed_turns  outcome='signed' by wallet_address whose prompt/detail
//                  names the symbol (first-party chat rows carry NO prompt by
//                  design, so they only match through `detail`)
//   · job_steps    kind='sign' status='done' on the wallet's own jobs whose
//                  title/params name the symbol (the settled swap steps)
// Cached 60s per symbol+address — the address is only ever part of ITS OWN
// cache row, never a shared key. The Map is bounded.

import prisma from '@/lib/db'
import { COUNTED_TURN_WHERE } from '@/lib/value-origin'
import { chartPairFor } from '@/lib/charts'
import { chainById, chainByKey, sanitizeChainId } from '@/lib/chains'
import type { FillMarker, FillsResponse } from '@/lib/chart-fills'

export type { FillMarker, FillsResponse }

export const FILLS_TTL_MS = 60_000
export const FILLS_CACHE_MAX = 512
const TAKE = 200

const cache = new Map<string, { at: number; body: FillsResponse }>()
const inflight = new Map<string, Promise<FillsResponse>>()

/** Which venue a build path / builder names, and its stable series entity. */
export function venueOfBuild(build: string | null | undefined): { venue: string; venueId: string } {
  const b = (build ?? '').toLowerCase()
  if (b.includes('uniswap-v4') || b.includes('v4')) return { venue: 'Uniswap v4', venueId: 'uniswap' }
  if (b.includes('uniswap')) return { venue: 'Uniswap v3', venueId: 'uniswap' }
  if (b.includes('lifi')) return { venue: 'LiFi', venueId: 'lifi' }
  if (b.includes('cow')) return { venue: 'CoW', venueId: 'cow' }
  if (b.includes('hl') || b.includes('hyperliquid')) return { venue: 'Hyperliquid', venueId: 'hyperliquid' }
  if (b.includes('cross-chain') || b.includes('near')) return { venue: 'NEAR Intents', venueId: 'near' }
  if (b.includes('aave')) return { venue: 'Aave', venueId: 'aave' }
  if (b.includes('lido')) return { venue: 'Lido', venueId: 'lido' }
  if (b.includes('morpho')) return { venue: 'Morpho', venueId: 'morpho' }
  if (b.includes('transfer') || b.includes('send')) return { venue: 'Transfer', venueId: 'wallet' }
  return { venue: 'Pantessa', venueId: 'wallet' }
}

/** buy | sell from the ask's own words; a sale/short/close/exit is a sell. */
export function sideOf(text: string): 'buy' | 'sell' {
  return /\b(sell|sold|short|close|exit|withdraw|unstake|redeem)\b/i.test(text) ? 'sell' : 'buy'
}

/** Whole-word symbol match ("ETH", "$ETH", "eth"), never a substring (ETH ≠ ETHENA). */
export function namesSymbol(text: string, symbol: string): boolean {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])\\$?${esc}(?![A-Za-z0-9])`, 'i').test(text)
}

function chainOf(raw: unknown): { chainId: number | null; chain: string | null } {
  if (typeof raw === 'number') {
    const c = chainById(raw)
    return { chainId: c?.id ?? raw, chain: c?.name ?? null }
  }
  if (typeof raw !== 'string' || !raw) return { chainId: null, chain: null }
  const byKey = chainByKey(raw.toLowerCase())
  if (byKey) return { chainId: byKey.id, chain: byKey.name }
  const id = /^0x[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : sanitizeChainId(Number(raw))
  const c = id != null ? chainById(id) : null
  return { chainId: c?.id ?? (id ?? null), chain: c?.name ?? null }
}

function explorerTx(chainId: number | null, hash: string | null): string | null {
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  const base: Record<number, string> = { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 42161: 'https://arbiscan.io/tx/', 10: 'https://optimistic.etherscan.io/tx/', 4663: 'https://explorer.robinhood.com/tx/' }
  const b = chainId != null ? base[chainId] : undefined
  return b ? `${b}${hash}` : null
}

async function readTurns(symbol: string, address: string): Promise<FillMarker[]> {
  const rows = await prisma.embedTurn.findMany({
    where: { AND: [{ outcome: 'signed', walletAddress: address, isInternal: false }, COUNTED_TURN_WHERE, { OR: [{ prompt: { contains: symbol, mode: 'insensitive' } }, { detail: { contains: symbol, mode: 'insensitive' } }] }] },
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: { id: true, prompt: true, detail: true, chain: true, txUrl: true, valueUsd: true, buildPath: true, createdAt: true },
  })
  const out: FillMarker[] = []
  for (const r of rows) {
    const text = `${r.prompt ?? ''} ${r.detail ?? ''}`
    if (!namesSymbol(text, symbol)) continue
    const { venue, venueId } = venueOfBuild(r.buildPath)
    const { chainId, chain } = chainOf(r.chain)
    out.push({ id: `turn:${r.id}`, t: Math.floor(r.createdAt.getTime() / 1000), side: sideOf(text), usd: r.valueUsd ?? null, venue, venueId, chainId, chain, txUrl: r.txUrl ?? null, source: 'turn' })
  }
  return out
}

async function readSteps(symbol: string, address: string): Promise<FillMarker[]> {
  const rows = await prisma.jobStep.findMany({
    where: { kind: 'sign', status: 'done', job: { wallet: address, isInternal: false } },
    orderBy: { updatedAt: 'desc' },
    take: TAKE,
    select: { id: true, title: true, params: true, result: true, builder: true, valueUsd: true, updatedAt: true },
  })
  const out: FillMarker[] = []
  for (const r of rows) {
    const params = (r.params ?? {}) as Record<string, unknown>
    const text = `${r.title} ${JSON.stringify(params)}`
    if (!namesSymbol(r.title, symbol) && !namesSymbol(JSON.stringify(params), symbol)) continue
    const { venue, venueId } = venueOfBuild(r.builder)
    const { chainId, chain } = chainOf(params.chainId ?? params.chain ?? null)
    const result = (r.result ?? {}) as Record<string, unknown>
    const txUrl = typeof result.txUrl === 'string' ? result.txUrl : explorerTx(chainId, typeof result.txHash === 'string' ? result.txHash : null)
    out.push({ id: `step:${r.id}`, t: Math.floor(r.updatedAt.getTime() / 1000), side: sideOf(text), usd: r.valueUsd ?? null, venue, venueId, chainId, chain, txUrl, source: 'job-step' })
  }
  return out
}

export async function readFills(symbolRaw: string, addressRaw: string, now = Date.now()): Promise<FillsResponse> {
  const symbol = chartPairFor(symbolRaw)?.symbol ?? symbolRaw.toUpperCase()
  const address = addressRaw.toLowerCase()
  const key = `${symbol}:${address}`
  const hit = cache.get(key)
  if (hit && now - hit.at < FILLS_TTL_MS) return { ...hit.body, cached: true }
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    // Each source is its own failure domain: a Prisma hiccup on one leaves the other.
    const [turns, steps] = await Promise.all([readTurns(symbol, address).catch(() => [] as FillMarker[]), readSteps(symbol, address).catch(() => [] as FillMarker[])])
    const fills = [...turns, ...steps].sort((a, b) => a.t - b.t)
    const body: FillsResponse = { symbol, address, fills, asOf: Date.now() }
    cache.set(key, { at: Date.now(), body })
    while (cache.size > FILLS_CACHE_MAX) cache.delete(cache.keys().next().value as string)
    return body
  })()
  inflight.set(key, p)
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}
