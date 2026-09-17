// ─────────────────────────────────────────────────────────────────────────
//  AUTOPILOT UNWIND — the I/O half, shared by the Spot Guardian and the DCA
//  autopilot sweeps. The pure rules (ledger, keys, refund guard, decision
//  table) live in lib/autopilot-unwind.ts; this file sends, waits and reads.
//
//  After a pull lands, settleRun drives one run to where the chain proves
//  the money went:
//    sale attempt 1 (built and guarded BEFORE the pull)
//      → if it didn't fill: attempt 2, rebuilt fresh and re-guarded against
//        the same floor (in-pass only, and not while the kill switch is on)
//      → if that didn't fill either: the refund, guarded, back to the owner
//    and any send whose outcome it can't see yet parks the run UNWINDING for
//    the next pass's reconcile, which returns the money but never sells late.
//
//  Every send is written to the run's ledger BEFORE it goes out and carries
//  a derived CDP idempotency key, so a crash, a timeout, or the SDK's own
//  HTTP retry can never send the same money twice.
// ─────────────────────────────────────────────────────────────────────────

import { spendPermissionManagerAbi } from '@coinbase/cdp-sdk'
import type { TransactionReceipt } from 'viem'
import { publicClientFor } from '@/lib/chains'
import { sendSpenderTx } from '@/lib/cdp'
import { SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import type { DcaSpendPermission } from '@/lib/dca-auto'
import {
  classifySendError,
  decideUnwind,
  guardRefund,
  KEY_REPLAY_WINDOW_SEC,
  parseLedger,
  planRefund,
  pullEvidence,
  serializeLedger,
  spenderTxKey,
  swapDeadlineOf,
  upsertLedger,
  type HeldForm,
  type LedgerEntry,
  type LedgerStep,
  type RunTable,
} from '@/lib/autopilot-unwind'

/** Both autopilots run on Base. */
export const AUTOPILOT_CHAIN_ID = 8453
/** The first sale plus one fresh retry, then the refund. */
export const MAX_SALE_ATTEMPTS = 2
/** Refund sends refused before broadcast (say, the spender is out of gas)
 *  retry each pass under a new key, up to this many, then wait for a person. */
const MAX_REFUND_ATTEMPTS = 10
/** Receipt wait per send. Base makes a block every 2s; the cron's function
 *  budget is 60s, and a wait that outlives it strands the run mid-flight. */
const RECEIPT_TIMEOUT_MS = 25_000
/** Sends whose outcome CDP didn't return (a 5xx, a dropped connection) are
 *  asked again under the same key this many times before the run parks. */
const SEND_TRIES = 3

const nowSec = () => Math.floor(Date.now() / 1000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const firstLine = (s: string) => s.split('\n')[0].trim()

// ── The ledger, persisted on the run row ────────────────────────────────────

export class RunLedger {
  private constructor(
    readonly table: RunTable,
    readonly runId: string,
    public entries: LedgerEntry[],
    private readonly save: (json: string) => Promise<void>,
  ) {}

  /** null = the stored ledger doesn't parse: a person has to look. */
  static open(table: RunTable, runId: string, raw: string | null, save: (json: string) => Promise<void>): RunLedger | null {
    const entries = parseLedger(raw)
    return entries ? new RunLedger(table, runId, entries, save) : null
  }

  /** Write-ahead: persist first, then commit. An intent the database never
   *  took is an intent that is never sent. */
  async intent(entry: LedgerEntry): Promise<void> {
    const next = upsertLedger(this.entries, entry)
    await this.save(serializeLedger(next))
    this.entries = next
  }

  /** An answer about a send already on its way: kept in memory even if the
   *  write fails, so the next write carries it (a lost write costs the next
   *  pass one replayed key, never a second send). */
  async note(entry: LedgerEntry): Promise<void> {
    this.entries = upsertLedger(this.entries, entry)
    await this.save(serializeLedger(this.entries)).catch(() => {})
  }
}

export interface SaleStep {
  step: LedgerStep
  to: string
  data: string
  /** Decimal wei. */
  value: string
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type SendResult =
  | { outcome: 'success'; hash: `0x${string}`; receipt: TransactionReceipt }
  | { outcome: 'reverted'; hash: `0x${string}`; words: string }
  | { outcome: 'refused'; words: string }
  | { outcome: 'unresolved'; hash?: `0x${string}`; words: string }

async function awaitReceipt(hash: `0x${string}`, timeoutMs: number): Promise<{ receipt: TransactionReceipt | null; words: string }> {
  const client = publicClientFor(AUTOPILOT_CHAIN_ID)
  if (!client) return { receipt: null, words: 'No Base RPC client to confirm the transaction.' }
  try {
    return { receipt: await client.waitForTransactionReceipt({ hash, timeout: timeoutMs }), words: '' }
  } catch (e) {
    return { receipt: null, words: `receipt for ${hash.slice(0, 10)}… not seen yet (${firstLine((e as Error).message ?? String(e)).slice(0, 120)})` }
  }
}

/** A receipt if the chain has one right now; null if not (not mined, or the
 *  RPC didn't answer — the same thing to a caller that will look again). */
export async function receiptNow(hash: `0x${string}`): Promise<TransactionReceipt | null> {
  const client = publicClientFor(AUTOPILOT_CHAIN_ID)
  if (!client) return null
  try {
    return await client.getTransactionReceipt({ hash })
  } catch {
    return null
  }
}

/**
 * Send one spender transaction for a run: ledger intent, then CDP with the
 * run's derived key, then the hash, then the receipt. Returns what the
 * chain (or CDP) actually said, never a guess.
 */
export async function sendRunTx(ledger: RunLedger, attempt: number, tx: SaleStep): Promise<SendResult> {
  const key = spenderTxKey(ledger.table, ledger.runId, tx.step, attempt)
  const intent: LedgerEntry = { step: tx.step, attempt, key, to: tx.to, data: tx.data, value: tx.value, at: nowSec() }
  await ledger.intent(intent)

  let hash: `0x${string}` | undefined
  let words = ''
  for (let i = 0; i < SEND_TRIES && !hash; i++) {
    try {
      hash = await sendSpenderTx({ to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value) }, undefined, { idempotencyKey: key })
    } catch (err) {
      const f = classifySendError(err)
      words = f.words
      if (f.kind === 'refused') {
        await ledger.note({ ...intent, outcome: 'refused', words })
        return { outcome: 'refused', words }
      }
      // CDP may have broadcast it. The same key and request replay CDP's
      // first answer, so asking again can't send it twice.
      if (i < SEND_TRIES - 1) await sleep(1_500 * (i + 1))
    }
  }
  if (!hash) {
    await ledger.note({ ...intent, words })
    return { outcome: 'unresolved', words }
  }
  await ledger.note({ ...intent, hash })
  const r = await awaitReceipt(hash, RECEIPT_TIMEOUT_MS)
  if (!r.receipt) {
    await ledger.note({ ...intent, hash, words: r.words })
    return { outcome: 'unresolved', hash, words: r.words }
  }
  if (r.receipt.status !== 'success') {
    await ledger.note({ ...intent, hash, outcome: 'reverted', words: `the ${tx.step} reverted on-chain` })
    return { outcome: 'reverted', hash, words: `the ${tx.step} reverted on-chain` }
  }
  await ledger.note({ ...intent, hash, outcome: 'success' })
  return { outcome: 'success', hash, receipt: r.receipt }
}

// ── Reconcile: resolve what a dead or timed-out pass left open ──────────────

/**
 * Settle every unresolved ledger entry the chain or CDP can answer for now:
 *   - a hash: the receipt, if mined;
 *   - no hash (the pass died between the intent and CDP's answer, or CDP's
 *     answer never came back): re-issue the request under its ORIGINAL key.
 *     CDP replays its first answer if it processed it. If it never did, it
 *     answers now, which is only allowed where that's harmless:
 *       swap   → only after its deadline (a re-issue can then only revert);
 *       spend  → only when the permission's window shows a pull landed
 *                (else, after 5 minutes, it's recorded as never sent);
 *       others → deterministic requests the run still wants.
 *     Past CDP's 24h key memory nothing is re-issued: a person decides.
 */
export async function resolveLedger(
  ledger: RunLedger,
  opts: {
    spendLanded: () => Promise<boolean | null>
    /** Would the run send exactly this request? Every deterministic step is
     *  matched byte for byte against a fresh encoding (lib/autopilot-unwind
     *  reissueMatches); a swap only needs the pinned router, because it is
     *  only re-issued past its deadline, when it can only revert. */
    expected: (e: LedgerEntry) => boolean
  },
): Promise<void> {
  const now = nowSec()
  for (const e of ledger.entries.slice()) {
    if (e.outcome) continue
    if (e.hash) {
      const receipt = await receiptNow(e.hash as `0x${string}`)
      if (receipt) await ledger.note(resolvedEntry(e, receipt.status))
      continue
    }
    if (now - e.at > KEY_REPLAY_WINDOW_SEC) continue
    if (!opts.expected(e)) continue
    if (e.step === 'swap') {
      const deadline = swapDeadlineOf(e.data)
      if (deadline === null || now <= deadline + 60) continue
    }
    if (e.step === 'spend') {
      const landed = await opts.spendLanded()
      if (landed === false) {
        if (now - e.at > 300) await ledger.note({ ...e, outcome: 'refused', words: 'no pull landed in the permission window' })
        continue
      }
      if (landed !== true) continue
    }
    try {
      const hash = await sendSpenderTx({ to: e.to as `0x${string}`, data: e.data as `0x${string}`, value: BigInt(e.value) }, undefined, { idempotencyKey: e.key })
      await ledger.note({ ...e, hash })
      const r = await awaitReceipt(hash, RECEIPT_TIMEOUT_MS)
      if (r.receipt) await ledger.note(resolvedEntry({ ...e, hash }, r.receipt.status))
    } catch (err) {
      const f = classifySendError(err)
      if (f.kind === 'refused') await ledger.note({ ...e, outcome: 'refused', words: f.words })
    }
  }
}

/** An entry settled by its receipt: the receipt's words replace whatever an
 *  earlier wait said ("not seen yet" is not why a sale failed). */
function resolvedEntry(e: LedgerEntry, status: 'success' | 'reverted'): LedgerEntry {
  const { words: _stale, ...rest } = e
  return status === 'success' ? { ...rest, outcome: 'success' } : { ...rest, outcome: 'reverted', words: `the ${e.step} reverted on-chain` }
}

const permissionTuple = (p: DcaSpendPermission) => ({
  account: p.account,
  spender: p.spender,
  token: p.token,
  allowance: p.allowance,
  period: p.period,
  start: p.start,
  end: p.end,
  salt: p.salt,
  extraData: p.extraData,
})

/**
 * What the permission spent in the window containing `atSec`, from the
 * manager's own record (getLastUpdatedPeriod — it keeps only the latest
 * window a pull landed in). 'overwritten' = a later window has been pulled
 * since, so this window's record is gone. null = unreadable.
 */
export async function permissionWindowSpend(
  permission: DcaSpendPermission,
  atSec: number,
): Promise<{ spend: bigint; start: number; end: number } | 'overwritten' | null> {
  const client = publicClientFor(AUTOPILOT_CHAIN_ID)
  if (!client) return null
  try {
    const last = (await client.readContract({
      address: SPEND_PERMISSION_MANAGER as `0x${string}`,
      abi: spendPermissionManagerAbi,
      functionName: 'getLastUpdatedPeriod',
      args: [permissionTuple(permission)],
    })) as unknown as { start: number | bigint; end: number | bigint; spend: bigint }
    const start = Number(last.start)
    const end = Number(last.end)
    if (last.spend === BigInt(0) || end <= atSec) return { spend: BigInt(0), start, end }
    if (start <= atSec) return { spend: last.spend, start, end }
    return 'overwritten'
  } catch {
    return null
  }
}

/** The spend receipt proves this run's pull (lib/autopilot-unwind
 *  pullEvidence), read fresh from the chain. */
export async function verifyPull(input: {
  ledger: RunLedger
  permission: DcaSpendPermission
  permissionHash: string | null
  pulledAtomic: bigint
  nativeSentinel: string
  receipt?: TransactionReceipt
}): Promise<{ ok: boolean; note: string }> {
  const spend = input.ledger.entries.find((e) => e.step === 'spend' && e.outcome === 'success')
  if (!spend?.hash) return { ok: false, note: 'No confirmed pull in the ledger.' }
  if (!input.permissionHash) return { ok: false, note: 'The policy has no stored permission hash to match the pull against.' }
  const receipt = input.receipt ?? (await receiptNow(spend.hash as `0x${string}`))
  if (!receipt) return { ok: false, note: "The pull's receipt couldn't be read." }
  return pullEvidence({
    receipt: { status: receipt.status, logs: receipt.logs },
    manager: SPEND_PERMISSION_MANAGER,
    permissionHash: input.permissionHash,
    permission: input.permission,
    pulledAtomic: input.pulledAtomic,
    nativeSentinel: input.nativeSentinel,
  })
}

// ── Settling a pulled run ───────────────────────────────────────────────────

export interface SettleInput {
  ledger: RunLedger
  native: boolean
  pullVerified: boolean
  /** In-pass: true (one fresh retry). Reconcile: false (return, never sell late). */
  allowRetry: boolean
  /** Attempt 1's steps, built and guarded BEFORE the pull (in-pass only). */
  firstSteps?: SaleStep[]
  /** Build and guard a later attempt from where the pull now sits. A
   *  refusal (the floor, the kill switch, the venue) sends the money back. */
  rebuild: (attempt: number, held: HeldForm) => Promise<{ ok: true; steps: SaleStep[] } | { ok: false; words: string }>
  refund: {
    permission: { account: string; token: string; allowance: bigint }
    ownerWallet: string
    pulledAtomic: bigint
    nativeSentinel: string
    wethAddress: string
  }
}

export type SettleResult =
  | { kind: 'sold'; hash: string }
  | { kind: 'refunded'; hash: string; why: string }
  | { kind: 'nothing-pulled'; note: string }
  | { kind: 'unwinding'; note: string; operator: boolean; why: string }

/** Why the sale didn't go through, in the ledger's own words. */
export function saleFailureWords(entries: LedgerEntry[]): string {
  const failed = entries.filter((e) => (e.step === 'wrap' || e.step === 'approve' || e.step === 'swap') && e.outcome && e.outcome !== 'success')
  const last = failed[failed.length - 1]
  if (!last) return ''
  return last.words ?? `the ${last.step} ${last.outcome}`
}

export async function settleRun(input: SettleInput): Promise<SettleResult> {
  const { ledger } = input
  let allowRetry = input.allowRetry
  let why = saleFailureWords(ledger.entries)
  let refundPasses = 0
  for (let step = 0; step < 12; step++) {
    const action = decideUnwind({ ledger: ledger.entries, native: input.native, allowRetry, maxSaleAttempts: MAX_SALE_ATTEMPTS, pullVerified: input.pullVerified, nowSec: nowSec() })
    switch (action.kind) {
      case 'sold':
        return { kind: 'sold', hash: action.hash }
      case 'refunded':
        return { kind: 'refunded', hash: action.hash, why: why || saleFailureWords(ledger.entries) }
      case 'nothing-pulled':
        return { kind: 'nothing-pulled', note: action.note }
      case 'wait':
        return { kind: 'unwinding', note: action.note, operator: false, why }
      case 'operator':
        return { kind: 'unwinding', note: action.note, operator: true, why }
      case 'retry': {
        let steps: SaleStep[]
        if (action.attempt === 1 && input.firstSteps) {
          steps = input.firstSteps
        } else {
          const built = await input.rebuild(action.attempt, action.held)
          if (!built.ok) {
            why = why ? `${why}; the retry was refused: ${built.words}` : `the retry was refused: ${built.words}`
            allowRetry = false
            continue
          }
          steps = built.steps
        }
        for (const s of steps) {
          const r = await sendRunTx(ledger, action.attempt, s)
          if (r.outcome !== 'success') {
            why = r.words
            break
          }
        }
        continue
      }
      case 'refund': {
        if (action.attempt > MAX_REFUND_ATTEMPTS) {
          return { kind: 'unwinding', note: `The refund was refused ${MAX_REFUND_ATTEMPTS} times before broadcast.`, operator: true, why }
        }
        if (refundPasses >= 2) {
          return { kind: 'unwinding', note: 'The refund was refused before broadcast; the next pass tries again.', operator: false, why }
        }
        refundPasses += 1
        const { permission, ownerWallet, pulledAtomic, nativeSentinel, wethAddress } = input.refund
        const plan = planRefund({ form: action.held, ownerWallet, pulledAtomic, token: permission.token, wethAddress })
        const guard = guardRefund({ form: action.held, permission, ownerWallet, pulledAtomic, nativeSentinel, wethAddress, steps: plan })
        if (!guard.ok) {
          return { kind: 'unwinding', note: `The refund guard refused: ${guard.checks.filter((c) => !c.ok).map((c) => c.note).join(' ')}`, operator: true, why }
        }
        for (const s of plan) {
          const r = await sendRunTx(ledger, action.attempt, s)
          if (r.outcome !== 'success') break
        }
        continue
      }
    }
  }
  return { kind: 'unwinding', note: 'Settling took too many steps in one pass; the next pass continues.', operator: false, why }
}
