// @canonical lib/tx-guardrails.ts — full copy; scripts/guard-sync-check.ts enforces byte-parity (modulo import lines + this header).
// ─────────────────────────────────────────────────────────────────────────
//  Transaction guardrails — the VENUE-NEUTRAL core (a Pantessa tool, per the
//  taxonomy: Uniswap tools are Uniswap-specific, CoW tools are CoW-specific,
//  Pantessa tools are the cross-app transaction layer). Every venue's build
//  runs the SAME checks before an artifact is offered for signature:
//    · recipient must be the requesting wallet
//    · validity window must be sane
//    · the wallet's spend policy gates at the point of signing
//  A venue adapter (lib/cow-guardrails today, Uniswap's with A10) supplies
//  what's venue-specific: fee semantics, on-chain reads, USD valuation, and
//  the policy HOST its spend is attributed to.
// ─────────────────────────────────────────────────────────────────────────

import { grantViolation, type GrantPolicy, type GrantViolation } from './spend-grant'

export interface GuardrailCheck {
  id: string
  level: 'block' | 'warn'
  ok: boolean
  note: string
}

/** Structured spend-policy refusal — enough for a UI to offer the exact fix
 *  (allow the host / raise the right cap) instead of a dead-end message. */
export interface PolicyBlock {
  violation: GrantViolation | 'VALUE_UNKNOWN'
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
  /** Present when the failed check is the spend policy — drives fix-it UI. */
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
 * The spend-policy gate at the point of signing — the SAME gate chat payments
 * go through (lib/spend-grant), pointed at the action's USD value and the
 * venue's policy host. Block-level: an unpriceable action under an enabled
 * policy is refused (caps are never bypassed because we couldn't price it).
 *
 * `selfSigned`: the artifact is signed by the OWNER's wallet, per action —
 * that signature is the consent, so the caps (which govern what agents may
 * spend without the owner in the loop) don't refuse it, and neither does an
 * unpriceable leg. Kill switches, expiry, and the allowlist still apply.
 * Autonomous paths (house-paid x402, the delegated HL key) never set this.
 */
export function policyCheck(
  valueUsd: number | null,
  policy: GrantPolicy | null,
  spentTodayUsd: number,
  host: string,
  spentTotalUsd = 0,
  opts?: { selfSigned?: boolean },
): { check: GuardrailCheck; violation: GrantViolation | 'VALUE_UNKNOWN' | null } {
  const selfSigned = opts?.selfSigned === true
  if (!policy) {
    return { check: { id: 'policy', level: 'warn', ok: true, note: 'No spend policy on this wallet — not gated.' }, violation: null }
  }
  if (valueUsd === null) {
    if (!policy.spendPolicyEnabled) {
      return { check: { id: 'policy', level: 'warn', ok: true, note: 'Spend policy is off; value unpriced.' }, violation: null }
    }
    if (selfSigned) {
      return {
        check: { id: 'policy', level: 'warn', ok: true, note: 'No priceable leg — you sign this yourself, so no cap is being bypassed.' },
        violation: null,
      }
    }
    return {
      check: {
        id: 'policy',
        level: 'block',
        ok: false,
        note: 'Spend policy is ON but this action has no priceable leg — refusing rather than bypassing your caps.',
      },
      violation: 'VALUE_UNKNOWN',
    }
  }
  const violation = grantViolation(policy, host, valueUsd, spentTodayUsd, spentTotalUsd)
  if (selfSigned && (violation === 'OVER_PER_CALL' || violation === 'BUDGET_EXCEEDED')) {
    return {
      check: {
        id: 'policy',
        level: 'block',
        ok: true,
        note: `Over your agent spend cap, but you sign this yourself ($${valueUsd.toFixed(2)}) — your signature is the consent.`,
      },
      violation: null,
    }
  }
  return {
    check: {
      id: 'policy',
      level: 'block',
      ok: !violation,
      note: violation
        ? `Blocked by your spend policy: ${policyBlockNote(violation, host)} ($${valueUsd.toFixed(2)}).`
        : `Within your spend policy ($${valueUsd.toFixed(2)}).`,
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
 *  dead end — "NOT_ALLOWED ($5.00)" told Nate nothing about WHAT to change). */
export function policyBlockNote(violation: GrantViolation | 'VALUE_UNKNOWN', host: string): string {
  switch (violation) {
    case 'NOT_ALLOWED':
      return `${host} isn't on your allowlist`
    case 'OVER_PER_CALL':
      return 'over your per-action cap'
    case 'BUDGET_EXCEEDED':
      return 'over your budget cap'
    case 'ACCOUNT_FROZEN':
      return 'your account is frozen'
    case 'EXPIRED':
      return 'your expense account expired'
    case 'REVOKED':
      return 'your expense account was revoked'
    case 'POLICY_ERROR':
      return 'your spend policy could not be evaluated — refusing rather than guessing'
    default:
      return violation
  }
}

/** Assemble the report. `ok` = no failed block-level check. */
export function buildReport(valueUsd: number | null, checks: GuardrailCheck[], policyBlock?: PolicyBlock | null): GuardrailReport {
  return { ok: checks.every((c) => c.ok || c.level !== 'block'), valueUsd, checks, ...(policyBlock ? { policyBlock } : {}) }
}
