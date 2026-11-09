// TRADE PROOF — a 'trade' post carries the author's OWN receipt-verified fill
// (lane CORE; hardened by lane SECFIX for QA-SECURITY S1 + S2).
//
// What the receipt row may contribute is only what the verifier bound: the
// transaction HASH and the CHAIN it lives on, from a row whose verdict is
// 'verified' (the chain confirmed the tx, its sender = this wallet, and its
// target). Everything a stranger reads as a fact is then READ FROM THE CHAIN
// at post time (`onChainNotionalUsd`): the dollars this wallet moved in that
// transaction. A transaction that moved nothing we can price (an approve, a
// self-send of nothing) is not a trade, and an RPC that cannot answer in ~6s
// is a refusal, never a pass (fail closed).
//
// The row's own words are never emitted as fact:
//   · `value_usd` is only an upper bound on the size (min with the chain's
//     figure × 1.05, the earned-answers grace);
//   · `chain` / `tx_url` only locate the hash; the explorer link is REBUILT
//     from the chain registry + the hash (a stored `https://evil.example/…`
//     never reaches a page);
//   · `symbols` (the side + market) are the author's tag, carried and printed
//     as theirs (lib/community/proof-words).

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { chartPairFor } from '@/lib/charts'
import { chainIdOfTurn, extractTxHash } from '@/lib/link-receipt-verify'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'
import { chainNameFor, explorerTxFor, proofTagLine } from './proof-words'
export { TX_HASH_RE, chainNameFor, explorerTxFor } from './proof-words'
import type { TradeProof } from './spec'

export interface MyFill {
  turnId: string
  /** The author's own tag (NOT chain-confirmed). */
  symbols: string[]
  /** The size the app RECORDED at signing — the chain is read when you post. */
  sizeUsd: number | null
  chainId: number
  chain: string
  txHash: string
  /** Rebuilt from the registry. */
  txUrl: string
  signedAt: number
  /** The picker's line, e.g. "Tagged by you: bought ETH · a transaction on Base". */
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

/** Where a receipt row's transaction lives: the hash from its link, the chain
 *  from the registry (chainIdOfTurn). null = no proof can be built from it. */
export function locateTx(row: { chain: string | null; txUrl: string | null }): { chainId: number; txHash: string; chain: string; txUrl: string } | null {
  const txHash = extractTxHash(row.txUrl)
  const chainId = chainIdOfTurn({ chain: row.chain, txUrl: row.txUrl })
  if (!txHash || chainId == null) return null
  const txUrl = explorerTxFor(chainId, txHash)
  const chain = chainNameFor(chainId)
  return txUrl && chain ? { chainId, txHash, chain, txUrl } : null
}

/** Side from the first side-tagged symbol; a Hyperliquid perp build reads buy → long, sell → short. */
export function proofSide(symbols: string[], buildPath: string | null | undefined): TradeProof['side'] {
  const first = symbols.find((t) => /^(buy|sell):/.test(t))
  if (!first) return null
  const buy = first.startsWith('buy:')
  if (buildPath === 'native-hl-exec') return buy ? 'long' : 'short'
  return buy ? 'buy' : 'sell'
}

export { defaultTradeTitle as fillLabel } from './proof-words'

// ── the chain read ───────────────────────────────────────────────────────

export const PROOF_READ_TIMEOUT_MS = 6_000
export type NotionalReader = (chainId: number, txHash: string, wallet: string) => Promise<{ usd: number | null }>

export const REFUSE_NOTHING_MOVED = 'That transaction moved nothing we can price, so it is not a trade to post.'
export const REFUSE_CHAIN_UNREAD = 'Could not read that transaction from the chain just now. Try again in a minute.'
export const REFUSE_NOT_YOURS = 'That is not one of your verified trades. Pick a fill from your list.'

const defaultReader: NotionalReader = async (chainId, txHash, wallet) => {
  const { onChainNotionalUsd } = await import('@/lib/earned-answers')
  const r = await onChainNotionalUsd(chainId, txHash, wallet)
  return { usd: r.usd }
}

/** The chain's answer with a hard timeout. 'gone' = the chain does not know
 *  the transaction; 'error' = no answer (timeout / RPC). */
export async function readOnChain(read: NotionalReader, chainId: number, txHash: string, wallet: string, timeoutMs = PROOF_READ_TIMEOUT_MS): Promise<{ usd: number | null } | 'gone' | 'error'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(chainId, txHash, wallet),
      new Promise<'error'>((resolve) => {
        timer = setTimeout(() => resolve('error'), timeoutMs)
      }),
    ])
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? ''
    return name === 'TransactionNotFoundError' || name === 'TransactionReceiptNotFoundError' ? 'gone' : 'error'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Pure: the size a stranger may read. The recorded value is an upper bound
 *  only; the chain's figure (+5% grace for price drift between build and
 *  read) caps it. Hidden size → null. */
export function clampProofSize(recordedUsd: number | null | undefined, onChainUsd: number, showSize: boolean): number | null {
  if (!showSize) return null
  const cap = onChainUsd * 1.05
  const rec = typeof recordedUsd === 'number' && Number.isFinite(recordedUsd) && recordedUsd > 0 ? recordedUsd : null
  const v = rec != null ? Math.min(rec, cap) : onChainUsd
  return Math.round(v * 100) / 100
}

export type ProofResult = { ok: true; proof: TradeProof } | { ok: false; status: number; reason: string }

type TurnRow = { id: string; symbols: string[]; valueUsd: number | null; chain: string | null; txUrl: string | null; buildPath: string | null; createdAt: Date }
const SELECT = { id: true, symbols: true, valueUsd: true, chain: true, txUrl: true, buildPath: true, createdAt: true } as const

/** Pure: a located row + the chain's answer → the proof, or why not. */
export function decideProof(row: TurnRow, onChain: { usd: number | null } | 'gone' | 'error', showSize: boolean): ProofResult {
  const where = locateTx(row)
  if (!where) return { ok: false, status: 400, reason: REFUSE_NOT_YOURS }
  if (onChain === 'error') return { ok: false, status: 503, reason: REFUSE_CHAIN_UNREAD }
  if (onChain === 'gone') return { ok: false, status: 400, reason: `That transaction is not on ${where.chain}, so it is not a trade to post.` }
  const usd = onChain.usd
  if (usd == null || !Number.isFinite(usd) || !(usd > 0)) return { ok: false, status: 400, reason: REFUSE_NOTHING_MOVED }
  return {
    ok: true,
    proof: {
      turnId: row.id,
      chainId: where.chainId,
      txHash: where.txHash,
      symbols: row.symbols.slice(0, 8),
      side: proofSide(row.symbols, row.buildPath),
      sizeUsd: clampProofSize(row.valueUsd, usd, showSize),
      chain: where.chain,
      txUrl: where.txUrl,
      signedAt: row.createdAt.getTime(),
      verification: 'verified',
    },
  }
}

/** The caller's own verified fills, newest first — the composer's picker.
 *  A row whose link cannot be rebuilt from the registry is not offered. */
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
  const out: MyFill[] = []
  for (const r of rows) {
    const where = locateTx(r)
    if (!where) continue
    const side = proofSide(r.symbols, r.buildPath)
    const sizeUsd = typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) && r.valueUsd > 0 ? r.valueUsd : null
    const tag = proofTagLine({ symbols: r.symbols, side }, 'you')
    out.push({ turnId: r.id, symbols: r.symbols, sizeUsd, ...where, signedAt: r.createdAt.getTime(), label: `${tag ? `${tag} · ` : ''}a transaction on ${where.chain}` })
  }
  return out
}

/** Re-derive the proof for a post, reading the chain. Refusals are by name. */
export async function resolveTradeProof(
  author: string,
  turnId: string,
  opts: { showSize: boolean; includeInternal?: boolean; readNotional?: NotionalReader; timeoutMs?: number },
): Promise<ProofResult> {
  if (!WALLET_RE.test(author) || typeof turnId !== 'string' || !TURN_ID_RE.test(turnId)) return { ok: false, status: 400, reason: REFUSE_NOT_YOURS }
  const row: TurnRow | null = await prisma.embedTurn.findFirst({ where: { AND: [{ id: turnId }, verifiedWhere(author, opts.includeInternal === true)] }, select: SELECT })
  if (!row) return { ok: false, status: 400, reason: REFUSE_NOT_YOURS }
  const where = locateTx(row)
  if (!where) return { ok: false, status: 400, reason: REFUSE_NOT_YOURS }
  const onChain = await readOnChain(opts.readNotional ?? defaultReader, where.chainId, where.txHash, author.toLowerCase(), opts.timeoutMs)
  return decideProof(row, onChain, opts.showSize)
}
