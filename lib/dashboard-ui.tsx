// Shared dashboard primitives + API shapes, extracted from the old
// single-page dashboard so the sidebar-split routes can reuse them.

import Link from 'next/link'
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
    /** Master power switch — when false the spend policy is off (unrestricted). */
    spendPolicyEnabled: boolean
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

export function CardTitle({
  children,
  serif,
  eyebrow,
}: {
  children: React.ReactNode
  serif?: boolean
  /** Grey uppercase label rendered ABOVE the title — mirrors the section
   *  pattern ("WITNESSED ON BASE" over "The engine at work."). */
  eyebrow?: string
}) {
  // serif: the "nice big serif" table/section heading used on the public
  // network surfaces (/activity) so each table's title matches the page's
  // serif identity. The dense dashboard keeps the compact sans default.
  const h = (
    <h2 className={serif ? 'cardh--serif text-white' : 'text-sm font-semibold text-white'}>
      {children}
    </h2>
  )
  if (!eyebrow) return <div className="mb-3">{h}</div>
  return (
    <div className="mb-3">
      <span className="cardh__eyebrow mono">{eyebrow}</span>
      {h}
    </div>
  )
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

/**
 * Loading primitives — shimmer placeholders that mirror the shape of the
 * content they stand in for, so the dashboard reads as "filling in" rather
 * than flashing a spinner. The pulse is neutralized under
 * prefers-reduced-motion (global guard in x402-design.css).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-white/[0.06]', className)} aria-hidden />
}

/** A KPI-tile placeholder matching <Kpi/>'s box. */
export function SkeletonKpi() {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-7 w-24 mt-2.5" />
      <Skeleton className="h-2 w-16 mt-2" />
    </div>
  )
}

/** A card placeholder: a title bar + a body block (override the body height). */
export function SkeletonCard({ className, bodyClassName }: { className?: string; bodyClassName?: string }) {
  return (
    <div className={cn('rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-4', className)}>
      <Skeleton className="h-3.5 w-32 mb-4" />
      <Skeleton className={cn('w-full', bodyClassName ?? 'h-40')} />
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

/**
 * Polished empty state for dashboard surfaces — centered icon, title,
 * description, and an optional CTA. Replaces ad-hoc muted <p> placeholders so
 * empty pages read as intentional, not broken.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description: string
  cta?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5 py-10 px-4">
      {Icon && (
        <span className="w-10 h-10 mb-1 rounded-xl grid place-items-center bg-white/[0.04] border border-white/10 text-[color:var(--muted)]">
          <Icon className="w-5 h-5" />
        </span>
      )}
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="text-xs text-[color:var(--muted-2)] max-w-xs leading-relaxed">{description}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-2 inline-flex items-center text-xs font-medium px-3 py-2 rounded-lg border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white transition-colors"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
