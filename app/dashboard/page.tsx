'use client'

// Dashboard · Overview — KPIs, the budget meter (+ EIP-712 sign button), and
// the spend charts. The layout above guarantees a signed-in session.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Building2, Pause, Play, ShieldCheck, ShieldPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SpendByAgent, SpendOverTime } from '@/components/LazyCharts'
import SignGrantButton from '@/components/SignGrantButton'
import FundAccountCard from '@/components/FundAccountCard'
import { Card, CardTitle, Kpi, SkeletonKpi, SkeletonCard, Skeleton, type Stats } from '@/lib/dashboard-ui'
import { PolicySwitch, BudgetEditor } from '@/components/SpendPolicyControls'
import { useToast } from '@/lib/toast'
import EarnPanel from '@/components/EarnPanel'
import OnboardingChecklist from '@/components/OnboardingChecklist'
import WelcomeNudge from '@/components/WelcomeNudge'
import PayToAgentsCard from '@/components/PayToAgentsCard'
import { useOrgStore } from '@/lib/org-store'
import Button from '@/components/Button'

export default function DashboardOverviewPage() {
  const { activeOrgId } = useOrgStore()
  const { toast } = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [freezing, setFreezing] = useState(false)
  const [policing, setPolicing] = useState(false)
  const [backing, setBacking] = useState(false)
  const [backErr, setBackErr] = useState<string | null>(null)

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

  // Back the account on-chain with a Coinbase Spend Permission mirroring the
  // grant's per-day cap — the hard stop above the SDK-advisory budget. Defaults
  // to Base Sepolia server-side until a mainnet Smart Account is funded.
  const backOnChain = async (grantId: string) => {
    setBacking(true)
    setBackErr(null)
    try {
      const r = await fetch(`/api/grants/${grantId}/spend-permission`, { method: 'POST' })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        const msg = b.detail || b.error || `Failed (${r.status})`
        setBackErr(msg)
        toast(`On-chain backing failed: ${msg}`, 'error')
        return
      }
      await load()
      toast('Account backed on-chain — Spend Permission active.', 'success')
    } finally {
      setBacking(false)
    }
  }

  // The master power switch: when off, the spend policy is bypassed entirely —
  // the agent can use any MCP with no caps. Flips one flag; it never touches the
  // per-agent approvals, so a curated allowlist survives toggling it back on.
  const togglePolicy = async (grantId: string, spendPolicyEnabled: boolean) => {
    setPolicing(true)
    try {
      const r = await fetch(`/api/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spendPolicyEnabled }),
      })
      await load()
      if (r.ok) toast(spendPolicyEnabled ? 'Spending policy on — caps enforced.' : 'Spending policy off — unrestricted.', 'success')
      else toast(`Couldn’t update the policy (${r.status}).`, 'error')
    } finally {
      setPolicing(false)
    }
  }

  // The account-level kill switch: freeze every payment under this grant
  // (reversible). Hard-enforced on the chat rails Yeetful executes.
  const toggleFreeze = async (grantId: string, paused: boolean) => {
    setFreezing(true)
    try {
      const r = await fetch(`/api/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      await load()
      if (r.ok) toast(paused ? 'Account frozen — every payment refused.' : 'Account resumed.', 'success')
      else toast(`Couldn’t ${paused ? 'freeze' : 'resume'} the account (${r.status}).`, 'error')
    } finally {
      setFreezing(false)
    }
  }

  if (!stats) {
    // Skeleton mirrors the real layout (KPI row → expense-account card → two
    // charts) so the page fills in rather than flashing a spinner.
    return (
      <>
        <h1 className="dash__h1">Overview</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <Card className="mb-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72 mt-2" />
          <Skeleton className="h-2 w-full mt-4 rounded-full" />
        </Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonCard bodyClassName="h-48" />
          <SkeletonCard bodyClassName="h-48" />
        </div>
        <span className="sr-only" role="status">Loading your spend data…</span>
      </>
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

      {/* First-session welcome strip (dismissible, never returns) → points at
          the checklist anchor just below. */}
      <WelcomeNudge />

      {/* First-run guided path — self-ticks from live state, hides when done
          or dismissed. */}
      <div id="get-started" className="scroll-mt-24">
        <OnboardingChecklist stats={stats} />
      </div>

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

      <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Spend · your agents
      </h2>
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
        <div className="flex items-start lg:items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
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
            <span className="flex items-center gap-3 flex-wrap max-lg:w-full">
              {/* Master power switch — default OFF for new users (unrestricted).
                  Independent of the per-agent approvals and of the freeze. */}
              <PolicySwitch
                enabled={g.spendPolicyEnabled}
                busy={policing}
                onChange={(next) => void togglePolicy(g.id, next)}
              />
              {/* The button re-checks signed state on every mount — approval
                  toggles (which void signatures server-side) live on their own
                  page now, so navigation back here refreshes the badge. */}
              <SignGrantButton grantId={g.id} />
              {g.backedOnChain && (
                <span
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-400 bg-emerald-500/[0.06]"
                  title={`Backed on-chain — a Coinbase Spend Permission caps this account in the wallet contract${g.spendPermissionNetwork ? ` (${g.spendPermissionNetwork})` : ''}, a hard stop above the SDK-advisory budget.`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  Backed on-chain
                </span>
              )}
              {!g.backedOnChain && (
                <Button
                  variant="secondary"
                  onClick={() => void backOnChain(g.id)}
                  loading={backing}
                  icon={ShieldPlus}
                  title="Back this account on-chain with a Coinbase Spend Permission mirroring your daily cap — a hard stop above the SDK-advisory budget."
                >
                  Back on-chain
                </Button>
              )}
              <Button
                variant={g.paused ? 'warning' : 'secondary'}
                onClick={() => void toggleFreeze(g.id, !g.paused)}
                loading={freezing}
                icon={g.paused ? Play : Pause}
                title={g.paused ? 'Resume — unfreeze the account' : 'Freeze — stop all payments under this account (reversible)'}
              >
                {g.paused ? 'Resume account' : 'Freeze account'}
              </Button>
              <span className="mono text-xs text-[color:var(--muted)] flex items-center gap-1">
                ${g.spentTodayUsd.toFixed(4)} /{' '}
                <BudgetEditor grantId={g.id} perDayUsd={g.perDayUsd} onSaved={load} suffix="today" />
              </span>
            </span>
          )}
        </div>
        {g && !g.spendPolicyEnabled && (
          <p className="mt-2 text-xs text-[color:var(--muted)] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
            Spending policy is <strong className="text-white font-medium">off</strong> — your agent can
            use any MCP with no caps. Your per-agent approvals are kept; turn the policy on to enforce
            them again.
          </p>
        )}
        {backErr && (
          <p className="mt-2 text-xs text-red-400">On-chain backing failed: {backErr}</p>
        )}
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

      {/* Personal account only — the balance is the connected wallet's USDC.
          Org Overview shows the org budget instead, not a single wallet. */}
      {!activeOrgId && <FundAccountCard />}

      {/* The EARN side, lifted up directly under Spend so the two-sided model
          is visible without scrolling past the spend charts. EarnPanel shows
          zeroed KPIs + a "Connect your MCPs" CTA until receipts flow; the payee
          roster self-hides for pure payers. */}
      <div className="mt-6">
        <EarnPanel />
      </div>
      <PayToAgentsCard />

      {/* Spend detail charts last. grid-cols-1 (not the implicit auto track) +
          min-w-0 so a chart's transient fixed-px width can never inflate the
          column on phones. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
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
