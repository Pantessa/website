'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { Loader2, ShieldCheck, Wallet, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'
import { SpendByAgent, SpendOverTime } from '@/components/DashboardCharts'
import SignGrantButton from '@/components/SignGrantButton'
import ApiKeysPanel from '@/components/ApiKeysPanel'
import ConnectAgentCard from '@/components/ConnectAgentCard'

// ── API shapes ───────────────────────────────────────────────────────────────
interface Stats {
  grant: {
    id: string
    label: string
    perCallUsd: number
    perDayUsd: number
    allowCount: number
    expiresAt: string
    spentTodayUsd: number
    spentTotalUsd: number
    remainingTodayUsd: number
  } | null
  kpis: {
    spentTotalUsd: number
    spentTodayUsd: number
    calls: number
    deniedCalls: number
    successRate: number | null
    topAgent: string | null
  }
  daily: { day: string; spent: number; calls: number }[]
  perAgent: { service: string; spent: number; calls: number }[]
  recent: {
    id: string
    host: string
    serviceName: string | null
    amountUsd: number
    ok: boolean
    txHash: string | null
    note: string | null
    createdAt: string
  }[]
}
interface Approval {
  serverId: string
  slug: string
  name: string
  category: string
  callable: boolean
  priceUsd: string | null
  approved: boolean
}

export default function DashboardPage() {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { address, needsSignIn, signIn, signingIn, status } = useSession()

  const [stats, setStats] = useState<Stats | null>(null)
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [keyCount, setKeyCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([
        fetch('/api/dashboard/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/approvals', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      ])
      if (s) setStats(s)
      if (a) setApprovals(a)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (address) void load()
  }, [address, load])

  const toggle = async (serverId: string, approved: boolean) => {
    // Optimistic flip; the PUT syncs the grant allowlist server-side.
    setApprovals((prev) => prev?.map((a) => (a.serverId === serverId ? { ...a, approved } : a)) ?? prev)
    const res = await fetch('/api/approvals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, approved }),
    })
    if (!res.ok) {
      setApprovals((prev) => prev?.map((a) => (a.serverId === serverId ? { ...a, approved: !approved } : a)) ?? prev)
    } else {
      void fetch('/api/dashboard/stats', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setStats(s))
    }
  }

  if (!mounted) return null

  // ── Gates: wallet → SIWE → data ────────────────────────────────────────────
  if (!isConnected) {
    return (
      <Gate
        icon={<Wallet className="w-7 h-7" />}
        title="Connect your wallet"
        body="The dashboard shows your agent expense account — spend, approvals, and receipts — scoped to your wallet."
        cta="Connect Wallet"
        onClick={() => openConnectModal?.()}
      />
    )
  }
  if (!address) {
    return (
      <Gate
        icon={<ShieldCheck className="w-7 h-7" />}
        title="Sign in to your expense account"
        body="A quick wallet signature proves ownership — then your spend data and approvals load."
        cta={signingIn ? 'Signing in…' : 'Sign in with Ethereum'}
        onClick={() => signIn()}
        busy={signingIn || (status === 'loading' && !needsSignIn)}
      />
    )
  }

  const k = stats?.kpis
  const g = stats?.grant
  const todayPct = g && g.perDayUsd > 0 ? Math.min(100, (g.spentTodayUsd / g.perDayUsd) * 100) : 0

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="hero__eyebrow mono">AGENT EXPENSE ACCOUNT · {short(address)}</div>
        <h1 className="hero__h1 hero__h1--sm">
          Agents spend. <span className="hero__em">You approve.</span>
        </h1>
      </div>

      {loading && !stats ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--muted)] py-16 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your spend data…
        </div>
      ) : (
        <>
          {/* KPI tiles */}
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

          {/* Budget meter */}
          <Card className="mb-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-white">{g?.label ?? 'No expense account yet'}</p>
                <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
                  {g
                    ? `$${g.perCallUsd} per call max · ${g.allowCount} approved hosts · expires ${new Date(g.expiresAt).toLocaleDateString()}`
                    : 'Your account mints automatically — default caps $0.05/call, $5/day.'}
                </p>
                {g && g.allowCount === 0 && (
                  <p className="text-xs text-amber-400/90 mt-1">
                    Nothing approved yet — your account refuses all payments. Toggle on the agents you trust below.
                  </p>
                )}
              </div>
              {g && (
                <span className="flex items-center gap-3 flex-wrap">
                  {/* Approval toggles re-derive the allowlist and void a stale
                      signature server-side — refreshKey re-checks after them. */}
                  <SignGrantButton
                    grantId={g.id}
                    refreshKey={approvals?.map((a) => `${a.serverId}:${a.approved}`).join(',')}
                  />
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

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardTitle>Spend · last 30 days</CardTitle>
              <SpendOverTime daily={stats?.daily ?? []} />
            </Card>
            <Card>
              <CardTitle>Spend by agent</CardTitle>
              <SpendByAgent perAgent={stats?.perAgent ?? []} />
            </Card>
          </div>

          {/* Approvals */}
          <Card className="mb-6">
            <CardTitle>
              Agent approvals
              <span className="font-normal text-[color:var(--muted-2)]"> — off means your account will refuse to pay it</span>
            </CardTitle>
            {!approvals ? (
              <p className="text-xs text-[color:var(--muted-2)] py-4">Loading agents…</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {approvals.map((a) => (
                  // Row click toggles approval; div (not button) so the nested
                  // detail link stays valid HTML.
                  <div
                    key={a.serverId}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(a.serverId, !a.approved)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggle(a.serverId, !a.approved)
                      }
                    }}
                    className={cn(
                      'flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer',
                      a.approved
                        ? 'bg-[var(--surf-1)] border-[var(--line)] hover:border-[var(--line-2)]'
                        : 'bg-black/30 border-[var(--line)] opacity-55 hover:opacity-80',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs text-white truncate">
                        {a.name}
                        {a.callable && <span className="text-emerald-400/90"> ·live</span>}
                      </span>
                      <span className="block text-[10px] text-[color:var(--muted-2)]">
                        {a.category}{a.priceUsd ? ` · $${a.priceUsd}/call` : ''}
                      </span>
                    </span>
                    <Link
                      href={`/servers/${a.slug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0 p-1 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
                      title={`${a.name} — endpoints & pricing`}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                    <span
                      role="switch"
                      aria-checked={a.approved}
                      className={cn(
                        'flex-shrink-0 w-8 h-[18px] rounded-full relative transition-colors',
                        a.approved ? 'bg-emerald-500' : 'bg-white/10',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all',
                          a.approved ? 'left-[16px]' : 'left-[2px]',
                        )}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* API keys for headless agents */}
          <ApiKeysPanel onKeysChange={setKeyCount} />

          {/* Copy-paste SDK onboarding (shows once a key + grant exist) */}
          <ConnectAgentCard
            grantId={stats?.grant?.id ?? null}
            hasKeys={keyCount > 0}
            ledgerUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
          />

          {/* Activity feed */}
          <Card>
            <CardTitle>Recent activity</CardTitle>
            {!stats || stats.recent.length === 0 ? (
              <p className="text-xs text-[color:var(--muted-2)] py-4">
                No receipts yet — send a paid chat message and it'll show up here.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {stats.recent.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 py-2 text-xs">
                    {r.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-white truncate">{r.serviceName ?? r.host}</span>
                    <span className="text-[color:var(--muted-2)] truncate hidden sm:block">{r.host}</span>
                    <span className="ml-auto mono text-[color:var(--muted)] flex-shrink-0">
                      {r.ok ? `−$${r.amountUsd.toFixed(4)}` : (r.note ?? 'blocked')}
                    </span>
                    {r.txHash && (
                      <a
                        href={`https://basescan.org/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono text-[color:var(--muted-2)] hover:text-white flex-shrink-0"
                      >
                        {short(r.txHash)}
                      </a>
                    )}
                    <span className="mono text-[color:var(--muted-2)] flex-shrink-0 w-16 text-right">
                      {timeAgo(r.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ── bits ─────────────────────────────────────────────────────────────────────

function Gate({
  icon,
  title,
  body,
  cta,
  onClick,
  busy,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  onClick: () => void
  busy?: boolean
}) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
        {icon}
      </div>
      <h1 className="text-xl font-semibold text-white mb-2">{title}</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6">{body}</p>
      <button className="btn btn--solid" onClick={onClick} disabled={busy}>
        {busy ? 'One sec…' : cta}
      </button>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4', className)}>
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-white mb-3">{children}</h2>
}

function Kpi({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mono">{label}</p>
      <p className={cn('text-white font-semibold mt-1 truncate', small ? 'text-base' : 'text-2xl')}>{value}</p>
      {sub && <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5">{sub}</p>}
    </div>
  )
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

function timeAgo(iso: string): string {
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
