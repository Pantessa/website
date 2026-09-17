// ─────────────────────────────────────────────────────────────────────────
//  AUTOPILOT UNWIND — the pure half of "a pull never strands".
//
//  Both Spend-Permission autopilots (Spot Guardian, DCA autopilot) pull the
//  owner's money onto Pantessa's CDP spender, then trade it. The pull is
//  final; the trade can still fail: a price that moved past the bound
//  between the quote and the swap, a deadline, an RPC. Until 2026-09-17 a
//  failure after the pull parked the run in 'failed' with the asset on the
//  spender for good. The spot permission is one-shot, so nothing could pull
//  again, and nothing sent it back (proven on a Base fork: owner −0.01 ETH,
//  spender +0.01 WETH, run "tx … reverted").
//
//  The rule now: once the pull lands, a run ends only when the chain proves
//  where the money went: SOLD/BOUGHT (the swap's receipt succeeded, the
//  output went to the owner) or REFUNDED (the pull went back to the owner).
//  Until then the run is UNWINDING, and says so.
//
//  This module is PURE (no prisma, no CDP, no RPC):
//    - the per-run ledger of every spender send, written BEFORE each send;
//    - deterministic CDP idempotency keys, so a re-sent request (an HTTP
//      retry, a later pass) replays CDP's first answer instead of sending
//      the transaction twice;
//    - the send-error classifier (refused before broadcast vs. unknown);
//    - the refund plan and its independent guard (a refund can only return
//      exactly the pull to the wallet it came from);
//    - the pull-evidence check over the spend receipt's logs;
//    - decideUnwind, the one decision table both executors follow.
// ─────────────────────────────────────────────────────────────────────────

import { BaseError, decodeEventLog, decodeFunctionData, encodeFunctionData, erc20Abi, sha256, stringToHex } from 'viem'
import { classifyDryRunError } from './dry-run'
import type { GuardrailCheck } from './tx-guardrails'

export type RunTable = 'spot' | 'dca'

/** Every transaction the spender sends for a run, in order. `permit` is the
 *  one-time approveWithSignature; `approve` is the exact router approval.
 *  Neither moves the owner's money, so the decision ignores them. */
export type LedgerStep = 'permit' | 'spend' | 'wrap' | 'approve' | 'swap' | 'unwrap' | 'return'

export type LedgerOutcome = 'success' | 'reverted' | 'refused'

export interface LedgerEntry {
  step: LedgerStep
  /** Sale attempt (1, 2) for wrap/approve/swap. Refund steps count their own
   *  sends: a new number only after a send CDP refused outright. */
  attempt: number
  /** The CDP idempotency key the send carried (spenderTxKey). */
  key: string
  /** The exact request, kept so a later pass can re-issue it with the same
   *  key and learn what CDP did with the first one. */
  to: string
  data: string
  /** Decimal wei. */
  value: string
  /** Set the moment CDP returns it, before the receipt wait. */
  hash?: string
  /** success | reverted: the receipt said so. refused: turned down before
   *  broadcast (CDP 4xx, or the gas estimate reverted). Absent: unresolved,
   *  the transaction may still be out there. */
  outcome?: LedgerOutcome
  /** Unix seconds the intent was written. */
  at: number
  /** The failure's own words, trimmed. */
  words?: string
}

const STEPS: readonly LedgerStep[] = ['permit', 'spend', 'wrap', 'approve', 'swap', 'unwrap', 'return']
const OUTCOMES: readonly LedgerOutcome[] = ['success', 'reverted', 'refused']
const HEX = /^0x[0-9a-fA-F]*$/
const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/

/** Strict parse: an entry that doesn't read cleanly makes the whole ledger
 *  unreadable (null), and an unreadable ledger is an operator case, never a
 *  guess about where the money is. */
export function parseLedger(raw: string | null | undefined): LedgerEntry[] | null {
  if (raw === null || raw === undefined || raw === '') return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return null
    const out: LedgerEntry[] = []
    for (const o of arr) {
      if (!o || typeof o !== 'object') return null
      const r = o as Record<string, unknown>
      if (!STEPS.includes(r.step as LedgerStep)) return null
      if (typeof r.attempt !== 'number' || !Number.isInteger(r.attempt) || r.attempt < 1) return null
      if (typeof r.key !== 'string' || !UUID_V4.test(r.key)) return null
      if (typeof r.to !== 'string' || !HEX_ADDR.test(r.to)) return null
      if (typeof r.data !== 'string' || !HEX.test(r.data)) return null
      if (typeof r.value !== 'string' || !/^\d+$/.test(r.value)) return null
      if (r.hash !== undefined && (typeof r.hash !== 'string' || !HASH.test(r.hash))) return null
      if (r.outcome !== undefined && !OUTCOMES.includes(r.outcome as LedgerOutcome)) return null
      if (typeof r.at !== 'number') return null
      out.push({
        step: r.step as LedgerStep,
        attempt: r.attempt,
        key: r.key,
        to: r.to,
        data: r.data,
        value: r.value,
        ...(r.hash ? { hash: r.hash as string } : {}),
        ...(r.outcome ? { outcome: r.outcome as LedgerOutcome } : {}),
        at: r.at,
        ...(typeof r.words === 'string' ? { words: r.words } : {}),
      })
    }
    return out
  } catch {
    return null
  }
}

export function serializeLedger(entries: LedgerEntry[]): string {
  return JSON.stringify(entries)
}

/** Replace the entry for (step, attempt), or append it. */
export function upsertLedger(entries: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  const i = entries.findIndex((e) => e.step === entry.step && e.attempt === entry.attempt)
  if (i === -1) return [...entries, entry]
  const next = entries.slice()
  next[i] = entry
  return next
}

// ── Idempotency keys ─────────────────────────────────────────────────────────
// CDP's send endpoint takes an X-Idempotency-Key (a UUID v4, remembered for a
// rolling 24 hours): the same key with the same request returns the first
// answer, the same key with a different request is an error. The SDK's HTTP
// client retries network errors on POST, so without a key a dropped response
// can broadcast a transfer twice, paid out of other users' money on the one
// shared spender. One key per (run, step, attempt), derived, never random:
// a crashed pass's successor re-derives it.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function spenderTxKey(table: RunTable, runId: string, step: LedgerStep, attempt: number): string {
  const h = sha256(stringToHex(`pantessa-autopilot:${table}:${runId}:${step}:${attempt}`)).slice(2)
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-')
}

/** CDP remembers a key for 24 hours. A later pass re-issues a request under
 *  its original key only well inside that window; past it, a re-issue could
 *  send the transaction again, so the run goes to an operator instead. */
export const KEY_REPLAY_WINDOW_SEC = 20 * 3600

// ── Send errors ──────────────────────────────────────────────────────────────

export type SendFailureKind = 'refused' | 'unknown'

const firstLine = (s: string) => s.split('\n')[0].trim()

/**
 * Did the send die BEFORE broadcast (refused), or can't we tell (unknown)?
 * Refused: CDP answered 4xx (validation, a gas estimate that reverted, a
 * rate limit, an idempotency conflict: nothing was processed), or the
 * failure's own words are a revert (CDP puts the estimate's revert reason in
 * the message whatever the status). Unknown: a 5xx, a dropped connection, a
 * timeout. CDP may have broadcast, so the caller must find out before it
 * moves the same money another way.
 */
export function classifySendError(err: unknown): { kind: SendFailureKind; words: string } {
  const e = err as { statusCode?: unknown; errorMessage?: unknown; name?: unknown; message?: unknown } | null
  if (err instanceof BaseError) {
    const v = classifyDryRunError(err)
    if (v.kind === 'revert' || v.kind === 'no-gas') return { kind: 'refused', words: v.reason }
    return { kind: 'unknown', words: v.detail }
  }
  const words = firstLine(
    typeof e?.errorMessage === 'string' ? e.errorMessage : typeof e?.message === 'string' ? e.message : String(err),
  ).slice(0, 200)
  if (/execution reverted|\breverted?\b|insufficient funds/i.test(words)) return { kind: 'refused', words }
  if (e?.name === 'UserInputValidationError') return { kind: 'refused', words }
  if (typeof e?.statusCode === 'number') {
    return e.statusCode >= 400 && e.statusCode < 500 ? { kind: 'refused', words } : { kind: 'unknown', words }
  }
  return { kind: 'unknown', words }
}

// ── The refund ───────────────────────────────────────────────────────────────

/** Where the run's pull sits on the spender right now. native: ETH as
 *  pulled. wrapped: ETH the sell wrapped into WETH. erc20: the pulled token
 *  itself (a spot ERC-20, or the DCA's USDC). */
export type HeldForm = 'native' | 'wrapped' | 'erc20'

export interface SpenderTx {
  step: LedgerStep
  to: `0x${string}`
  data: `0x${string}`
  /** Decimal wei. */
  value: string
}

const WETH_WITHDRAW_ABI = [
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
] as const

/** The refund, in the form the asset was pulled: ETH comes back as ETH
 *  (unwrapped first if the sell had wrapped it), an ERC-20 as itself. */
export function planRefund(input: { form: HeldForm; ownerWallet: string; pulledAtomic: bigint; token: string; wethAddress: string }): SpenderTx[] {
  const owner = input.ownerWallet as `0x${string}`
  if (input.form === 'erc20') {
    return [
      {
        step: 'return',
        to: input.token as `0x${string}`,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner, input.pulledAtomic] }),
        value: '0',
      },
    ]
  }
  const send: SpenderTx = { step: 'return', to: owner, data: '0x', value: input.pulledAtomic.toString() }
  if (input.form === 'native') return [send]
  return [
    {
      step: 'unwrap',
      to: input.wethAddress as `0x${string}`,
      data: encodeFunctionData({ abi: WETH_WITHDRAW_ABI, functionName: 'withdraw', args: [input.pulledAtomic] }),
      value: '0',
    },
    send,
  ]
}

export interface RefundGuardInput {
  form: HeldForm
  /** The signed permission: the pull came from `account`, in `token`. */
  permission: { account: string; token: string; allowance: bigint }
  ownerWallet: string
  pulledAtomic: bigint
  /** ERC-7528 native sentinel (the spot guard's). */
  nativeSentinel: string
  wethAddress: string
  steps: Array<{ step: LedgerStep; to: string; data: string; value: string }>
}

const check = (id: string, ok: boolean, note: string): GuardrailCheck => ({ id, level: 'block', ok, note })

/**
 * The refund's independent re-decode. A refund may only give back exactly
 * the pull, in the pulled asset, to the wallet the permission pulled from.
 * Every step decodes to one of three shapes, nothing else:
 *   native:  [send pull as ETH to the owner, empty calldata]
 *   wrapped: [WETH.withdraw(pull) on the pinned WETH] + the native send
 *   erc20:   [token.transfer(owner, pull) on the permission's own token]
 * The recovery path is a new way to move money; this keeps it from being a
 * way to move money anywhere else.
 */
export function guardRefund(input: RefundGuardInput): { ok: boolean; checks: GuardrailCheck[] } {
  const { form, permission, ownerWallet, pulledAtomic, nativeSentinel, wethAddress, steps } = input
  const checks: GuardrailCheck[] = []
  const owner = ownerWallet.toLowerCase()

  const ownerOk = HEX_ADDR.test(ownerWallet) && owner === permission.account.toLowerCase()
  checks.push(check('owner', ownerOk, ownerOk ? 'Refund goes to the wallet the permission pulled from.' : `Refund recipient ${ownerWallet} is not the permission's account ${permission.account}.`))

  const amountOk = pulledAtomic > BigInt(0) && pulledAtomic === permission.allowance
  checks.push(check('amount', amountOk, amountOk ? 'Refund is exactly the pull (the signed allowance).' : `Refund ${pulledAtomic} is not the signed allowance ${permission.allowance}.`))

  const nativePermission = permission.token.toLowerCase() === nativeSentinel.toLowerCase()
  const formOk = form === 'erc20' ? !nativePermission : nativePermission
  checks.push(check('form', formOk, formOk ? `The pulled asset comes back as it was pulled (${form}).` : `A ${form} refund doesn't match a permission over ${permission.token}.`))

  const expected: LedgerStep[] = form === 'wrapped' ? ['unwrap', 'return'] : ['return']
  const shapeOk = steps.length === expected.length && steps.every((s, i) => s.step === expected[i])
  checks.push(check('steps', shapeOk, shapeOk ? `Steps: ${expected.join(' → ')}.` : `Expected ${expected.join(' → ')}, got ${steps.map((s) => s.step).join(' → ') || 'nothing'}.`))
  if (!shapeOk) return { ok: false, checks }

  for (const s of steps) {
    if (s.step === 'unwrap') {
      let ok = false
      let note = 'Unwrap does not decode as WETH.withdraw(pull) on the pinned WETH.'
      if (s.to.toLowerCase() === wethAddress.toLowerCase() && s.value === '0') {
        try {
          const dec = decodeFunctionData({ abi: WETH_WITHDRAW_ABI, data: s.data as `0x${string}` })
          ok = dec.functionName === 'withdraw' && (dec.args as readonly [bigint])[0] === pulledAtomic
          if (ok) note = 'Unwraps exactly the pull on the pinned WETH.'
        } catch {
          /* refusal stands */
        }
      }
      checks.push(check('unwrap', ok, note))
      continue
    }
    if (form === 'erc20') {
      let ok = false
      let note = "Return does not decode as transfer(owner, pull) on the permission's token."
      if (s.to.toLowerCase() === permission.token.toLowerCase() && s.value === '0') {
        try {
          const dec = decodeFunctionData({ abi: erc20Abi, data: s.data as `0x${string}` })
          if (dec.functionName === 'transfer') {
            const [to, amount] = dec.args as readonly [string, bigint]
            ok = to.toLowerCase() === owner && amount === pulledAtomic
            note = ok ? "Transfers exactly the pull back to the owner, in the permission's own token." : `Transfer pays ${to} ${amount}, not the owner the pull.`
          }
        } catch {
          /* refusal stands */
        }
      }
      checks.push(check('return', ok, note))
    } else {
      const ok = s.to.toLowerCase() === owner && s.data === '0x' && s.value === pulledAtomic.toString()
      checks.push(check('return', ok, ok ? 'Sends exactly the pull back to the owner as ETH, no calldata.' : `Native return pays ${s.to} ${s.value} wei with ${s.data === '0x' ? 'no' : 'extra'} calldata, not the owner the pull.`))
    }
  }
  return { ok: checks.every((c) => c.ok), checks }
}

// ── Pull evidence ────────────────────────────────────────────────────────────

const SPEND_PERMISSION_USED_ABI = [
  {
    type: 'event',
    name: 'SpendPermissionUsed',
    inputs: [
      { name: 'hash', type: 'bytes32', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      {
        name: 'periodSpend',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'start', type: 'uint48' },
          { name: 'end', type: 'uint48' },
          { name: 'spend', type: 'uint160' },
        ],
      },
    ],
  },
] as const

export interface ReceiptLike {
  status: 'success' | 'reverted'
  logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }>
}

/**
 * Did THIS receipt pull exactly the run's amount, for this permission, from
 * the owner to the spender? The refund amount rests on it: a refund is sized
 * by the pull, never by the spender's balance, which every permission on the
 * platform shares. Two proofs:
 *   - SpendPermissionManager's own SpendPermissionUsed event for the stored
 *     permission hash, the owner, the spender and the token, with the
 *     window's spend at the pull (one pull per window, so spend == pull);
 *   - for an ERC-20, the token's Transfer(owner → spender, pull), so a token
 *     that delivers less than it moves can't size a refund the spender
 *     doesn't hold.
 */
export function pullEvidence(input: {
  receipt: ReceiptLike
  manager: string
  permissionHash: string
  permission: { account: string; spender: string; token: string; allowance: bigint }
  pulledAtomic: bigint
  nativeSentinel: string
}): { ok: boolean; note: string } {
  const { receipt, manager, permissionHash, permission, pulledAtomic, nativeSentinel } = input
  if (receipt.status !== 'success') return { ok: false, note: 'The pull reverted.' }
  const account = permission.account.toLowerCase()
  const spender = permission.spender.toLowerCase()
  const token = permission.token.toLowerCase()
  let used = false
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== manager.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: SPEND_PERMISSION_USED_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] })
      const a = ev.args as { hash: string; account: string; spender: string; token: string; periodSpend: { spend: bigint } }
      if (
        a.hash.toLowerCase() === permissionHash.toLowerCase() &&
        a.account.toLowerCase() === account &&
        a.spender.toLowerCase() === spender &&
        a.token.toLowerCase() === token &&
        a.periodSpend.spend === pulledAtomic
      ) {
        used = true
      }
    } catch {
      /* another event */
    }
  }
  if (!used) return { ok: false, note: `No SpendPermissionUsed for permission ${permissionHash.slice(0, 10)}… pulling ${pulledAtomic} from the owner to the spender in this receipt.` }
  if (token === nativeSentinel.toLowerCase()) return { ok: true, note: `The manager pulled exactly ${pulledAtomic} wei of ETH from the owner to the spender.` }
  const moved = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== token) return false
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] })
      if (ev.eventName !== 'Transfer') return false
      const { from, to, value } = ev.args as { from: string; to: string; value: bigint }
      return from.toLowerCase() === account && to.toLowerCase() === spender && value === pulledAtomic
    } catch {
      return false
    }
  })
  return moved
    ? { ok: true, note: `The manager pulled exactly ${pulledAtomic} of ${permission.token} from the owner to the spender.` }
    : { ok: false, note: `The pull's receipt has no Transfer of exactly ${pulledAtomic} from the owner to the spender (a token that delivers less than it moves can't size a refund).` }
}

// ── The decision ─────────────────────────────────────────────────────────────

const MULTICALL_ABI = [
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const

/** The multicall deadline a swap request carries (unix seconds), or null.
 *  After it, a swap that was never broadcast can only revert: re-issuing it
 *  under its key either replays what CDP did or is refused. */
export function swapDeadlineOf(data: string): number | null {
  try {
    const dec = decodeFunctionData({ abi: MULTICALL_ABI, data: data as `0x${string}` })
    return dec.functionName === 'multicall' ? Number((dec.args as readonly [bigint, unknown])[0]) : null
  } catch {
    return null
  }
}

/**
 * May a later pass re-issue this ledger entry under its key? Only if it is
 * exactly a request the run would send: the caller encodes every
 * deterministic step afresh from the permission (the pull, the wrap, the
 * approval, both refund shapes) and this compares byte for byte. A swap
 * can't be re-encoded (its quote is gone), so it only has to target the
 * pinned router with no value, and resolveLedger re-issues it only past its
 * deadline.
 */
export function reissueMatches(
  e: Pick<LedgerEntry, 'step' | 'to' | 'data' | 'value'>,
  expected: Partial<Record<LedgerStep, Array<{ to: string; data: string; value: string }>>>,
  router: string,
): boolean {
  if (e.step === 'swap') return e.to.toLowerCase() === router.toLowerCase() && e.value === '0' && swapDeadlineOf(e.data) !== null
  return (expected[e.step] ?? []).some((x) => x.to.toLowerCase() === e.to.toLowerCase() && x.data.toLowerCase() === e.data.toLowerCase() && x.value === e.value)
}

export type UnwindAction =
  /** The pull never landed (refused, reverted): nothing to return. */
  | { kind: 'nothing-pulled'; note: string }
  /** A swap receipt succeeded: the owner has the output. */
  | { kind: 'sold'; hash: string; note: string }
  /** The return step's receipt succeeded: the owner has the pull back. */
  | { kind: 'refunded'; hash: string; note: string }
  /** A send may still land: decide nothing until it resolves. */
  | { kind: 'wait'; note: string }
  /** The funds are provably intact on the spender: sell/buy again. */
  | { kind: 'retry'; attempt: number; held: HeldForm; note: string }
  /** The funds are provably intact on the spender: send them back. */
  | { kind: 'refund'; held: HeldForm; attempt: number; note: string }
  /** The ledger can't prove where the money is: a person has to look. */
  | { kind: 'operator'; note: string }

/** An unresolved send older than this is an operator case (decideUnwind). */
export const UNRESOLVED_OPERATOR_SEC = 3600

const SALE_STEPS: readonly LedgerStep[] = ['wrap', 'approve', 'swap']
const FUND_STEPS: readonly LedgerStep[] = ['spend', 'wrap', 'swap', 'unwrap', 'return']

/**
 * One decision table for both autopilots, in-pass and on reconcile. Reads
 * only the ledger (outcomes the caller resolved from receipts, or from
 * CDP's answer to a re-issued key):
 *   1. no successful pull → nothing-pulled (or wait, if it's unresolved);
 *      a successful pull the receipt doesn't prove (pullEvidence) → operator;
 *   2. a successful swap → sold (and a refund beside it → operator);
 *   3. any fund-moving send unresolved → wait;
 *   4. a successful return → refunded;
 *   5. a refund step that REVERTED → operator (the spender didn't hold what
 *      the ledger says it held);
 *   6. the held form must be provable (at most one successful wrap);
 *   7. retries left and allowed → retry; otherwise → refund.
 * `allowRetry` is false on reconcile: a pass minutes later returns the
 * money, it never sells late.
 */
export function decideUnwind(input: { ledger: LedgerEntry[]; native: boolean; allowRetry: boolean; maxSaleAttempts: number; pullVerified: boolean; nowSec: number }): UnwindAction {
  const { ledger, native, allowRetry, maxSaleAttempts, pullVerified, nowSec } = input
  // Waiting is for sends that can still land. One unresolved this long won't
  // settle by itself: a person looks (reconcile keeps trying meanwhile).
  const waitOr = (e: LedgerEntry, note: string): UnwindAction =>
    nowSec - e.at > UNRESOLVED_OPERATOR_SEC ? { kind: 'operator', note: `${note} It has been unresolved for over an hour.` } : { kind: 'wait', note }
  const spend = ledger.filter((e) => e.step === 'spend')
  if (spend.length === 0) return { kind: 'nothing-pulled', note: 'No pull was sent.' }
  if (spend.length > 1) return { kind: 'operator', note: 'The ledger shows more than one pull for one run.' }
  if (!spend[0].outcome) return waitOr(spend[0], 'The pull was sent and has not resolved yet.')
  if (spend[0].outcome !== 'success') return { kind: 'nothing-pulled', note: `The pull was ${spend[0].outcome}${spend[0].words ? `: ${spend[0].words}` : ''}.` }
  if (!pullVerified) return { kind: 'operator', note: "The pull's receipt doesn't prove exactly this run's amount moved from the owner to the spender, so nothing is sized from it." }

  const sold = ledger.find((e) => e.step === 'swap' && e.outcome === 'success')
  const returned = ledger.find((e) => e.step === 'return' && e.outcome === 'success')
  if (sold && returned) return { kind: 'operator', note: `The ledger shows both a sale (${sold.hash?.slice(0, 10)}…) and a refund (${returned.hash?.slice(0, 10)}…) for one pull.` }
  if (sold) return { kind: 'sold', hash: sold.hash ?? '', note: `Swap ${sold.hash?.slice(0, 10) ?? ''}… succeeded on attempt ${sold.attempt}.` }

  const pending = ledger.find((e) => FUND_STEPS.includes(e.step) && !e.outcome)
  if (pending) return waitOr(pending, `The ${pending.step} (attempt ${pending.attempt}) was sent and has not resolved yet.`)

  if (returned) return { kind: 'refunded', hash: returned.hash ?? '', note: `Returned in ${returned.hash?.slice(0, 10) ?? ''}….` }

  const refundReverted = ledger.find((e) => (e.step === 'unwrap' || e.step === 'return') && e.outcome === 'reverted')
  if (refundReverted) return { kind: 'operator', note: `The refund's ${refundReverted.step} reverted on-chain — the spender did not hold what the ledger says.` }

  let held: HeldForm = 'erc20'
  if (native) {
    const wraps = ledger.filter((e) => e.step === 'wrap' && e.outcome === 'success').length
    const unwraps = ledger.filter((e) => e.step === 'unwrap' && e.outcome === 'success').length
    if (wraps > 1 || unwraps > wraps) return { kind: 'operator', note: `The ledger shows ${wraps} wraps and ${unwraps} unwraps for one pull.` }
    held = wraps === unwraps ? 'native' : 'wrapped'
  }

  const saleAttempts = ledger.filter((e) => SALE_STEPS.includes(e.step)).reduce((m, e) => Math.max(m, e.attempt), 0)
  const refundSends = ledger.filter((e) => e.step === 'unwrap' || e.step === 'return')
  if (allowRetry && refundSends.length === 0 && saleAttempts < maxSaleAttempts) {
    return { kind: 'retry', attempt: saleAttempts + 1, held, note: `Attempt ${saleAttempts} didn't fill; the pull is still on the spender as ${held}.` }
  }
  // A refused refund send was never broadcast: the next one takes a new key.
  const attempt = refundSends.reduce((m, e) => Math.max(m, e.attempt), 0) + (refundSends.some((e) => e.outcome === 'refused') ? 1 : 0)
  return { kind: 'refund', held, attempt: Math.max(1, attempt), note: `Returning the pull (held as ${held}).` }
}
