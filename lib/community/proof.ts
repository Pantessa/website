// TRADE PROOF — a 'trade' post carries the author's OWN receipt-verified fill
// (lane CORE owns the bodies). The poster sends an embed_turns id and one
// switch (show the size or not); everything shown is re-read here from the
// row the chain already confirmed (verification = 'verified': the tx, its
// sender and its target). A row that is not verified, not the author's, or
// internal (outside an internal run) is no proof — refused by name.
//
// The fences are lib/viz/fills readTurns' verifiedOnly ones (the call page's
// "verified fills"): outcome 'signed', the wallet's own row, verification
// 'verified' WITH a transaction link, and never internal traffic — plus the
// REAL_TRAFFIC_WHERE origin fence for a public read.

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { chainById, chainByKey, sanitizeChainId } from '@/lib/chains'
import { chartPairFor } from '@/lib/charts'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import type { TradeProof } from './spec'

export interface MyFill {
  turnId: string
  symbols: string[]
  sizeUsd: number | null
  chain: string | null
  txUrl: string | null
  signedAt: number
  /** A plain-words line the composer shows, e.g. "Bought $25 of ETH on Base". */
  label: string
}

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/
const TURN_ID_RE = /^[a-z0-9]{8,40}$/i

/** The verified-fill fence for one wallet (internal rows only on an internal run). */
function verifiedWhere(wallet: string, includeInternal: boolean): Prisma.EmbedTurnWhereInput {
  return {
    AND: [
      { outcome: 'signed', verification: 'verified', walletAddress: wallet.toLowerCase(), txUrl: { not: null } },
      includeInternal ? {} : { isInternal: false },
      includeInternal ? {} : REAL_TRAFFIC_WHERE,
    ],
  }
}

/** The chain's display name from whatever the beacon stored ('base', 8453, '0x2105'). */
export function chainName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const byKey = chainByKey(raw.toLowerCase())
  if (byKey) return byKey.name
  const id = /^0x[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : sanitizeChainId(Number(raw))
  return (id != null ? chainById(id)?.name : null) ?? null
}

/** A tx link is shown only when it is an https URL (an explorer page). */
export function safeTxUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

/** Side from the first side-tagged symbol; a Hyperliquid perp build reads buy → long, sell → short. */
export function proofSide(symbols: string[], buildPath: string | null | undefined): TradeProof['side'] {
  const first = symbols.find((t) => /^(buy|sell):/.test(t))
  if (!first) return null
  const buy = first.startsWith('buy:')
  if (buildPath === 'native-hl-exec') return buy ? 'long' : 'short'
  return buy ? 'buy' : 'sell'
}

/** "Bought $25 of ETH on Base" — the fill in plain words, size optional. */
export function fillLabel(f: { symbols: string[]; side: TradeProof['side']; sizeUsd: number | null; chain: string | null }): string {
  const sym = (f.symbols.find((t) => /^(buy|sell):/.test(t)) ?? '').split(':')[1] ?? ''
  const verb = f.side === 'long' ? 'Went long' : f.side === 'short' ? 'Went short' : f.side === 'sell' ? 'Sold' : 'Bought'
  const size = f.sizeUsd != null && f.sizeUsd > 0 ? `$${f.sizeUsd >= 100 ? Math.round(f.sizeUsd).toLocaleString('en-US') : f.sizeUsd.toFixed(2).replace(/\.00$/, '')}` : ''
  const what = sym ? (size ? `${size} of ${sym}` : sym) : size || 'a trade'
  return `${verb} ${what}${f.chain ? ` on ${f.chain}` : ''}`
}

type TurnRow = { id: string; symbols: string[]; valueUsd: number | null; chain: string | null; txUrl: string | null; buildPath: string | null; createdAt: Date }
const SELECT = { id: true, symbols: true, valueUsd: true, chain: true, txUrl: true, buildPath: true, createdAt: true } as const

/** The caller's own verified fills, newest first — the composer's picker. */
export async function listMyFills(wallet: string, opts: { symbol?: string; limit?: number; includeInternal?: boolean } = {}): Promise<MyFill[]> {
  if (!WALLET_RE.test(wallet)) return []
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 25) || 25))
  const sym = opts.symbol ? chartPairFor(opts.symbol)?.symbol ?? null : null
  if (opts.symbol && !sym) return []
  const base = verifiedWhere(wallet, opts.includeInternal === true)
  const rows: TurnRow[] = await prisma.embedTurn.findMany({
    where: sym ? { AND: [base, { symbols: { hasSome: [`buy:${sym}`, `sell:${sym}`] } }] } : base,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: SELECT,
  })
  return rows.map((r) => {
    const chain = chainName(r.chain)
    const side = proofSide(r.symbols, r.buildPath)
    const sizeUsd = typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) ? r.valueUsd : null
    return { turnId: r.id, symbols: r.symbols, sizeUsd, chain, txUrl: safeTxUrl(r.txUrl), signedAt: r.createdAt.getTime(), label: fillLabel({ symbols: r.symbols, side, sizeUsd, chain }) }
  })
}

/** Re-derive the proof for a post. null = not provable (the route refuses). */
export async function resolveTradeProof(author: string, turnId: string, opts: { showSize: boolean; includeInternal?: boolean }): Promise<TradeProof | null> {
  if (!WALLET_RE.test(author) || typeof turnId !== 'string' || !TURN_ID_RE.test(turnId)) return null
  const row: TurnRow | null = await prisma.embedTurn.findFirst({ where: { AND: [{ id: turnId }, verifiedWhere(author, opts.includeInternal === true)] }, select: SELECT })
  if (!row) return null
  const txUrl = safeTxUrl(row.txUrl)
  if (!txUrl) return null
  const sizeUsd = opts.showSize && typeof row.valueUsd === 'number' && Number.isFinite(row.valueUsd) ? row.valueUsd : null
  return {
    turnId: row.id,
    symbols: row.symbols.slice(0, 8),
    side: proofSide(row.symbols, row.buildPath),
    sizeUsd,
    chain: chainName(row.chain),
    txUrl,
    signedAt: row.createdAt.getTime(),
    verification: 'verified',
  }
}
