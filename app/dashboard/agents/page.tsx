'use client'

// Dashboard · Agents — the control plane's richest screen: per-agent
// approval (the allowlist) PLUS per-agent spend caps and live spent-today
// meters. Caps are policy terms: editing one voids the EIP-712 signature
// (the API enforces that; the Overview nudges a re-sign).

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { analytics } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { Card, type Stats } from '@/lib/dashboard-ui'

interface AgentRow {
  serverId: string
  slug: string
  name: string
  category: string
  callable: boolean
  priceUsd: string | null
  approved: boolean
  perCallUsd: number | null
  perDayUsd: number | null
  spentTodayUsd: number
}

export default function DashboardAgentsPage() {
  const [rows, setRows] = useState<AgentRow[] | null>(null)
  const [grantCaps, setGrantCaps] = useState<{ perCallUsd: number; perDayUsd: number } | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    void fetch('/api/approvals', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => a && setRows(a))
    void fetch('/api/dashboard/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Stats | null) => s?.grant && setGrantCaps({ perCallUsd: s.grant.perCallUsd, perDayUsd: s.grant.perDayUsd }))
  }, [])
  useEffect(() => { load() }, [load])

  const put = async (serverId: string, body: Record<string, unknown>) => {
    setSavingId(serverId)
    setError('')
    const res = await fetch('/api/approvals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, ...body }),
    })
    setSavingId(null)
    if (!res.ok) {
      setError((await res.json().catch(() => ({})))?.error ?? 'Update failed.')
      return false
    }
    return true
  }

  const toggle = async (serverId: string, approved: boolean) => {
    analytics.approvalToggled(rows?.find((r) => r.serverId === serverId)?.slug ?? serverId, approved)
    setRows((prev) => prev?.map((r) => (r.serverId === serverId ? { ...r, approved } : r)) ?? prev)
    if (!(await put(serverId, { approved }))) {
      setRows((prev) => prev?.map((r) => (r.serverId === serverId ? { ...r, approved: !approved } : r)) ?? prev)
    }
  }

  /** Commit a cap on blur/Enter. Empty input clears (inherit the grant). */
  const commitCap = async (row: AgentRow, field: 'perCallUsd' | 'perDayUsd', raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      setError('Caps must be positive numbers (or empty to inherit).')
      return
    }
    if (value === row[field]) return
    const prev = row[field]
    setRows((p) => p?.map((r) => (r.serverId === row.serverId ? { ...r, [field]: value } : r)) ?? p)
    if (!(await put(row.serverId, { [field]: value }))) {
      setRows((p) => p?.map((r) => (r.serverId === row.serverId ? { ...r, [field]: prev } : r)) ?? p)
    }
  }

  return (
    <>
      <h1 className="dash__h1">Agents</h1>
      <p className="dash__sub">
        Your expense account, per agent: the switch is the allowlist, and the caps bound what each
        agent may spend — null inherits the grant&apos;s defaults. Edits void a signed grant until
        you re-sign on the Overview.
      </p>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      <Card>
        {!rows ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">Loading agents…</p>
        ) : (
          <div className="divide-y divide-white/5">
            {rows.map((a) => {
              const dayCap = a.perDayUsd ?? grantCaps?.perDayUsd ?? null
              const pct = dayCap ? Math.min(100, (a.spentTodayUsd / dayCap) * 100) : 0
              return (
                <div key={a.serverId} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
                  {/* Identity */}
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-xs text-white truncate">
                      {a.name}
                      {a.callable && <span className="text-emerald-400/90"> ·live</span>}
                    </p>
                    <p className="text-[10px] text-[color:var(--muted-2)]">
                      {a.category}
                      {a.priceUsd ? ` · $${a.priceUsd}/call` : ''}
                    </p>
                  </div>

                  {/* Spent-today meter (only meaningful with spend or caps) */}
                  <div className="w-28 flex-shrink-0 max-lg:order-last max-lg:w-full">
                    <div className="flex justify-between text-[10px] mono text-[color:var(--muted-2)]">
                      <span>${a.spentTodayUsd.toFixed(2)}</span>
                      <span>{dayCap != null ? `$${dayCap}` : '—'}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', pct > 85 ? 'bg-red-400' : 'bg-emerald-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Caps */}
                  <label className="flex items-center gap-1 text-[10px] text-[color:var(--muted-2)] flex-shrink-0">
                    /call
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      min="0.001"
                      defaultValue={a.perCallUsd ?? ''}
                      placeholder={grantCaps ? String(grantCaps.perCallUsd) : '—'}
                      onBlur={(e) => void commitCap(a, 'perCallUsd', e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className="w-16 px-1.5 py-1 max-lg:min-h-10 max-lg:text-base rounded-md bg-black/30 border border-[var(--line)] text-white text-[11px] mono focus:outline-none focus:border-[var(--line-2)]"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-[color:var(--muted-2)] flex-shrink-0">
                    /day
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.001"
                      defaultValue={a.perDayUsd ?? ''}
                      placeholder={grantCaps ? String(grantCaps.perDayUsd) : '—'}
                      onBlur={(e) => void commitCap(a, 'perDayUsd', e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className="w-16 px-1.5 py-1 max-lg:min-h-10 max-lg:text-base rounded-md bg-black/30 border border-[var(--line)] text-white text-[11px] mono focus:outline-none focus:border-[var(--line-2)]"
                    />
                  </label>

                  {/* Detail + switch */}
                  <Link
                    href={`/servers/${a.slug}`}
                    className="flex-shrink-0 p-1 max-lg:p-[13px] max-lg:-my-2 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
                    title={`${a.name} — endpoints & pricing`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    role="switch"
                    aria-checked={a.approved}
                    disabled={savingId === a.serverId}
                    onClick={() => void toggle(a.serverId, !a.approved)}
                    className={cn(
                      'flex-shrink-0 w-8 h-[18px] max-lg:w-11 max-lg:h-[26px] rounded-full relative transition-colors disabled:opacity-50',
                      a.approved ? 'bg-emerald-500' : 'bg-white/10',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-[2px] w-[14px] h-[14px] max-lg:w-[22px] max-lg:h-[22px] rounded-full bg-white transition-all',
                        a.approved ? 'left-[16px] max-lg:left-[20px]' : 'left-[2px]',
                      )}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}
