// ─────────────────────────────────────────────────────────────────────────
//  Transaction guardrails — the VENUE-NEUTRAL core (a Pantessa tool, per the
//  taxonomy: Uniswap tools are Uniswap-specific, CoW tools are CoW-specific,
//  Pantessa tools are the cross-app transaction layer). Every venue's build
//  runs the SAME checks before an artifact is offered for signature:
//    · recipient must be the requesting wallet
//    · validity window must be sane
//    · the account's kill switch gates at the point of signing (the spend
//      policy — allowlist, caps, master switch — was retired 2026-10-30)
//  A venue adapter (lib/cow-guardrails today, Uniswap's with A10) supplies
//  what's venue-specific: fee semantics, on-chain reads, USD valuation, and
//  the policy HOST its spend is attributed to.
// ─────────────────────────────────────────────────────────────────────────

import { grantViolation, type GrantPolicy, type GrantViolation } from '@/lib/spend-grant'

export interface GuardrailCheck {
  id: string
  level: 'block' | 'warn'
  ok: boolean
  note: string
}

/** Structured kill-switch refusal — enough for a UI to name the cause and
 *  point at the dashboard instead of a dead-end message. */
export interface PolicyBlock {
  violation: GrantViolation
  valueUsd: number | null
  /** The venue's policy host the spend was attributed to. */
  host: string
}

export interface GuardrailReport {
  /** True when no block-level check failed — the artifact may be offered. */
  ok: boolean
  /** USD value of the action (venue-supplied heuristic); null = unpriceable. */
  valueUsd: number | null
  checks: GuardrailCheck[]
  /** Present when the failed check is the kill switch — drives the refusal card. */
  policyBlock?: PolicyBlock
}

/** Longest validity we'll offer for signature — an unbounded signed order or
 *  transaction is a standing liability, whatever the venue. */
export const MAX_VALID_SEC = 31 * 24 * 3600

/** The proceeds/recipient of a built action must be the requesting wallet. */
export function recipientCheck(receiver: string, from: string): GuardrailCheck {
  const ok = receiver.toLowerCase() === from.toLowerCase()
  return {
    id: 'recipient',
    level: 'block',
    ok,
    note: ok
      ? 'Proceeds return to your wallet.'
      : `Pays ${receiver} — NOT the requesting wallet ${from}.`,
  }
}

/** Not expired, not signable-forever. */
export function validityCheck(validToSec: number, nowSec = Math.floor(Date.now() / 1000)): GuardrailCheck {
  const notExpired = validToSec > nowSec
  const notForever = validToSec <= nowSec + MAX_VALID_SEC
  return {
    id: 'validity',
    level: 'block',
    ok: notExpired && notForever,
    note: !notExpired
      ? 'Already expired.'
      : !notForever
        ? `Stays signable for more than ${MAX_VALID_SEC / 86400} days — refuse a standing liability.`
        : `Valid for ${Math.round((validToSec - nowSec) / 60)} min.`,
  }
}

/**
 * The account gate at the point of signing — the SAME gate chat payments go
 * through (lib/spend-grant), pointed at the venue's policy host for the
 * ledger. Since the spend policy was retired (2026-10-30) the only refusal
 * it can return is the kill switch: a frozen or revoked account, or a gate
 * that could not run. Caps, allowlist and priceability never refuse —
 * `valueUsd` rides along for the money-moved metric and the card's note.
 *
 * `opts.selfSigned` is accepted for call-site compatibility: the cap
 * exemption it used to grant has nothing left to exempt.
 */
export function policyCheck(
  valueUsd: number | null,
  policy: GrantPolicy | null,
  spentTodayUsd: number,
  host: string,
  spentTotalUsd = 0,
  opts?: { selfSigned?: boolean },
): { check: GuardrailCheck; violation: GrantViolation | null } {
  void opts
  if (!policy) {
    return { check: { id: 'policy', level: 'warn', ok: true, note: 'No spend policy on this wallet — not gated.' }, violation: null }
  }
  const violation = grantViolation(policy, host, valueUsd ?? 0, spentTodayUsd, spentTotalUsd)
  const usd = valueUsd != null ? ` ($${valueUsd.toFixed(2)})` : ''
  return {
    check: {
      id: 'policy',
      level: 'block',
      ok: !violation,
      note: violation
        ? `Refused by your account's kill switch: ${policyBlockNote(violation, host)}${usd}.`
        : `No spend policy gates this — your signature is the consent${usd}.`,
    },
    violation,
  }
}

/**
 * The INFLOW gate — for actions where the wallet RECEIVES value (an NFT
 * sale's proceeds, a filled listing): the account pays NOTHING, so the caps
 * and the allowlist don't apply — those govern what agents may PAY, and
 * gating a $1,800 sale behind a $200 spend cap read as nonsense. Only the
 * kill switches survive direction: a frozen or revoked account refuses
 * everything. valueUsd still rides the report for the money-moved metric.
 */
export function policyCheckInflow(
  valueUsd: number | null,
  policy: GrantPolicy | null,
): { check: GuardrailCheck; violation: GrantViolation | null } {
  if (!policy) {
    return { check: { id: 'policy', level: 'warn', ok: true, note: 'No spend policy on this wallet — not gated.' }, violation: null }
  }
  if (policy.status === 'revoked') {
    return { check: { id: 'policy', level: 'block', ok: false, note: 'Your expense account is revoked — everything is refused.' }, violation: 'REVOKED' }
  }
  if (policy.paused) {
    return { check: { id: 'policy', level: 'block', ok: false, note: 'Your account is frozen (kill switch) — everything is refused, whatever the direction.' }, violation: 'ACCOUNT_FROZEN' }
  }
  const usd = valueUsd != null ? ` (~$${valueUsd.toFixed(2)} to you)` : ''
  return {
    check: { id: 'policy', level: 'block', ok: true, note: `You RECEIVE on this one${usd} — spend caps don't apply to sale proceeds.` },
    violation: null,
  }
}

/** The violation code in words a user can act on (the code alone read as a
 *  dead end — "ACCOUNT_FROZEN ($5.00)" tells nobody what to do next). */
export function policyBlockNote(violation: GrantViolation, host: string): string {
  switch (violation) {
    case 'ACCOUNT_FROZEN':
      return 'your account is frozen — resume it on the dashboard'
    case 'REVOKED':
      return 'your account was revoked'
    case 'POLICY_ERROR':
      return 'your account could not be checked — refusing rather than guessing'
    default:
      return `${violation} (${host})`
  }
}

/** Assemble the report. `ok` = no failed block-level check. */
export function buildReport(valueUsd: number | null, checks: GuardrailCheck[], policyBlock?: PolicyBlock | null): GuardrailReport {
  return { ok: checks.every((c) => c.ok || c.level !== 'block'), valueUsd, checks, ...(policyBlock ? { policyBlock } : {}) }
}
