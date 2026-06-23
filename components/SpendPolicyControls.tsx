'use client'

// Shared controls for the optional spend policy. The master power switch and
// the daily-budget editor both appear in more than one place (Overview, Chat,
// Approvals), so they live here as small reusable pieces.
//
//  • PolicySwitch  — controlled toggle for grant.spendPolicyEnabled. Parent owns
//    the PATCH + refetch; this is presentational so each host wires its own data.
//  • BudgetEditor  — inline editor for grant.perDayUsd; self-contained (it PATCHes
//    and calls onSaved), since every host wants the same write behavior.

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Read + toggle the account's spend policy from anywhere (chat, etc.). Loads the
 * active grant via the dashboard stats route (which mints one if missing), so it
 * only resolves when the user is signed in. `available` is false for guests.
 */
export function useSpendPolicy(active: boolean) {
  const [grantId, setGrantId] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!active) return
    try {
      const r = await fetch('/api/dashboard/stats', { cache: 'no-store' })
      if (!r.ok) return
      const s = await r.json()
      if (s.grant) {
        setGrantId(s.grant.id)
        setEnabled(s.grant.spendPolicyEnabled)
      }
    } catch {
      /* chat works without the toggle resolving */
    }
  }, [active])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(
    async (next: boolean) => {
      if (!grantId) return
      setBusy(true)
      try {
        await fetch(`/api/grants/${grantId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spendPolicyEnabled: next }),
        })
        setEnabled(next)
      } finally {
        setBusy(false)
      }
    },
    [grantId],
  )

  return { grantId, enabled: !!enabled, busy, toggle, refresh, available: grantId !== null }
}

export function PolicySwitch({
  enabled,
  busy,
  onChange,
  className,
}: {
  enabled: boolean
  busy?: boolean
  onChange: (next: boolean) => void
  className?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label="Spending policy"
      disabled={busy}
      onClick={() => onChange(!enabled)}
      title={
        enabled
          ? 'Spending policy ON — allowlist + budgets enforced before any payment'
          : 'Spending policy OFF — unrestricted: any MCP, no caps'
      }
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 max-lg:min-h-10 rounded-lg border transition-colors disabled:opacity-50',
        enabled
          ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/[0.06]'
          : 'border-[var(--line-2)] text-[color:var(--muted)] hover:text-white',
        className,
      )}
    >
      <span
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
          enabled ? 'bg-emerald-500' : 'bg-white/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            enabled && 'translate-x-4',
          )}
        />
      </span>
      <span className="text-xs font-medium whitespace-nowrap">
        {enabled ? 'Spending policy on' : 'Spending policy off'}
      </span>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
    </button>
  )
}

export function BudgetEditor({
  grantId,
  perDayUsd,
  onSaved,
  suffix = '/ day',
  disabled,
  className,
}: {
  grantId: string
  perDayUsd: number
  onSaved?: () => void | Promise<void>
  suffix?: string
  disabled?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(perDayUsd))
  const [saving, setSaving] = useState(false)

  // Keep the field in sync when the cap changes elsewhere (e.g. saved on another
  // surface, or the stats refetch).
  useEffect(() => {
    if (!editing) setVal(String(perDayUsd))
  }, [perDayUsd, editing])

  const cancel = () => {
    setVal(String(perDayUsd))
    setEditing(false)
  }

  const save = async () => {
    const n = Number(val)
    if (!Number.isFinite(n) || n <= 0) {
      cancel()
      return
    }
    const rounded = Math.round(n * 100) / 100
    if (rounded === perDayUsd) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await fetch(`/api/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ perDayUsd: rounded }),
      })
      await onSaved?.()
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <span className={cn('inline-flex items-center gap-1 mono text-xs', className)}>
        <span className="text-[color:var(--muted-2)]">$</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') cancel()
          }}
          className="w-16 bg-transparent border-b border-[var(--line-2)] text-white outline-none focus:border-emerald-400"
        />
        <button onClick={() => void save()} disabled={saving} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50" aria-label="Save daily budget">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button onClick={cancel} disabled={saving} className="text-[color:var(--muted-2)] hover:text-white disabled:opacity-50" aria-label="Cancel">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      title="Edit the daily budget"
      className={cn(
        'group inline-flex items-center gap-1 mono text-xs text-[color:var(--muted)] hover:text-white transition-colors disabled:opacity-50',
        className,
      )}
    >
      ${perDayUsd.toFixed(2)} {suffix}
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  )
}