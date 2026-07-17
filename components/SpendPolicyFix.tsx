'use client'

// SpendPolicyFix — the way OUT of a spend-policy refusal, rendered right
// where the block happened (a failed JobCard step, a blocked swap reply).
// A refusal used to be a dead end ("NOT_ALLOWED ($5.00)" with no verb): this
// names the cause in words, offers the ONE change that unblocks it — allow
// the venue host / raise the right cap — and retries the build in place.
// Adjusting policy is a settings write (nothing money-moving happens here);
// every buy still signs from the user's wallet afterwards.
//
// Auth degrades honestly: the inline actions need the owner's session (the
// grant PATCH is SIWE-gated), so an embed visitor without one sees the
// explanation + the dashboard link instead of buttons that would 401.

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, ShieldAlert } from 'lucide-react'

export interface PolicyBlockInfo {
  violation: string
  valueUsd: number | null
  host: string
}

/** Friendly names for Yeetful's own venue policy hosts — "uniswap.yeetful.com"
 *  reads as a mystery third party when it's really the native swap layer. */
const HOST_LABEL: Record<string, string> = {
  'uniswap.yeetful.com': "Yeetful's native Uniswap venue",
  'lifi.yeetful.com': "Yeetful's LiFi settlement venue",
  'api.cow.fi': 'the CoW Swap venue',
  'aave-mcp.yeetful.com': 'the Aave agent',
  'api.hyperliquid.xyz': 'the Hyperliquid venue',
}

interface GrantLite {
  id: string
  perCallUsd: number
  perDayUsd: number
  spentTodayUsd: number
}

function explain(block: PolicyBlockInfo): string {
  const usd = block.valueUsd != null ? `$${block.valueUsd.toFixed(2)} ` : ''
  const hostLabel = HOST_LABEL[block.host] ?? block.host
  switch (block.violation) {
    case 'NOT_ALLOWED':
      return `Your spending policy refused this ${usd}action: ${hostLabel} (${block.host}) isn't on your allowlist.`
    case 'OVER_PER_CALL':
      return `Your spending policy refused this ${usd}action: it's over your per-action cap.`
    case 'BUDGET_EXCEEDED':
      return `Your spending policy refused this ${usd}action: it would put today over your budget cap.`
    case 'VALUE_UNKNOWN':
      return `Your spending policy is on, but this action has no priceable leg — it was refused rather than bypassing your caps.`
    case 'ACCOUNT_FROZEN':
      return 'Your expense account is frozen (kill switch) — unfreeze it on the dashboard to proceed.'
    case 'EXPIRED':
      return 'Your expense account has expired — renew it on the dashboard to proceed.'
    default:
      return `Your spending policy refused this ${usd}action (${block.violation}).`
  }
}

export default function SpendPolicyFix({
  block,
  onFixed,
  retryLabel = 'Rebuild it',
}: {
  block: PolicyBlockInfo
  /** Called after a successful policy change (and by the standalone retry
   *  button) — the host surface re-arms its build. */
  onFixed?: () => void | Promise<void>
  retryLabel?: string
}) {
  const [grant, setGrant] = useState<GrantLite | null>(null)
  const [phase, setPhase] = useState<'idle' | 'fixing' | 'fixed' | 'error'>('idle')
  const [note, setNote] = useState('')

  // The owner's active grant, if this browser has a session. Two hops
  // (stats → grant) because only the grant GET carries today's spend,
  // which sizes the honest daily-cap suggestion.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await fetch('/api/dashboard/stats', { cache: 'no-store' })
        if (!s.ok) return
        const stats = (await s.json()) as { grant?: { id: string } | null }
        if (!stats.grant?.id) return
        const g = await fetch(`/api/grants/${stats.grant.id}`, { cache: 'no-store' })
        if (!g.ok) return
        const full = (await g.json()) as GrantLite
        if (alive) setGrant({ id: full.id, perCallUsd: full.perCallUsd, perDayUsd: full.perDayUsd, spentTodayUsd: full.spentTodayUsd ?? 0 })
      } catch {
        /* guests keep the explanation + link */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const patch = useCallback(
    async (body: Record<string, unknown>, doneNote: string) => {
      if (!grant) return
      setPhase('fixing')
      try {
        const r = await fetch(`/api/grants/${grant.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error(String(r.status))
        setNote(doneNote)
        setPhase('fixed')
        await onFixed?.()
      } catch {
        setNote("Couldn't update the policy — adjust it on the dashboard instead.")
        setPhase('error')
      }
    },
    [grant, onFixed],
  )

  // The one suggested cap per violation — minimal-sufficient, never silent
  // (the button says the exact number it sets).
  const usd = block.valueUsd ?? 0
  const perCallTarget = Math.max(1, Math.ceil(usd))
  const dayTarget = grant ? Math.max(grant.perDayUsd, Math.ceil(grant.spentTodayUsd + usd)) : 0

  const action = (() => {
    if (!grant || phase === 'fixed') return null
    switch (block.violation) {
      case 'NOT_ALLOWED':
        return { label: `Allow ${HOST_LABEL[block.host] ?? block.host}`, run: () => patch({ allowAdd: block.host }, `${block.host} allowed.`) }
      case 'OVER_PER_CALL':
        return { label: `Raise per-action cap to $${perCallTarget}`, run: () => patch({ perCallUsd: perCallTarget }, `Per-action cap set to $${perCallTarget}.`) }
      case 'BUDGET_EXCEEDED':
        return { label: `Raise daily budget to $${dayTarget}`, run: () => patch({ perDayUsd: dayTarget }, `Daily budget set to $${dayTarget}.`) }
      default:
        return null
    }
  })()

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[12.5px] leading-relaxed">{explain(block)}</p>
          {note && <p className={`text-[12px] ${phase === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{note}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {action && (
              <button
                onClick={() => void action.run()}
                disabled={phase === 'fixing'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1 text-[12px] font-medium text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
              >
                {phase === 'fixing' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                {action.label}
              </button>
            )}
            {phase === 'fixed' && onFixed && (
              <span className="text-[12px] text-[color:var(--muted)]">Rebuilding with the new policy…</span>
            )}
            {phase !== 'fixed' && onFixed && (
              <button
                onClick={() => void onFixed()}
                className="rounded-lg border border-[var(--line-2)] px-2.5 py-1 text-[12px] text-[color:var(--muted)] hover:text-white transition-colors"
              >
                {retryLabel}
              </button>
            )}
            <a
              href="/dashboard/approvals"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-[color:var(--muted)] hover:text-white transition-colors"
            >
              Spending policy <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
