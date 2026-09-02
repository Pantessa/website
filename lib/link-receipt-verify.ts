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

import prisma from '@/lib/db'
import { publicClientFor } from '@/lib/chains'
import { compileJobAsk } from '@/lib/jobs'
import { parseCadence } from '@/lib/dca'

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

export type ReceiptVerdict = 'verified' | 'unverified' | 'mismatch'

export interface ReceiptFacts {
  /** The wallet the EVENT claims signed (lowercased) — null refuses. */
  wallet: string | null
  /** eth_getTransactionByHash result (null = not found / RPC down). */
  tx: { from: string; to: string | null; input: string } | null
  /** Receipt status (null = no receipt yet / RPC down). */
  receiptStatus: 'success' | 'reverted' | null
  /** The link's built-artifact expectations for (slug, wallet). */
  expectations: { toAddr: string; selector: string | null }[]
  /** Another COUNTED event already holds this hash (single-use rule). */
  hashReused: boolean
}

export function decideReceiptVerdict(f: ReceiptFacts): ReceiptVerdict {
  if (f.hashReused) return 'mismatch' // recycling one real tx across events (T-R2)
  if (!f.wallet) return 'mismatch' // a signed claim with no signer can never bind
  // A readable tx from someone else refuses WITHOUT needing the receipt —
  // the sender is a property of the tx itself (T-R2; OP-stack system txs
  // whose receipts read oddly still refuse here).
  if (f.tx && f.tx.from.toLowerCase() !== f.wallet) return 'mismatch'
  if (!f.tx || f.receiptStatus == null) return 'unverified' // chain unreadable — delay, never mint (T-R4)
  if (f.receiptStatus === 'reverted') return 'mismatch'
  if (f.expectations.length === 0) return 'unverified' // no artifact on record — fail closed
  const to = (f.tx.to ?? '').toLowerCase()
  const sel = f.tx.input && f.tx.input.length >= 10 ? f.tx.input.slice(0, 10).toLowerCase() : null
  const hit = f.expectations.some(
    (e) => e.toAddr.toLowerCase() === to && (e.selector == null || sel == null || e.selector.toLowerCase() === sel),
  )
  return hit ? 'verified' : 'mismatch' // real tx, wrong target = spoof (T-R2)
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

function expectationOf(slug: string, wallet: string, tx: TxShape): { slug: string; wallet: string; chainId: number; toAddr: string; selector: string | null } | null {
  const to = typeof tx.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.to) ? tx.to.toLowerCase() : null
  if (!to) return null
  const chainId = typeof tx.chainId === 'number' && Number.isInteger(tx.chainId) ? tx.chainId : 8453
  const data = typeof tx.data === 'string' ? tx.data : ''
  const selector = data.length >= 10 ? data.slice(0, 10).toLowerCase() : null
  return { slug, wallet, chainId, toAddr: to, selector }
}

/** Record the built artifact's {to, selector, chainId} for an /i turn —
 *  the binding target for T-R2. Fail-soft: never breaks a chat turn. */
export async function recordTurnExpectations(reqBody: Record<string, unknown>, data: Record<string, unknown> | null): Promise<void> {
  try {
    if (!data) return
    const slug = typeof reqBody.intentLinkSlug === 'string' && /^[a-z0-9]{4,24}$/i.test(reqBody.intentLinkSlug) ? reqBody.intentLinkSlug : null
    const wallet =
      typeof reqBody.walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(reqBody.walletAddress)
        ? reqBody.walletAddress.toLowerCase()
        : null
    if (!slug || !wallet) return
    const rows: NonNullable<ReturnType<typeof expectationOf>>[] = []
    const txReq = data.txRequest as TxShape | undefined
    if (txReq && typeof txReq === 'object') {
      const e = expectationOf(slug, wallet, txReq)
      if (e) rows.push(e)
    }
    const chain = data.txChain as { steps?: { tx?: TxShape }[] } | undefined
    if (chain && Array.isArray(chain.steps)) {
      for (const s of chain.steps) {
        if (s?.tx && typeof s.tx === 'object') {
          const e = expectationOf(slug, wallet, s.tx)
          if (e) rows.push(e)
        }
      }
    }
    if (rows.length === 0) return
    // Dedupe within the batch; cross-batch dupes are harmless (any-match).
    const seen = new Set<string>()
    const unique = rows.filter((r) => {
      const k = `${r.chainId}:${r.toAddr}:${r.selector}`
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
  } catch {
    /* fail-soft by contract */
  }
}

// ---------------------------------------------------------------------------
// Verification (the RPC shell over the pure verdict)

/** Verify one signed/settled event row NOW. Returns the stored verdict.
 *  'verified'/'mismatch' are terminal; 'unverified' re-checks lazily. */
export async function verifyEventNow(eventId: string): Promise<ReceiptVerdict | 'attested'> {
  const ev = await prisma.intentLinkEvent.findUnique({ where: { id: eventId } })
  if (!ev) return 'unverified'
  if (ev.verification === 'verified' || ev.verification === 'mismatch' || ev.verification === 'attested')
    return ev.verification as ReceiptVerdict | 'attested'
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
  const client = publicClientFor(ev.chainId)
  if (!client) return settle('unverified')

  // Single-use hash across COUNTED events (any slug — recycling is the attack).
  const reuse = await prisma.intentLinkEvent
    .findFirst({ where: { id: { not: ev.id }, txHash: ev.txHash, verification: 'verified' }, select: { id: true } })
    .catch(() => null)

  // SEPARATE try/catches: one odd read must not blank the other's facts —
  // an OP-stack deposit tx's receipt read rejects while the tx itself reads
  // fine, and the tx's own `from` is already decisive for a foreign spoof.
  let tx: { from: string; to: string | null; input: string } | null = null
  let receiptStatus: 'success' | 'reverted' | null = null
  try {
    const t = await client.getTransaction({ hash: ev.txHash as `0x${string}` })
    tx = t ? { from: t.from, to: t.to ?? null, input: t.input } : null
  } catch {
    /* unknown hash / RPC down → tx stays null */
  }
  try {
    const r = await client.getTransactionReceipt({ hash: ev.txHash as `0x${string}` })
    receiptStatus = r ? (r.status === 'success' ? 'success' : 'reverted') : null
  } catch {
    /* receipt unreadable → status stays null */
  }

  const expectations = await prisma.intentLinkExpectation
    .findMany({ where: { slug: ev.slug, wallet: ev.wallet ?? '' }, select: { toAddr: true, selector: true } })
    .catch(() => [])

  return settle(
    decideReceiptVerdict({
      wallet: ev.wallet,
      tx,
      receiptStatus,
      expectations,
      hashReused: !!reuse,
    }),
  )
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
