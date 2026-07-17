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
  const [phase, setPhase] = useState<'idle' | 'fixing' | 'rebuilding' | 'error'>('idle')
  const [note, setNote] = useState('')

  // The retry rebuilds INLINE, so when the fresh build is refused by the NEXT
  // policy check the card never unmounts — the new refusal lands as a prop
  // change on this same instance. Without this reset, the stale "allowed."
  // note + rebuilding phase mask the next fix (Nate's DCA looked "stuck":
  // allow-venue succeeded, then OVER_PER_CALL arrived into a card whose state
  // said "rebuilding…" and offered no button).
  const blockKey = `${block.violation}|${block.host}|${block.valueUsd ?? ''}`
  useEffect(() => {
    setPhase('idle')
    setNote('')
  }, [blockKey])

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
        // Track the caps we just set so a follow-up suggestion (same block
        // re-failing) computes from the NEW policy, not the stale fetch.
        setGrant((g) =>
          g
            ? {
                ...g,
                ...(typeof body.perCallUsd === 'number' ? { perCallUsd: body.perCallUsd } : {}),
                ...(typeof body.perDayUsd === 'number' ? { perDayUsd: body.perDayUsd } : {}),
              }
            : g,
        )
        setNote(doneNote)
        setPhase('rebuilding')
        await onFixed?.()
        // The rebuild resolved (inline). If it was refused again, the new
        // policyBlock prop resets this card for the next fix; if it succeeded,
        // the host surface unmounts us. Either way, stop saying "rebuilding".
        setPhase('idle')
      } catch {
        setNote("Couldn't update the policy — adjust it on the dashboard instead.")
        setPhase('error')
      }
    },
    [grant, onFixed],
  )

  // Suggested caps — minimal-sufficient, never silent (the button says the
  // exact numbers it sets). checkGrant refuses on the FIRST violation only,
  // but the component can see the whole picture: if the action's value also
  // exceeds a cap, folding that raise into the same click saves the user a
  // walk down the violation chain (allow venue → fail → raise cap → fail…).
  const usd = block.valueUsd ?? 0
  const perCallTarget = Math.max(1, Math.ceil(usd))
  const dayTarget = grant ? Math.max(grant.perDayUsd, Math.ceil(grant.spentTodayUsd + usd)) : 0
  const capFixes: Record<string, number> = {}
  const capWords: string[] = []
  if (grant && usd > 0 && usd > grant.perCallUsd) {
    capFixes.perCallUsd = perCallTarget
    capWords.push(`per-action cap $${perCallTarget}`)
  }
  if (grant && usd > 0 && grant.spentTodayUsd + usd > grant.perDayUsd) {
    capFixes.perDayUsd = dayTarget
    capWords.push(`daily budget $${dayTarget}`)
  }

  const action = (() => {
    if (!grant) return null
    switch (block.violation) {
      case 'NOT_ALLOWED': {
        const label = `Allow ${HOST_LABEL[block.host] ?? block.host}${capWords.length ? ` + set ${capWords.join(', ')}` : ''}`
        const done = `${block.host} allowed${capWords.length ? `; ${capWords.join(', ')}` : ''}.`
        return { label, run: () => patch({ allowAdd: block.host, ...capFixes }, done) }
      }
      case 'OVER_PER_CALL':
      case 'BUDGET_EXCEEDED': {
        if (capWords.length === 0) return null
        return { label: `Set ${capWords.join(' + ')}`, run: () => patch(capFixes, `Caps updated: ${capWords.join(', ')}.`) }
      }
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
            {action && phase !== 'rebuilding' && (
              <button
                onClick={() => void action.run()}
                disabled={phase === 'fixing'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1 text-[12px] font-medium text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
              >
                {phase === 'fixing' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                {action.label}
              </button>
            )}
            {phase === 'rebuilding' && onFixed && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted)]">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Rebuilding with the new policy…
              </span>
            )}
            {phase !== 'rebuilding' && onFixed && (
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
