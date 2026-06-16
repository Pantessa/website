// Shared dashboard primitives + API shapes, extracted from the old
// single-page dashboard so the sidebar-split routes can reuse them.

import { cn } from '@/lib/utils'

export interface Stats {
  grant: {
    id: string
    label: string
    perCallUsd: number
    perDayUsd: number
    allowCount: number
    expiresAt: string
    paused: boolean
    /** True when a Coinbase Spend Permission caps this account on-chain. */
    backedOnChain: boolean
    spendPermissionNetwork: string | null
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
  /** Connected agents (a key IS an agent): count + top key by settled spend today. */
  agents: {
    connected: number
    topToday: { label: string; spentTodayUsd: number } | null
  }
  /** Present when the stats are org-scoped (?org=): the org level of the
   *  two-level budget — daily cap across ALL the org's keys. */
  org: {
    id: string
    name: string
    role: 'owner' | 'admin' | 'member'
    perDayUsd: number | null
    spentTodayUsd: number
    remainingTodayUsd: number | null
    overBudget: boolean
  } | null
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

export interface Approval {
  serverId: string
  slug: string
  name: string
  category: string
  callable: boolean
  priceUsd: string | null
  approved: boolean
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-white mb-3">{children}</h2>
}

export function Kpi({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    // min-w-0: a long value (agent slug) must truncate inside the 2-col
    // phone grid instead of flooring its 1fr track wider than the viewport.
    <div className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mono">{label}</p>
      <p className={cn('text-white font-semibold mt-1 truncate', small ? 'text-base' : 'text-2xl')}>{value}</p>
      {sub && <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5">{sub}</p>}
    </div>
  )
}

export function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

export function timeAgo(iso: string): string {
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
