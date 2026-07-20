// ─────────────────────────────────────────────────────────────────────────
//  Guardrailed CoW order build — the ONE code path from "swap parameters" to
//  "signable (or refused) order". Shared by POST /api/cow/quote and the chat
//  swap fast-path so the two can never drift (the burner/wallet synthesis
//  split taught us what duplicated turn logic costs). Quote/limit build +
//  slippage + guardrails + spend-policy gate + ledgered denial, no signing.
// ─────────────────────────────────────────────────────────────────────────

import {
  fetchCowQuote,
  buildCowLimitOrder,
  cowOrderAction,
  describeCowOrder,
  applySlippage,
  type CowQuoteResult,
} from '@/lib/cow'
import { buildSignableArtifact, type SignableArtifact } from '@/lib/transaction-layer'
import {
  pureChecks,
  chainChecks,
  policyCheck,
  orderValueUsd,
  buildReport,
  COW_POLICY_HOST,
  type GuardrailReport,
} from '@/lib/cow-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

export interface GuardrailedOrderParams {
  mode: 'swap' | 'limit'
  chainId?: number
  sellToken: string
  buyToken: string
  /** Atoms. */
  sellAmount: string
  /** Atoms — limit mode only. */
  buyAmountAtLeast?: string
  from: string
  receiver?: string
  /** Swap mode only; validated by the caller against MAX_SLIPPAGE_BPS. */
  slippageBps?: number
}

export interface GuardrailedOrder {
  quote: CowQuoteResult
  summary: string
  guardrails: GuardrailReport
  /** Null when a block-level guardrail failed — never offer it. */
  artifact: SignableArtifact | null
  blocked: boolean
}

/**
 * Build a CoW order and run the full A3 guardrail pass. Throws on build
 * errors (unknown token, bad amounts, unroutable pair) with a user-readable
 * message; a guardrail refusal is NOT a throw — it returns `blocked: true`
 * with the report, and the policy denial is already ledgered.
 */
export async function buildGuardrailedOrder(params: GuardrailedOrderParams): Promise<GuardrailedOrder> {
  const chainId = params.chainId ?? 8453
  let quote =
    params.mode === 'limit'
      ? buildCowLimitOrder({
          chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.sellAmount,
          buyAmountAtLeast: params.buyAmountAtLeast ?? '',
          from: params.from,
          receiver: params.receiver,
        })
      : await fetchCowQuote({
          chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmountBeforeFee: params.sellAmount,
          from: params.from,
          receiver: params.receiver,
        })
  if (params.mode === 'swap') quote = applySlippage(quote, params.slippageBps ?? 50)

  const checks = pureChecks(quote, params.from)
  checks.push(...(await chainChecks(quote, params.from)))
  const valueUsd = orderValueUsd(quote.order, chainId)
  const grant = await getActiveGrant(params.from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { check: polCheck, violation } = policyCheck(valueUsd, policy, spentToday, COW_POLICY_HOST, 0, { selfSigned: true })
  checks.push(polCheck)
  const guardrails = buildReport(valueUsd, checks, violation ? { violation, valueUsd, host: COW_POLICY_HOST } : null)

  // A refusal is a first-class outcome — same ledger trail as chat denials.
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: COW_POLICY_HOST,
      serviceName: 'CoW Swap',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (cow ${params.mode} order)`,
    })
  }

  const summary = describeCowOrder(quote, params.mode)
  const artifact = guardrails.ok ? buildSignableArtifact(cowOrderAction(quote, summary)) : null
  return { quote, summary, guardrails, artifact, blocked: !guardrails.ok }
}
