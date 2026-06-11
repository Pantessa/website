'use client'

// Dashboard · Overview — KPIs, the budget meter (+ EIP-712 sign button), and
// the spend charts. The layout above guarantees a signed-in session.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SpendByAgent, SpendOverTime } from '@/components/DashboardCharts'
import SignGrantButton from '@/components/SignGrantButton'
import { Card, CardTitle, Kpi, type Stats } from '@/lib/dashboard-ui'

export default function DashboardOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void fetch('/api/dashboard/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStats(s))
  }, [])

  if (!stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-[color:var(--muted)] py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your spend data…
      </div>
    )
  }

  const k = stats.kpis
  const g = stats.grant
  const todayPct = g && g.perDayUsd > 0 ? Math.min(100, (g.spentTodayUsd / g.perDayUsd) * 100) : 0

  return (
    <>
      <h1 className="dash__h1">Overview</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Total spent" value={`$${(k?.spentTotalUsd ?? 0).toFixed(4)}`} />
        <Kpi label="Calls paid" value={String(k?.calls ?? 0)} sub={k?.deniedCalls ? `${k.deniedCalls} blocked/failed` : undefined} />
        <Kpi
          label="Today"
          value={`$${(g?.spentTodayUsd ?? k?.spentTodayUsd ?? 0).toFixed(4)}`}
          sub={g ? `of $${g.perDayUsd.toFixed(2)} daily cap` : 'no cap set'}
        />
        <Kpi label="Top agent" value={k?.topAgent ?? '—'} small />
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
              <span className="mono text-xs text-[color:var(--muted)]">
                ${g.spentTodayUsd.toFixed(4)} / ${g.perDayUsd.toFixed(2)} today
              </span>
            </span>
          )}
        </div>
        {g && (
          <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', todayPct > 85 ? 'bg-red-400' : 'bg-emerald-400')}
              style={{ width: `${todayPct}%` }}
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
          <CardTitle>Spend by agent</CardTitle>
          <SpendByAgent perAgent={stats.perAgent ?? []} />
        </Card>
      </div>
    </>
  )
}
