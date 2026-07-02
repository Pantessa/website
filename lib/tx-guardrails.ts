// ─────────────────────────────────────────────────────────────────────────
//  Transaction guardrails — the VENUE-NEUTRAL core (a Yeetful tool, per the
//  taxonomy: Uniswap tools are Uniswap-specific, CoW tools are CoW-specific,
//  Yeetful tools are the cross-app transaction layer). Every venue's build
//  runs the SAME checks before an artifact is offered for signature:
//    · recipient must be the requesting wallet
//    · validity window must be sane
//    · the wallet's spend policy gates at the point of signing
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

export interface GuardrailReport {
  /** True when no block-level check failed — the artifact may be offered. */
  ok: boolean
  /** USD value of the action (venue-supplied heuristic); null = unpriceable. */
  valueUsd: number | null
  checks: GuardrailCheck[]
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
 */
export function policyCheck(
  valueUsd: number | null,
  policy: GrantPolicy | null,
  spentTodayUsd: number,
  host: string,
  spentTotalUsd = 0,
): { check: GuardrailCheck; violation: GrantViolation | 'VALUE_UNKNOWN' | null } {
  if (!policy) {
    return { check: { id: 'policy', level: 'warn', ok: true, note: 'No spend policy on this wallet — not gated.' }, violation: null }
  }
  if (valueUsd === null) {
    if (!policy.spendPolicyEnabled) {
      return { check: { id: 'policy', level: 'warn', ok: true, note: 'Spend policy is off; value unpriced.' }, violation: null }
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
  return {
    check: {
      id: 'policy',
      level: 'block',
      ok: !violation,
      note: violation
        ? `Blocked by your spend policy: ${violation} ($${valueUsd.toFixed(2)}).`
        : `Within your spend policy ($${valueUsd.toFixed(2)}).`,
    },
    violation,
  }
}

/** Assemble the report. `ok` = no failed block-level check. */
export function buildReport(valueUsd: number | null, checks: GuardrailCheck[]): GuardrailReport {
  return { ok: checks.every((c) => c.ok || c.level !== 'block'), valueUsd, checks }
}
