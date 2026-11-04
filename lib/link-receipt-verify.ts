// lib/link-receipt-verify.ts — on-chain receipt verification for intent-link
// signed/settled events (security overnight 2026-09-01; threat model in
// squad-overnight-2026-09-01/security.md, T-R1..T-R7).
//
// A client-reported "signed" beacon used to fire real consequences on its
// word alone (agent webhook, broker_status flip, inbox drop, §4.4 budget).
// Now: the beacon carries the tx hash, the server reads the receipt off the
// chain registry's own RPCs, and binds it FOUR ways — status=success,
// tx.from == the event's claimed wallet, hash single-use across counted
// events, and to+selector ∈ the link's OWN built-artifact expectations
// (recorded at build time by the chat route's response choke). Fail-closed:
// anything unverifiable stores `unverified` and counts NOTHING until a lazy
// re-check succeeds; a provable spoof stores `mismatch`, terminal.
//
// Class honesty (T-R5): the verification class comes from the SERVER's own
// reading of the link's ask, never the client payload. Non-EVM-tx classes
// (CoW orders, HL venue actions, Snapshot votes, NFT orders, multi-leg
// jobs) store `attested` and keep today's behavior — their venue-specific
// settlement reads are the documented next tranche; job links lean on the
// runner's own between-leg on-chain arrival checks, which are stronger
// than a receipt read.
//
// RECEIPT BINDING (2026-11-04, squad five-million QA F1): a `verified` verdict
// used to bind a receipt to {to, selector} alone — and `POST /api/chat` records
// expectations for ANY body-claimed wallet (builds are connect-to-act), so a
// planted "Swap $5 of USDC" expectation plus ANY historical USDC approve the
// victim ever sent read `verified`, bound the victim to a stranger's link for
// life (referred_wallets) and counted the beacon's own dollars. Now a build is
// recorded as the keccak256 of the EXACT calldata it produced plus the moment
// it left this server and the chain head the server saw; a receipt verifies
// only when its input hashes to that, it was mined AFTER the build, the sender
// is the wallet and it succeeded — once per build. A {to, selector}-only match
// (a row recorded before the binding) ATTESTS and never verifies; a tx that
// matches nobody's build stays `unverified`.

import prisma from '@/lib/db'
import { createPublicClient, fallback, http, keccak256, type Hex, type PublicClient } from 'viem'
import { APP_CHAINS, chainById, chainByKey, publicClientFor } from '@/lib/chains'
import { compileJobAsk } from '@/lib/jobs'
import { parseCadence } from '@/lib/dca'
import { COUNTED_TURN_WHERE, COUNTED_TURN_SQL, COUNTED_VERIFICATIONS, isCountedTurn, isDevOrigin } from '@/lib/value-origin'

// The money side (squad security S-2, 2026-09-08): the SAME verdict now
// stamps `embed_turns.verification` at the telemetry write site, and every
// reader a stranger can see money on composes COUNTED_TURN_WHERE. Re-exported
// here so the two tables' consumers import one module.
export { COUNTED_TURN_WHERE, COUNTED_TURN_SQL, COUNTED_VERIFICATIONS, isCountedTurn }

// ---------------------------------------------------------------------------
// Classes (pure)

export type ReceiptClass = 'evm-tx' | 'job' | 'order' | 'hl' | 'vote' | 'nft'

const HL_RE = /\b(?:long|short|perp|perps|leverage|hyperliquid|stop[\s-]?loss|take[\s-]?profit)\b/i
const VOTE_RE = /\b(?:vote|proposal|snapshot|governance)\b/i
const NFT_RE = /\bnfts?\b|\bopensea\b|\bseaport\b/i
const ORDER_RE = /\blimit\s+(?:order|buy|sell)\b|\blimit-order\b/i

/** SERVER-derived verification class for a link (T-R5): the ask decides,
 *  the client never does. Ladder order matters — a compound/cadence/mosaic
 *  ask compiles to a JOB whose legs the runner re-verifies on-chain. */
export function expectedReceiptClass(ask: string, linkKind?: string | null): ReceiptClass {
  if (linkKind === 'mosaic') return 'job'
  try {
    const compiled = compileJobAsk(ask)
    if (compiled && !('problem' in compiled) && !('clarify' in compiled)) return 'job'
  } catch {
    /* class ladder must never throw */
  }
  try {
    if (parseCadence(ask)) return 'job'
  } catch {
    /* ditto */
  }
  if (HL_RE.test(ask)) return 'hl'
  if (VOTE_RE.test(ask)) return 'vote'
  if (NFT_RE.test(ask)) return 'nft'
  if (ORDER_RE.test(ask)) return 'order'
  return 'evm-tx'
}

/** Pull a 32-byte tx hash out of a raw hash or an explorer URL. */
export function extractTxHash(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/0x[0-9a-fA-F]{64}/)
  return m ? m[0].toLowerCase() : null
}

// ---------------------------------------------------------------------------
// The verdict (pure — the harness pins this matrix; a controlled REAL
// receipt would need real money, so the decision is the tested core and the
// RPC shell stays thin)

export type ReceiptVerdict = 'verified' | 'attested' | 'unverified' | 'mismatch'

/** One recorded build, as the verdict reads it. A row with no `calldataHash`
 *  is a LEGACY expectation (recorded before 2026-11-04): it can attest a
 *  {to, selector} match and never verify one. */
export interface ExpectationFact {
  id?: string
  toAddr: string
  selector: string | null
  /** keccak256 of the exact calldata the builder produced (lowercased hex). */
  calldataHash?: string | null
  /** When the calldata left this server. */
  recordedAt?: Date | string | number | null
  /** The chain head this server saw when it produced the calldata. */
  recordedBlock?: number | null
  /** The transaction that spent this build on its first verified use. */
  usedTxHash?: string | null
}

export interface ReceiptFacts {
  /** The wallet the EVENT claims signed (lowercased) — null refuses. */
  wallet: string | null
  /** eth_getTransactionByHash result (null = not found / RPC down); the block
   *  the receipt names, when the receipt was read. */
  tx: { from: string; to: string | null; input: string; blockNumber?: number | null } | null
  /** Receipt status (null = no receipt yet / RPC down). */
  receiptStatus: 'success' | 'reverted' | null
  /** The including block's timestamp in ms (null / absent = not read yet).
   *  Only the fallback fence reads it — see {@link minedAfterBuild}. */
  blockTimeMs?: number | null
  /** The hash under judgment (lowercased) — the consumption rule reads it. */
  txHash?: string | null
  /** The link's built-artifact expectations for (slug, wallet). */
  expectations: ExpectationFact[]
  /** Another COUNTED event already holds this hash (single-use rule). */
  hashReused: boolean
}

/** Honest clock slack between this server and a chain's block timestamps:
 *  Base's unsafe head trails the wall clock by up to a block, Ethereum's slot
 *  time is exact, NTP drift is seconds. Only the FALLBACK fence reads it — a
 *  build that observed the chain's head is fenced by block HEIGHT, which has
 *  no clock in it, and that is the fence every live recording site sets. */
export const RECEIPT_CLOCK_SLACK_MS = 90_000

/** keccak256 of a transaction's calldata — '' / undefined (a native send) hashes
 *  as the empty byte string, exactly what the chain reports as `input: 0x`. */
export function calldataHashOf(data: unknown): string {
  const hex = typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data) ? data.toLowerCase() : '0x'
  return keccak256(hex as Hex).toLowerCase()
}

/** Was the receipt's block AFTER the build? Height when the build observed
 *  the head (strict: the head it saw was already sealed), else block time
 *  against `recordedAt` with the clock slack; a bound row that carries
 *  neither fails closed; a fence that needs a block time nobody read yet says
 *  so (the shell reads the block and asks again). */
export function minedAfterBuild(blockNumber: number | null | undefined, blockTimeMs: number | null | undefined, e: ExpectationFact): 'after' | 'before' | 'unread' {
  if (e.recordedBlock != null && blockNumber != null) return blockNumber > e.recordedBlock ? 'after' : 'before'
  const at = e.recordedAt == null ? NaN : new Date(e.recordedAt).getTime()
  if (Number.isNaN(at)) return 'before'
  if (blockTimeMs == null) return 'unread'
  return blockTimeMs >= at - RECEIPT_CLOCK_SLACK_MS ? 'after' : 'before'
}

export interface ReceiptJudgement {
  verdict: ReceiptVerdict
  /** The bound expectation a VERIFIED verdict rests on — the shell spends it. */
  hit?: ExpectationFact
  /** The one-line reason, for logs and the harness. */
  reason: string
}

/** The pure verdict (the harness pins this matrix; a controlled REAL receipt
 *  would need real money, so the decision is the tested core and the RPC
 *  shell stays thin). Ladder: the reuse / signer / sender / status rules
 *  refuse first; then a BOUND expectation (exact calldata, mined after its
 *  build, not spent by another tx) verifies; a bound match whose fence needs
 *  an unread block time delays; a bound match that was mined before its
 *  build or spent elsewhere is a replay (mismatch, terminal); a LEGACY
 *  {to, selector} match attests; anything else matches nobody's build and
 *  stays unverified. */
export function judgeReceipt(f: ReceiptFacts): ReceiptJudgement {
  if (f.hashReused) return { verdict: 'mismatch', reason: 'hash already counted' } // recycling one real tx across events (T-R2)
  if (!f.wallet) return { verdict: 'mismatch', reason: 'no signer' } // a signed claim with no signer can never bind
  // A readable tx from someone else refuses WITHOUT needing the receipt —
  // the sender is a property of the tx itself (T-R2; OP-stack system txs
  // whose receipts read oddly still refuse here).
  if (f.tx && f.tx.from.toLowerCase() !== f.wallet) return { verdict: 'mismatch', reason: 'sent by another wallet' }
  if (!f.tx || f.receiptStatus == null) return { verdict: 'unverified', reason: 'chain unreadable' } // delay, never mint (T-R4)
  if (f.receiptStatus === 'reverted') return { verdict: 'mismatch', reason: 'reverted' }
  if (f.expectations.length === 0) return { verdict: 'unverified', reason: 'no build on record' } // fail closed
  const to = (f.tx.to ?? '').toLowerCase()
  const inputHash = calldataHashOf(f.tx.input)
  const sel = typeof f.tx.input === 'string' && f.tx.input.length >= 10 ? f.tx.input.slice(0, 10).toLowerCase() : null
  const txHash = f.txHash ? f.txHash.toLowerCase() : null
  let unread = false
  let replay: string | null = null
  for (const e of f.expectations) {
    if (!e.calldataHash) continue
    if (e.toAddr.toLowerCase() !== to || e.calldataHash.toLowerCase() !== inputHash) continue
    if (e.usedTxHash && (!txHash || e.usedTxHash.toLowerCase() !== txHash)) {
      replay = 'build already spent by another transaction'
      continue
    }
    const fence = minedAfterBuild(f.tx.blockNumber, f.blockTimeMs, e)
    if (fence === 'after') return { verdict: 'verified', hit: e, reason: 'exact calldata, mined after its build' }
    if (fence === 'unread') {
      unread = true
      continue
    }
    replay = 'mined before its build'
  }
  if (unread) return { verdict: 'unverified', reason: 'block time unread' }
  if (replay) return { verdict: 'mismatch', reason: replay }
  const legacy = f.expectations.some(
    (e) => !e.calldataHash && e.toAddr.toLowerCase() === to && (e.selector == null || sel == null || e.selector.toLowerCase() === sel),
  )
  if (legacy) return { verdict: 'attested', reason: 'legacy {to, selector} match — no calldata on record' }
  return { verdict: 'unverified', reason: "matches nobody's build" }
}

export function decideReceiptVerdict(f: ReceiptFacts): ReceiptVerdict {
  return judgeReceipt(f).verdict
}

/** The verdicts that COUNT (fire webhooks, flip status, drop inbox items,
 *  budget math). NULL = legacy pre-feature rows — they keep counting
 *  (T-R6). Exported once so every consumer filters identically. */
export const COUNTED_EVENT_WHERE: { OR: ({ verification: null } | { verification: { in: string[] } })[] } = {
  OR: [{ verification: null }, { verification: { in: ['verified', 'attested'] } }],
}

/** The same filter for raw-SQL consumers (assertProposalBudget). */
export const COUNTED_EVENT_SQL = "(verification IS NULL OR verification IN ('verified','attested'))"

// ---------------------------------------------------------------------------
// Expectations recording (the chat route's response choke calls this)

type TxShape = { to?: unknown; data?: unknown; chainId?: unknown }

/** One EVM transaction an artifact offers the wallet, normalized. */
export interface BuiltTx {
  to: string
  data: string
  chainId: number
}

/** Every EVM transaction a chat artifact offers the wallet: the lone
 *  `txRequest`, or each step of a `txChain` (one expectation PER STEP — the
 *  approve and the swap are both signed). Pure; a step with no readable `to`
 *  is skipped. */
export function builtTxsOf(data: Record<string, unknown> | null | undefined): BuiltTx[] {
  if (!data || typeof data !== 'object') return []
  const out: BuiltTx[] = []
  const push = (tx: TxShape | undefined) => {
    if (!tx || typeof tx !== 'object') return
    const to = typeof tx.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.to) ? tx.to.toLowerCase() : null
    if (!to) return
    const chainId = typeof tx.chainId === 'number' && Number.isInteger(tx.chainId) ? tx.chainId : 8453
    const d = typeof tx.data === 'string' && /^0x[0-9a-fA-F]*$/.test(tx.data) ? tx.data.toLowerCase() : '0x'
    out.push({ to, data: d, chainId })
  }
  push(data.txRequest as TxShape | undefined)
  const chain = data.txChain as { steps?: { tx?: TxShape }[] } | undefined
  if (chain && Array.isArray(chain.steps)) for (const s of chain.steps) push(s?.tx)
  return out
}

export interface ExpectationRow {
  slug: string
  wallet: string
  chainId: number
  toAddr: string
  selector: string | null
  calldataHash: string
  recordedAt: Date
  recordedBlock: number | null
}

/** The row one built transaction records: {to, selector} as before, plus the
 *  calldata's hash, the build moment and the head the server saw on that
 *  chain (null when the read failed — the time fence then applies). */
export function expectationOf(slug: string, wallet: string, tx: BuiltTx, at: { recordedAt: Date; heads?: Record<number, number | null> }): ExpectationRow {
  const selector = tx.data.length >= 10 ? tx.data.slice(0, 10) : null
  const head = at.heads?.[tx.chainId]
  return {
    slug,
    wallet: wallet.toLowerCase(),
    chainId: tx.chainId,
    toAddr: tx.to,
    selector,
    calldataHash: calldataHashOf(tx.data),
    recordedAt: at.recordedAt,
    recordedBlock: typeof head === 'number' && Number.isFinite(head) ? head : null,
  }
}

/** The chain head on every chain a build touches, read BEFORE the response
 *  carrying the build goes out (a head read after the wallet could have sent
 *  the tx would fence an honest signature out). Per chain, timeboxed; a chain
 *  that does not answer records null and falls back to the time fence. A
 *  stale head only widens the fence (lower is more permissive), never
 *  narrows it. */
export async function observeChainHeads(chainIds: number[], timeoutMs = 1500): Promise<Record<number, number | null>> {
  const heads: Record<number, number | null> = {}
  await Promise.all(
    [...new Set(chainIds)].map(async (id) => {
      heads[id] = null
      try {
        const client = receiptClientFor(id)
        if (!client) return
        const n = await Promise.race([client.getBlockNumber(), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
        if (typeof n === 'bigint' && n > BigInt(0) && n < BigInt(Number.MAX_SAFE_INTEGER)) heads[id] = Number(n)
      } catch {
        /* unreadable head → time fence */
      }
    }),
  )
  return heads
}

/** Record every built transaction of ONE build for (slug, wallet). Returns
 *  the rows written. Fail-soft by contract: never breaks the response that
 *  carried the build. Every recording site passes the `recordedAt` and the
 *  heads it captured BEFORE responding. */
export async function recordBuiltExpectations(args: { slug: string; wallet: string; txs: BuiltTx[]; recordedAt: Date; heads?: Record<number, number | null> }): Promise<number> {
  try {
    const rows = args.txs.map((tx) => expectationOf(args.slug, args.wallet, tx, { recordedAt: args.recordedAt, heads: args.heads }))
    if (rows.length === 0) return 0
    // Dedupe within the batch by exact calldata; cross-batch dupes are
    // harmless (any-match, each spent on its own first verified use).
    const seen = new Set<string>()
    const unique = rows.filter((r) => {
      const k = `${r.chainId}:${r.toAddr}:${r.calldataHash}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    await prisma.intentLinkExpectation.createMany({ data: unique })
    // Lazy hygiene: expectations are a 7-day binding window.
    if (Math.random() < 0.02) {
      void prisma.intentLinkExpectation
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } })
        .catch(() => {})
    }
    return unique.length
  } catch {
    return 0 /* fail-soft by contract */
  }
}

/** Record the built artifact's transactions for a chat turn — the binding
 *  target for T-R2. Fail-soft: never breaks a chat turn. `at` is what the
 *  route captured before it responded (the build moment + the heads it
 *  observed); a caller that passes none records the moment of the write with
 *  no head, i.e. the time fence alone. */
export async function recordTurnExpectations(
  reqBody: Record<string, unknown>,
  data: Record<string, unknown> | null,
  at: { recordedAt?: Date; heads?: Record<number, number | null> } = {},
): Promise<void> {
  try {
    if (!data) return
    // S-2: a turn with NO link attribution records under CHAT_EXPECTATION_SLUG
    // so its own signed beacon can verify too (a slug-shaped value that isn't
    // a slug still refuses — never bind a build to a name we can't read).
    const slug =
      typeof reqBody.intentLinkSlug === 'string' && reqBody.intentLinkSlug
        ? /^[a-z0-9-]{4,24}$/i.test(reqBody.intentLinkSlug)
          ? reqBody.intentLinkSlug
          : null
        : CHAT_EXPECTATION_SLUG
    const wallet =
      typeof reqBody.walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(reqBody.walletAddress)
        ? reqBody.walletAddress.toLowerCase()
        : null
    if (slug === null || !wallet) return
    await recordBuiltExpectations({ slug, wallet, txs: builtTxsOf(data), recordedAt: at.recordedAt ?? new Date(), heads: at.heads })
  } catch {
    /* fail-soft by contract */
  }
}

/** The expectation columns the verdict reads. */
const EXPECTATION_SELECT = { id: true, toAddr: true, selector: true, calldataHash: true, recordedAt: true, recordedBlock: true, usedTxHash: true } as const

/** Judge, reading the block's time only when a bound match needs it (a build
 *  that observed the head is fenced by height and costs no extra read). */
async function judgeWithChainTime(facts: ReceiptFacts, chainId: number): Promise<ReceiptJudgement> {
  const first = judgeReceipt(facts)
  if (first.verdict !== 'unverified' || first.reason !== 'block time unread' || facts.tx?.blockNumber == null) return first
  const blockTimeMs = await readBlockTimeMs(chainId, facts.tx.blockNumber)
  if (blockTimeMs == null) return first
  return judgeReceipt({ ...facts, blockTimeMs })
}

/** Spend the build a VERIFIED verdict rests on — ONE conditional write, so
 *  two beacons racing with two different transactions of identical calldata
 *  can only ever spend it once (the loser stays `unverified`; its re-check
 *  then reads the row as spent). The funnel event and the money row of the
 *  SAME signature share one hash and both pass. */
async function spendIfVerified(j: ReceiptJudgement, txHash: string): Promise<ReceiptVerdict> {
  if (j.verdict !== 'verified') return j.verdict
  if (!j.hit?.id) return 'unverified' // a verified verdict always names its build; a fixture without an id cannot be spent
  const hash = txHash.toLowerCase()
  const spent = await prisma.intentLinkExpectation
    .updateMany({ where: { id: j.hit.id, OR: [{ usedTxHash: null }, { usedTxHash: hash }] }, data: { usedTxHash: hash } })
    .catch(() => ({ count: 0 }))
  return spent.count === 1 ? 'verified' : 'unverified'
}

// ---------------------------------------------------------------------------
// Verification (the RPC shell over the pure verdict)

/** Verify one signed/settled event row NOW. Returns the stored verdict.
 *  'verified'/'mismatch' are terminal; 'unverified' re-checks lazily. */
export async function verifyEventNow(eventId: string): Promise<ReceiptVerdict> {
  const ev = await prisma.intentLinkEvent.findUnique({ where: { id: eventId } })
  if (!ev) return 'unverified'
  if (ev.verification === 'verified' || ev.verification === 'mismatch' || ev.verification === 'attested')
    return ev.verification as ReceiptVerdict
  const link = await prisma.intentLink.findUnique({ where: { id: ev.slug }, select: { ask: true, kind: true } })
  if (!link) return 'unverified'

  const klass = expectedReceiptClass(link.ask, link.kind)
  if (klass !== 'evm-tx') {
    await prisma.intentLinkEvent.update({ where: { id: ev.id }, data: { verification: 'attested', verifiedAt: new Date() } })
    return 'attested'
  }

  const settle = async (v: ReceiptVerdict) => {
    // 'unverified' keeps re-checking; terminal verdicts stamp verifiedAt.
    await prisma.intentLinkEvent.update({
      where: { id: ev.id },
      data: { verification: v, ...(v === 'unverified' ? {} : { verifiedAt: new Date() }) },
    })
    return v
  }

  if (!ev.txHash || !ev.chainId) return settle(ev.wallet ? 'unverified' : 'mismatch') // hashless: fail closed (T-R1); walletless can never verify
  if (!receiptClientFor(ev.chainId)) return settle('unverified')

  // Single-use hash across COUNTED events (any slug — recycling is the attack).
  const reuse = await prisma.intentLinkEvent
    .findFirst({ where: { id: { not: ev.id }, txHash: ev.txHash, verification: 'verified' }, select: { id: true } })
    .catch(() => null)

  const facts = await readReceiptFacts(ev.chainId, ev.txHash)
  const expectations = await prisma.intentLinkExpectation
    .findMany({ where: { slug: ev.slug, wallet: ev.wallet ?? '' }, select: EXPECTATION_SELECT })
    .catch(() => [])

  const judged = await judgeWithChainTime({ wallet: ev.wallet, ...facts, txHash: ev.txHash, expectations, hashReused: !!reuse }, ev.chainId)
  return settle(await spendIfVerified(judged, ev.txHash))
}

/** The client the receipt reads go through. MEASURED 2026-09-08 (squad
 *  security round 3): publicnode's free tier answers `eth_getTransactionReceipt`
 *  on Base with "Archive requests require a personal token" for a tx FIVE
 *  blocks old — every receipt, every age — while the chain's own default RPC
 *  answers in ~150ms. The registry pins publicnode for Base / Ethereum /
 *  Arbitrum (lib/chains.ts, server-side reads at 'latest' are fine there), so
 *  through that client alone the `verified` verdict was unreachable and every
 *  honest sign stayed `unverified` forever. Receipt reads therefore run on a
 *  fallback transport — the pin first, the chain's default RPC when the pin
 *  refuses (viem's fallback moves on any non-user-rejection error). Read-only,
 *  cached per chain. */
const receiptClients = new Map<number, PublicClient>()
export function receiptClientFor(chainId: number): PublicClient | null {
  const chain = chainById(chainId)
  if (!chain) return null
  if (!chain.rpcUrl) return publicClientFor(chainId)
  let client = receiptClients.get(chainId)
  if (!client) {
    client = createPublicClient({ chain: chain.viem, transport: fallback([http(chain.rpcUrl), http()]) })
    receiptClients.set(chainId, client)
  }
  return client
}

/** The chain reads behind a verdict. SEPARATE try/catches: one odd read
 *  must not blank the other's facts — an OP-stack deposit tx's receipt read
 *  rejects while the tx itself reads fine, and the tx's own `from` is already
 *  decisive for a foreign spoof. */
async function readReceiptFacts(chainId: number, txHash: string): Promise<Pick<ReceiptFacts, 'tx' | 'receiptStatus'>> {
  const client = receiptClientFor(chainId)
  let tx: ReceiptFacts['tx'] = null
  let receiptStatus: ReceiptFacts['receiptStatus'] = null
  if (!client) return { tx, receiptStatus }
  try {
    const t = await client.getTransaction({ hash: txHash as `0x${string}` })
    tx = t ? { from: t.from, to: t.to ?? null, input: t.input, blockNumber: t.blockNumber != null ? Number(t.blockNumber) : null } : null
  } catch {
    /* unknown hash / RPC down → tx stays null */
  }
  try {
    const r = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
    receiptStatus = r ? (r.status === 'success' ? 'success' : 'reverted') : null
    // The receipt's block is the one the fence reads (a pending tx has none).
    if (r && tx && r.blockNumber != null) tx = { ...tx, blockNumber: Number(r.blockNumber) }
  } catch {
    /* receipt unreadable → status stays null */
  }
  return { tx, receiptStatus }
}

/** The including block's timestamp (ms) — read only when a bound match has
 *  no head on record (the time fence). Null when the chain does not answer:
 *  the verdict then stays `unverified` and the lazy re-check asks again. */
async function readBlockTimeMs(chainId: number, blockNumber: number): Promise<number | null> {
  const client = receiptClientFor(chainId)
  if (!client) return null
  try {
    const b = await client.getBlock({ blockNumber: BigInt(blockNumber) })
    return b && typeof b.timestamp === 'bigint' ? Number(b.timestamp) * 1000 : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The MONEY side — embed_turns (squad security S-2, 2026-09-08)
//
// The `signed` telemetry beacon (components/ChatInterface reportEmbedSigned,
// JobCard, the panels) is the row every money reader keys on: creator
// earnings + claimable USDC (/api/intent-links, /claims), the write-once
// referral, the public money-moved number (/activity, LinksHero), the /i +
// /l share cards, the links board, the agent record, the mosaic gallery, the
// sign cap. It used to count on the browser's word. Now the write site stamps
// `embed_turns.verification` with the SAME verdict the funnel event gets —
// same pure matrix, same expectations table, same single-use rule (per table)
// — and every one of those readers composes COUNTED_TURN_WHERE.
//
// Class honesty for a turn: a link-attributed row takes its class from the
// LINK's ask (server truth, T-R5); a first-party chat / keyed-embed row has no
// ask on record (first-party beacons carry no prompt by design), so its class
// comes from the allowlisted `artifact` — an EVM tx / tx-chain verifies
// against the expectations the chat route recorded for (slug '', wallet); the
// non-EVM artifacts (order / HL / vote / NFT / job legs) store `attested`,
// exactly the tranche #685 documented for events. Ledgering those at their
// relays (/api/cow/submit, /api/hl/submit, the jobs runner) is the next cut.

/** Expectation key for turns with no link attribution (first-party chat, a
 *  keyed embed): the chat route records every wallet-bound build under it. */
export const CHAT_EXPECTATION_SLUG = ''

/** The chain a telemetry row's receipt lives on: the beacon's `chainId` when
 *  it names a registry chain, else the stored label ('base', 'ethereum', a
 *  decimal or hex id), else the explorer host inside txUrl. Null = unknown →
 *  the row stays `unverified` (never guess a chain). */
export function chainIdOfTurn(t: { chain?: string | null; txUrl?: string | null }, bodyChainId?: unknown): number | null {
  if (typeof bodyChainId === 'number' && Number.isInteger(bodyChainId) && chainById(bodyChainId)) return bodyChainId
  const label = (t.chain ?? '').trim().toLowerCase()
  if (label) {
    const byKey = chainByKey(label)
    if (byKey) return byKey.id
    const n = /^0x[0-9a-f]+$/.test(label) ? parseInt(label, 16) : /^\d+$/.test(label) ? Number(label) : NaN
    if (Number.isInteger(n) && chainById(n)) return n
  }
  if (t.txUrl) {
    try {
      const host = new URL(t.txUrl).host.toLowerCase()
      const hit = APP_CHAINS.find((c) => {
        try {
          return new URL(c.explorerTx).host.toLowerCase() === host
        } catch {
          return false
        }
      })
      if (hit) return hit.id
    } catch {
      /* not a URL */
    }
  }
  return null
}

const EVM_ARTIFACTS = new Set(['tx', 'tx-chain'])

/** The verification class of a telemetry row (see the module note). */
export async function expectedTurnClass(t: { intentLinkSlug?: string | null; artifact?: string | null }): Promise<ReceiptClass> {
  if (t.intentLinkSlug) {
    const link = await prisma.intentLink.findUnique({ where: { id: t.intentLinkSlug }, select: { ask: true, kind: true } }).catch(() => null)
    if (link) return expectedReceiptClass(link.ask, link.kind)
  }
  return EVM_ARTIFACTS.has(t.artifact ?? '') ? 'evm-tx' : 'job'
}

/** Verify one `signed` telemetry row NOW and stamp it. Returns the stored
 *  verdict. Terminal verdicts (verified / attested / mismatch / dev) never
 *  re-run; `unverified` re-checks lazily via {@link reverifyPendingTurns}.
 *  Fail-soft by contract: a crash leaves the row `unverified` (counts
 *  nothing) rather than throwing into the beacon. */
export async function verifyTurnNow(turnId: string, bodyChainId?: unknown): Promise<string> {
  try {
    const t = await prisma.embedTurn.findUnique({
      where: { id: turnId },
      select: { id: true, outcome: true, origin: true, embedKeyId: true, artifact: true, chain: true, txUrl: true, walletAddress: true, intentLinkSlug: true, verification: true },
    })
    if (!t || t.outcome !== 'signed') return 'unverified'
    if (t.verification && t.verification !== 'unverified') return t.verification

    const settle = async (v: string, chainKey?: string) => {
      await prisma.embedTurn.update({ where: { id: t.id }, data: { verification: v, ...(chainKey && !t.chain ? { chain: chainKey } : {}) } })
      return v
    }

    // `dev`: a FIRST-PARTY beacon from a localhost / fixture-TLD build. The
    // first-party lane already refuses any origin but the deployment's own
    // host, so this branch is unreachable on production; on a local build it
    // keeps the creator-surface convention (a dev's own test sign shows in
    // their scoped view) and the harness's money-math pins honest without a
    // real receipt. Keyed-embed beacons (a public yfe_ key is in every host
    // page's source) never get it.
    if (!t.embedKeyId && isDevOrigin(t.origin)) return settle('dev')

    const klass = await expectedTurnClass(t)
    if (klass !== 'evm-tx') return settle('attested')

    const wallet = t.walletAddress ? t.walletAddress.toLowerCase() : null
    if (!wallet) return settle('mismatch') // a signed claim with no signer can never bind
    const txHash = extractTxHash(t.txUrl)
    const chainId = chainIdOfTurn(t, bodyChainId)
    if (!txHash || !chainId) return settle('unverified') // hashless / chainless: fail closed (T-R1)
    if (!receiptClientFor(chainId)) return settle('unverified')

    // Single-use hash across COUNTED turns (any slug, any wallet — recycling
    // one real tx across beacons is the attack). Per table: the funnel event
    // for the SAME sign legitimately shares the hash.
    const reuse = await prisma.embedTurn
      .findFirst({ where: { id: { not: t.id }, verification: 'verified', txUrl: { contains: txHash, mode: 'insensitive' } }, select: { id: true } })
      .catch(() => null)
    const facts = await readReceiptFacts(chainId, txHash)
    const expectations = await prisma.intentLinkExpectation
      .findMany({ where: { slug: t.intentLinkSlug ?? CHAT_EXPECTATION_SLUG, wallet }, select: EXPECTATION_SELECT })
      .catch(() => [])
    const judged = await judgeWithChainTime({ wallet, ...facts, txHash, expectations, hashReused: !!reuse }, chainId)
    return settle(await spendIfVerified(judged, txHash), chainById(chainId)?.key)
  } catch {
    return 'unverified'
  }
}

/** Lazy re-check for `unverified` signed turns — the creator's studio poll,
 *  the claims door and the public scoreboard land here (bounded: ten rows,
 *  the 7-day window). Never throws into a read path. */
export async function reverifyPendingTurns(where: { intentLinkSlug?: { in: string[] }; walletAddress?: { in: string[] } } = {}): Promise<number> {
  try {
    const pending = await prisma.embedTurn.findMany({
      where: {
        ...where,
        outcome: 'signed',
        verification: 'unverified',
        createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    let promoted = 0
    for (const p of pending) {
      const v = await verifyTurnNow(p.id)
      if ((COUNTED_VERIFICATIONS as readonly string[]).includes(v)) promoted++
    }
    return promoted
  } catch {
    return 0
  }
}

/** Lazy re-check for a slug's pending events (broker_status polls land
 *  here). Newly counted events fire the deferred webhook via the callback —
 *  passed in to avoid a broker-exec import cycle. */
export async function reverifyPendingForSlug(
  slug: string,
  onCounted?: (slug: string, kind: 'signed' | 'settled', valueUsd: number | null) => void | Promise<void>,
): Promise<void> {
  try {
    const pending = await prisma.intentLinkEvent.findMany({
      where: {
        slug,
        kind: { in: ['signed', 'settled'] },
        verification: 'unverified',
        createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
      },
      select: { id: true, kind: true, valueUsd: true },
      take: 10,
    })
    for (const p of pending) {
      const v = await verifyEventNow(p.id)
      if ((v === 'verified' || v === 'attested') && onCounted) {
        await onCounted(slug, p.kind as 'signed' | 'settled', p.valueUsd)
      }
    }
  } catch {
    /* lazy — never throws into a read path */
  }
}
