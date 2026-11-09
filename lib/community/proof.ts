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
// A TRADE MOVES VALUE BOTH WAYS (QA-SECURITY-3 R1). The dollar read alone is
// the largest single transfer leg, in or out, so a self-send, a plain
// transfer to a friend or a deposit read as "size". The post therefore also
// needs the transaction to be TWO-SIDED for this wallet (`flowShape`): value
// left it in one asset and value reached it in another. One-way is refused.
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

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b0fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** WETH9 `Withdrawal(address indexed src, uint256 wad)`: a router unwrapping, i.e. native paid out by an internal call (no Transfer log names the wallet). */
const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
const topicAddr = (t: string | undefined) => (t && t.length === 66 ? `0x${t.slice(26)}`.toLowerCase() : '')

export interface FlowInput {
  wallet: string
  /** Native value sent with the call (wei). */
  txValue: bigint
  /** The chain's wrapped-native token (WETH on Base, …). */
  wrappedNative: string
  logs: { address: string; topics: readonly string[] }[]
}

/**
 * Pure: did value LEAVE this wallet in one asset and REACH it in another?
 *   out  = an ERC-20 Transfer FROM the wallet (to someone else), or native
 *          value sent with the call
 *   in   = an ERC-20 Transfer TO the wallet (from someone else) of a token it
 *          did not also send; or, when the wallet sent a token and nothing
 *          came back as a token, the wrapped-native token being UNWRAPPED in
 *          the same transaction (the swap paid out native by an internal call)
 * A self-transfer is neither. The same token out and back (a round trip, a
 * refund, a flash loan) is not two-sided. Pinned.
 */
export function flowShape(i: FlowInput): { out: boolean; in: boolean; twoSided: boolean } {
  const who = i.wallet.toLowerCase()
  const wrapped = i.wrappedNative.toLowerCase()
  const sent = new Set<string>()
  const got = new Set<string>()
  let unwrapped = false
  for (const log of i.logs) {
    const t0 = log.topics[0]?.toLowerCase()
    const token = log.address.toLowerCase()
    if (t0 === WITHDRAWAL_TOPIC && token === wrapped) unwrapped = true
    if (t0 !== TRANSFER_TOPIC || log.topics.length !== 3) continue // 3 topics = ERC-20 (an NFT transfer has 4)
    const from = topicAddr(log.topics[1])
    const to = topicAddr(log.topics[2])
    if (from === to) continue
    if (from === who) sent.add(token)
    if (to === who) got.add(token)
  }
  const nativeOut = i.txValue > BigInt(0)
  const out = nativeOut || sent.size > 0
  // An asset that came back AND went out is not an inflow (a round trip).
  const tokenIn = [...got].some((t) => !sent.has(t) && !(nativeOut && t === wrapped))
  // Native paid out: only when the wallet sent a TOKEN (not native) and the wrapped token was unwrapped.
  const nativeIn = !nativeOut && sent.size > 0 && unwrapped && !sent.has(wrapped)
  const inn = tokenIn || nativeIn
  return { out, in: inn, twoSided: out && inn }
}

const defaultReader: NotionalReader = async (chainId, txHash, wallet) => {
  const [{ onChainNotionalUsd }, { receiptClientFor }, { chainById }] = await Promise.all([import('@/lib/earned-answers'), import('@/lib/link-receipt-verify'), import('@/lib/chains')])
  const chain = chainById(chainId)
  const client = receiptClientFor(chainId)
  if (!chain || !client) return { usd: null, twoSided: false }
  const [r, tx, receipt] = await Promise.all([
    onChainNotionalUsd(chainId, txHash, wallet),
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ])
  if (!tx || !receipt || receipt.status !== 'success' || tx.from.toLowerCase() !== wallet.toLowerCase()) return { usd: null, twoSided: false }
  const shape = flowShape({ wallet, txValue: tx.value, wrappedNative: chain.wrappedNative, logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics as readonly string[] })) })
  return { usd: r.usd, twoSided: shape.twoSided }
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
  const onChain = await readOnChain(opts.readNotional ?? defaultReader, where.chainId, where.txHash, author.toLowerCase(), opts.timeoutMs)
  return decideProof(row, onChain, opts.showSize)
}
