'use client'

// SpendPolicyFix — what a refused build says, rendered where the refusal
// happened (a failed JobCard step, a blocked chat reply, the wallet Send
// form). It used to offer the way OUT of a spend-policy refusal — allow the
// venue host, raise the right cap — but the spend policy was retired on
// 2026-10-30: nothing is allowlisted or capped any more. The only refusal
// that can land here now is the account's kill switch (frozen from the
// dashboard Overview, or revoked) or a gate that could not run. So this
// names the cause, points at the dashboard, and re-runs the ask on request.

import { ExternalLink, ShieldAlert } from 'lucide-react'

export interface PolicyBlockInfo {
  violation: string
  valueUsd: number | null
  host: string
}

function explain(block: PolicyBlockInfo): string {
  const usd = block.valueUsd != null ? `$${block.valueUsd.toFixed(2)} ` : ''
  switch (block.violation) {
    case 'ACCOUNT_FROZEN':
      return `Your account is frozen (kill switch), so this ${usd}action was refused. Resume it on the dashboard, then ask again.`
    case 'REVOKED':
      return `Your account was revoked, so this ${usd}action was refused. Open the dashboard to start a fresh one.`
    case 'POLICY_ERROR':
      return `Your account could not be checked, so this ${usd}action was refused rather than guessed at. Ask again; if it keeps happening, open the dashboard.`
    default:
      return `This ${usd}action was refused by your account (${block.violation}).`
  }
}

export default function SpendPolicyFix({
  block,
  onFixed,
  retryLabel = 'Rebuild it',
}: {
  block: PolicyBlockInfo
  /** Re-runs the ask that was refused (after the user resumed the account). */
  onFixed?: () => void | Promise<void>
  retryLabel?: string
}) {
  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[12.5px] leading-relaxed">{explain(block)}</p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {onFixed && (
              <button
                onClick={() => void onFixed()}
                className="rounded-lg border border-[var(--line-2)] px-2.5 py-1 text-[length:var(--fs-sm)] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
              >
                {retryLabel}
              </button>
            )}
            <a
              href="/dashboard"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[length:var(--fs-sm)] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
            >
              Dashboard <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
