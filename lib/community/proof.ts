// TRADE PROOF — a 'trade' post carries the author's OWN receipt-verified fill
// (lane CORE; hardened by lane SECFIX for QA-SECURITY S1 + S2).
//
// What the receipt row may contribute is only what the verifier bound: the
// transaction HASH and the CHAIN it lives on, from a row whose verdict is
// 'verified' (the chain confirmed the tx, its sender = this wallet, and its
// target). Everything a stranger reads as a fact is then READ FROM THE CHAIN
// at post time: the dollars this wallet moved, net, in that transaction. A transaction that moved nothing we can price (an approve, a
// self-send of nothing) is not a trade, and an RPC that cannot answer in ~6s
// is a refusal, never a pass (fail closed).
//
// A TRADE MOVES VALUE BOTH WAYS, AND THE SIZE IS THE NET (QA-SECURITY-3 R1,
// QA-SECURITY-4 Q1–Q3). The reader here is this file's own (`flowShape`): it
// nets every ERC-20 Transfer that names the wallet, per token, and needs the
// transaction to be TWO-SIDED (something out, something else in). The size is
// the net of a priced asset, never one leg, so a stable routed through the
// wallet and back is zero. A transfer, a deposit, a wrap, a round trip: refused.
// What the sentence "this wallet moved $X on <chain>" is then true of: in one
// transaction the wallet's balance of a stable (or native) changed by $X net
// while its balance of another asset changed the other way. It does NOT say
// the other asset is worth anything or that the counterparty was a stranger
// (a swap against a pool the author owns reads the same): the page says
// "moved", never "bought" or "sold", under the verified mark.
//
// The row's own words are never emitted as fact:
//   · `value_usd` is only an upper bound on the size: the printed figure is
//     min(recorded, the chain's) and NEVER above the chain's (R2: the first
//     cut allowed 5% over, so a $100 transaction could print $105);
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
/** What the chain says about one transaction for one wallet. `twoSided` is
 *  REQUIRED to be true for a proof; a reader that cannot tell answers false. */
export interface OnChainRead {
  usd: number | null
  twoSided?: boolean
}
export type NotionalReader = (chainId: number, txHash: string, wallet: string) => Promise<OnChainRead>

export const REFUSE_NOTHING_MOVED = 'That transaction moved nothing we can price, so it is not a trade to post.'
export const REFUSE_ONE_WAY = 'That transaction sent funds one way only (a transfer or a deposit), so it is not a trade to post.'
export const REFUSE_CHAIN_UNREAD = 'Could not read that transaction from the chain just now. Try again in a minute.'
export const REFUSE_NOT_YOURS = 'That is not one of your verified trades. Pick a fill from your list.'

/** keccak256("Transfer(address,address,uint256)"). The pins RECOMPUTE this
 *  hash (QA-SECURITY-4 Q1: the first cut copied a literal from
 *  lib/earned-answers that is two hex characters short, so no real Transfer
 *  ever matched and every real trade post was refused). */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** keccak256("Withdrawal(address,uint256)") — WETH9 unwrapping: native paid
 *  out by an internal call (no Transfer log names the receiver). */
export const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
const topicAddr = (t: string | undefined) => (t && /^0x[0-9a-fA-F]{64}$/.test(t) ? `0x${t.slice(26)}`.toLowerCase() : '')
const wordOf = (data: string | undefined): bigint | null => {
  if (!data || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null
  try {
    return BigInt(data)
  } catch {
    return null
  }
}

export interface FlowLog {
  address: string
  topics: readonly string[]
  data?: string
}
export interface FlowInput {
  wallet: string
  /** The contract the transaction called. */
  txTo: string | null
  /** Native value sent with the call (wei). */
  txValue: bigint
  /** The chain's wrapped-native token (WETH on Base, …). */
  wrappedNative: string
  /** USD-pegged tokens on this chain (lowercase address → decimals), from the chain registry. */
  stables: Record<string, number>
  logs: FlowLog[]
}
export interface FlowRead {
  out: boolean
  in: boolean
  twoSided: boolean
  /** NET stable dollars the wallet sent or received (the larger side), or 0. */
  stableUsd: number
  /** NET native-equivalent atoms (18 decimals): value sent with the call, or the wallet's net wrapped-native change. */
  nativeAtoms: bigint
}

/**
 * Pure: what did this transaction do to this wallet, NET, per asset?
 *
 * Every ERC-20 Transfer that names the wallet moves that token's NET balance
 * (in minus out). NET, not the largest leg (QA-SECURITY-4 Q2): a stable that
 * passes THROUGH the wallet and back out (a flash loan routed through it) is
 * zero, however large each leg was.
 *   out  = a token whose net is negative, or native value sent with the call
 *   in   = a token whose net is positive (not the wrapped token when the
 *          wallet sent native: that is a wrap); or native paid out — the
 *          wrapped token being UNWRAPPED BY THE CONTRACT THE WALLET CALLED
 *          (Q3: `Withdrawal.src` must be `tx.to`), counted only when the
 *          wallet sent a token that is not the wrapped one and no native
 * A trade is two-sided: something out AND something else in. A transfer, a
 * self-send, a deposit, a wrap, an unwrap and a round trip are not.
 * The dollars are read from the NET of a priced asset (a registry stable, or
 * native / wrapped-native), never from a single leg. Pinned.
 */
export function flowShape(i: FlowInput): FlowRead {
  const who = i.wallet.toLowerCase()
  const wrapped = i.wrappedNative.toLowerCase()
  const callee = (i.txTo ?? '').toLowerCase()
  const net = new Map<string, bigint>()
  let unwrappedByCallee = false
  for (const log of i.logs) {
    const t0 = log.topics[0]?.toLowerCase()
    const token = log.address.toLowerCase()
    if (t0 === WITHDRAWAL_TOPIC && token === wrapped && log.topics.length === 2 && callee && topicAddr(log.topics[1]) === callee) unwrappedByCallee = true
    if (t0 !== TRANSFER_TOPIC || log.topics.length !== 3) continue // 3 topics = ERC-20 (an NFT transfer has 4)
    const from = topicAddr(log.topics[1])
    const to = topicAddr(log.topics[2])
    if (!from || !to || from === to) continue
    if (from !== who && to !== who) continue
    const value = wordOf(log.data)
    if (value === null || value <= BigInt(0)) continue // no readable amount = no evidence
    net.set(token, (net.get(token) ?? BigInt(0)) + (to === who ? value : -value))
  }
  const nativeOut = i.txValue > BigInt(0)
  const sentTokens = [...net].filter(([, v]) => v < BigInt(0)).map(([t]) => t)
  const gotTokens = [...net].filter(([, v]) => v > BigInt(0)).map(([t]) => t)
  const out = nativeOut || sentTokens.length > 0
  const tokenIn = gotTokens.some((t) => !(nativeOut && t === wrapped))
  const nativeIn = !nativeOut && unwrappedByCallee && sentTokens.some((t) => t !== wrapped)
  const inn = tokenIn || nativeIn
  let stableUsd = 0
  for (const [token, v] of net) {
    const dec = i.stables[token]
    if (dec === undefined || v === BigInt(0)) continue
    const abs = v < BigInt(0) ? -v : v
    stableUsd = Math.max(stableUsd, Number(abs) / 10 ** dec)
  }
  const wrappedNet = net.get(wrapped) ?? BigInt(0)
  const wrappedAbs = wrappedNet < BigInt(0) ? -wrappedNet : wrappedNet
  const nativeAtoms = nativeOut ? i.txValue : wrappedAbs
  return { out, in: inn, twoSided: out && inn, stableUsd, nativeAtoms }
}

/** The default reader: the transaction and its receipt from the chain, the
 *  flow above, and a price for the native leg only when no stable leg exists. */
export const readTradeOnChain: NotionalReader = async (chainId, txHash, wallet) => {
  const [{ receiptClientFor }, { chainById, gasIsStable }] = await Promise.all([import('@/lib/link-receipt-verify'), import('@/lib/chains')])
  const chain = chainById(chainId)
  const client = receiptClientFor(chainId)
  if (!chain || !client) return { usd: null, twoSided: false }
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash as `0x${string}` }), client.getTransactionReceipt({ hash: txHash as `0x${string}` })])
  if (!tx || !receipt || receipt.status !== 'success' || tx.from.toLowerCase() !== wallet.toLowerCase() || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return { usd: null, twoSided: false }
  const flow = flowShape({
    wallet,
    txTo: tx.to ?? null,
    txValue: tx.value,
    wrappedNative: chain.wrappedNative,
    stables: chain.stables,
    logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics as readonly string[], data: l.data })),
  })
  if (!flow.twoSided) return { usd: flow.stableUsd > 0 ? flow.stableUsd : null, twoSided: false }
  if (flow.stableUsd > 0) return { usd: flow.stableUsd, twoSided: true }
  if (flow.nativeAtoms > BigInt(0)) {
    const units = Number(flow.nativeAtoms) / 1e18
    if (gasIsStable(chain)) return { usd: units, twoSided: true }
    const { usdPerToken } = await import('@/lib/usd-probe')
    const px = (await usdPerToken(chainId, 'ETH').catch(() => null))?.usd ?? null
    return { usd: px ? units * px : null, twoSided: true }
  }
  return { usd: null, twoSided: true }
}

/** The chain's answer with a hard timeout. 'gone' = the chain does not know
 *  the transaction; 'error' = no answer (timeout / RPC). */
export async function readOnChain(read: NotionalReader, chainId: number, txHash: string, wallet: string, timeoutMs = PROOF_READ_TIMEOUT_MS): Promise<OnChainRead | 'gone' | 'error'> {
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
 *  only, and the printed figure is NEVER above what the chain shows (R2).
 *  Hidden size → null. */
export function clampProofSize(recordedUsd: number | null | undefined, onChainUsd: number, showSize: boolean): number | null {
  if (!showSize) return null
  const rec = typeof recordedUsd === 'number' && Number.isFinite(recordedUsd) && recordedUsd > 0 ? recordedUsd : null
  const v = rec != null ? Math.min(rec, onChainUsd) : onChainUsd
  // Round DOWN to the cent: rounding up would print a cent the chain did not show.
  return Math.floor(v * 100 + 1e-9) / 100
}

export type ProofResult = { ok: true; proof: TradeProof } | { ok: false; status: number; reason: string }

type TurnRow = { id: string; symbols: string[]; valueUsd: number | null; chain: string | null; txUrl: string | null; buildPath: string | null; createdAt: Date }
const SELECT = { id: true, symbols: true, valueUsd: true, chain: true, txUrl: true, buildPath: true, createdAt: true } as const

/** Pure: a located row + the chain's answer → the proof, or why not. */
export function decideProof(row: TurnRow, onChain: OnChainRead | 'gone' | 'error', showSize: boolean): ProofResult {
  const where = locateTx(row)
  if (!where) return { ok: false, status: 400, reason: REFUSE_NOT_YOURS }
  if (onChain === 'error') return { ok: false, status: 503, reason: REFUSE_CHAIN_UNREAD }
  if (onChain === 'gone') return { ok: false, status: 400, reason: `That transaction is not on ${where.chain}, so it is not a trade to post.` }
  const usd = onChain.usd
  if (usd == null || !Number.isFinite(usd) || !(usd > 0)) return { ok: false, status: 400, reason: REFUSE_NOTHING_MOVED }
  // Fail closed: a reader that did not say "two-sided" did not prove a trade.
  if (onChain.twoSided !== true) return { ok: false, status: 400, reason: REFUSE_ONE_WAY }
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
  const onChain = await readOnChain(opts.readNotional ?? readTradeOnChain, where.chainId, where.txHash, author.toLowerCase(), opts.timeoutMs)
  return decideProof(row, onChain, opts.showSize)
}
