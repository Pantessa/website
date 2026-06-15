'use client'

// Dashboard · Overview — KPIs, the budget meter (+ EIP-712 sign button), and
// the spend charts. The layout above guarantees a signed-in session.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Building2, Loader2, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SpendByAgent, SpendOverTime } from '@/components/DashboardCharts'
import SignGrantButton from '@/components/SignGrantButton'
import { Card, CardTitle, Kpi, type Stats } from '@/lib/dashboard-ui'
import { useOrgStore } from '@/lib/org-store'

export default function DashboardOverviewPage() {
  const { activeOrgId } = useOrgStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [freezing, setFreezing] = useState(false)

  // Keyed on the active org (F3): the rail switcher flips this page between
  // the personal and the org expense account.
  const load = useCallback(async () => {
    const r = await fetch(`/api/dashboard/stats${activeOrgId ? `?org=${activeOrgId}` : ''}`, { cache: 'no-store' })
    if (r.ok) setStats(await r.json())
  }, [activeOrgId])

  useEffect(() => {
    setStats(null)
    void load()
  }, [load])

  // The account-level kill switch: freeze every payment under this grant
  // (reversible). Hard-enforced on the chat rails Yeetful executes.
  const toggleFreeze = async (grantId: string, paused: boolean) => {
    setFreezing(true)
    try {
      await fetch(`/api/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      await load()
    } finally {
      setFreezing(false)
    }
  }

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-[color:var(--muted)] py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your spend data…
      </div>
    )
  }

  const k = stats.kpis
  const g = stats.grant
  const a = stats.agents
  const o = stats.org
  const todayPct = g && g.perDayUsd > 0 ? Math.min(100, (g.spentTodayUsd / g.perDayUsd) * 100) : 0
  const orgPct = o?.perDayUsd ? Math.min(100, (o.spentTodayUsd / o.perDayUsd) * 100) : 0

  return (
    <>
      <h1 className="dash__h1">{o ? `Overview · ${o.name}` : 'Overview'}</h1>

      {/* The org level of the two-level budget: the daily cap across ALL the
          org's agent keys, above the grant + per-key meters. SDK-enforced via
          /api/agent/policy — advisory at the rails until Spend Permissions. */}
      {o && (
        <Card className="mb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap min-w-0">
            <span className="flex items-center gap-2.5 min-w-0">
              <Building2 className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)]" />
              <span className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">Org daily budget</p>
                <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
                  {o.perDayUsd != null
                    ? `every agent key in ${o.name} draws from this cap`
                    : 'no org cap set — per-key budgets alone govern'}{' '}
                  <Link href="/dashboard/org" className="underline underline-offset-2 decoration-dotted hover:text-white">
                    {o.role === 'member' ? 'View org →' : 'Org settings →'}
                  </Link>
                </p>
              </span>
            </span>
            <span className={cn('mono text-xs', o.overBudget ? 'text-red-400' : 'text-[color:var(--muted)]')}>
              ${o.spentTodayUsd.toFixed(4)}
              {o.perDayUsd != null ? ` / $${o.perDayUsd.toFixed(2)} today` : ' today'}
              {o.overBudget ? ' — over budget' : ''}
            </span>
          </div>
          {o.perDayUsd != null && (
            <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', o.overBudget || orgPct > 85 ? 'bg-red-400' : 'bg-emerald-400')}
                style={{ width: `${orgPct}%` }}
              />
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total spent" value={`$${(k?.spentTotalUsd ?? 0).toFixed(4)}`} />
        <Kpi label="Calls paid" value={String(k?.calls ?? 0)} sub={k?.deniedCalls ? `${k.deniedCalls} blocked/failed` : undefined} />
        <Kpi
          label="Today"
          value={`$${(g?.spentTodayUsd ?? k?.spentTodayUsd ?? 0).toFixed(4)}`}
          sub={g ? `of $${g.perDayUsd.toFixed(2)} daily cap` : 'no cap set'}
        />
        {/* A key IS an agent — count from api_keys, top by key-attributed
            settled spend today. Links through to the Agents tab. */}
        <Link href="/dashboard/agents" className="block min-w-0 transition-opacity hover:opacity-85">
          <Kpi
            label="Connected agents"
            value={String(a?.connected ?? 0)}
            sub={
              a?.topToday
                ? `top today: ${a.topToday.label.length > 24 ? `${a.topToday.label.slice(0, 24)}…` : a.topToday.label} · $${a.topToday.spentTodayUsd.toFixed(2)}`
                : 'apps paying via the SDK →'
            }
          />
        </Link>
      </div>

      <Card className="mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white">{g?.label ?? 'No expense account yet'}</p>
            <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
              {g
                ? `$${g.perCallUsd} per call max · ${g.allowCount} approved hosts · expires ${new Date(g.expiresAt).toLocaleDateString()}`
                : 'Your account mints automatically — default caps $0.05/call, $5/day.'}{' '}
              <Link href="/dashboard/keys" className="underline underline-offset-2 decoration-dotted hover:text-white">
                Mint an API key →
              </Link>
            </p>
            {g && g.allowCount === 0 && (
              <p className="text-xs text-amber-400/90 mt-1">
                Nothing approved yet — your account refuses all payments. Turn on the agents you
                trust in{' '}
                <Link href="/dashboard/approvals" className="underline underline-offset-2">
                  Approvals
                </Link>
                .
              </p>
            )}
          </div>
          {g && (
            <span className="flex items-center gap-3 flex-wrap">
              {/* The button re-checks signed state on every mount — approval
                  toggles (which void signatures server-side) live on their own
                  page now, so navigation back here refreshes the badge. */}
              <SignGrantButton grantId={g.id} />
              <button
                onClick={() => void toggleFreeze(g.id, !g.paused)}
                disabled={freezing}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium px-3 py-2 max-lg:min-h-10 rounded-lg border transition-colors disabled:opacity-50',
                  g.paused
                    ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                    : 'border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white',
                )}
                title={g.paused ? 'Resume — unfreeze the account' : 'Freeze — stop all payments under this account (reversible)'}
              >
                {freezing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : g.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {g.paused ? 'Resume account' : 'Freeze account'}
              </button>
              <span className="mono text-xs text-[color:var(--muted)]">
                ${g.spentTodayUsd.toFixed(4)} / ${g.perDayUsd.toFixed(2)} today
              </span>
            </span>
          )}
        </div>
        {g?.paused && (
          <p className="mt-2 text-xs text-amber-400 flex items-center gap-1.5">
            <Pause className="w-3.5 h-3.5 flex-shrink-0" /> Account frozen — every payment under it is
            refused until you resume. Chats Yeetful runs are hard-stopped; external SDK agents stop on
            their next policy check.
          </p>
        )}
        {g && (
          <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', g.paused ? 'bg-amber-400' : todayPct > 85 ? 'bg-red-400' : 'bg-emerald-400')}
              style={{ width: `${g.paused ? 100 : todayPct}%` }}
            />
          </div>
        )}
      </Card>

      {/* grid-cols-1 (not the implicit auto track) + min-w-0 so a chart's
          transient fixed-px width can never inflate the column on phones. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="min-w-0">
          <CardTitle>Spend · last 30 days</CardTitle>
          <SpendOverTime daily={stats.daily ?? []} />
        </Card>
        <Card className="min-w-0">
          {/* Renamed from "by agent": in the corrected model agents are KEYS;
              these groups are service_name rows — services money flowed to. */}
          <CardTitle>Spend by service</CardTitle>
          <SpendByAgent perAgent={stats.perAgent ?? []} />
        </Card>
      </div>
    </>
  )
}
