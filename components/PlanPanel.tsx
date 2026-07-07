'use client'

// Dashboard · Plan — current plan, this month's YEET credit usage, recent
// credit activity, and the upgrade/manage-billing actions. Reads
// GET /api/billing/plan; upgrades go through /pricing → Stripe Checkout,
// management through the Stripe Billing Portal.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardTitle, Kpi, SkeletonCard, timeAgo } from '@/lib/dashboard-ui'
import type { PlanUsage } from '@/lib/billing'
import type { Plan } from '@/lib/plans'

interface LedgerEntry {
  id: string
  delta: number
  reason: string
  createdAt: string
}
interface PlanResponse {
  usage: PlanUsage
  ledger: LedgerEntry[]
  plans: Plan[]
  stripeConfigured: boolean
}

const REASON_LABELS: Record<string, string> = {
  'house-inference': 'House-model answer',
}

export default function PlanPanel() {
  const [data, setData] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)

  useEffect(() => {
    void fetch('/api/billing/plan')
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Failed to load plan')
        return (await r.json()) as PlanResponse
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  const openPortal = async () => {
    setPortalBusy(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (d.url) window.location.href = d.url
      else setError(d.error ?? 'Could not open the billing portal.')
    } finally {
      setPortalBusy(false)
    }
  }

  if (error) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--muted)]">{error}</p>
      </Card>
    )
  }
  if (!data) return <SkeletonCard />

  const u = data.usage
  const total = u.allowance + u.granted
  const pct = total > 0 ? Math.min(100, Math.round((u.used / total) * 100)) : 0
  const daysLeft = Math.max(0, Math.ceil((new Date(u.periodEnd).getTime() - Date.now()) / 86_400_000))
  const low = u.remaining <= Math.max(25, Math.ceil(total * 0.1))
  const isPaid = u.priceUsd > 0

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* current plan + actions */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle serif eyebrow="CURRENT PLAN">
              {u.planName}
              {isPaid && (
                <span className="mono text-[13px] text-[color:var(--muted)] ml-2">
                  ${u.priceUsd}/mo · {u.status}
                </span>
              )}
            </CardTitle>
            <p className="text-[13px] text-[color:var(--muted)] mt-1">
              {u.allowance.toLocaleString()} YEET credits each month
              {u.renewsAt ? ` · renews ${new Date(u.renewsAt).toLocaleDateString()}` : ` · resets in ${daysLeft}d`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isPaid && data.stripeConfigured && (
              <button className="btn btn--ghost !h-10 !px-4 !text-[13.5px]" onClick={() => void openPortal()} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Manage billing'}
              </button>
            )}
            <Link href="/pricing" className="btn btn--solid !h-10 !px-4 !text-[13.5px]">
              {isPaid ? 'Compare plans' : 'Upgrade'}
            </Link>
          </div>
        </div>
      </Card>

      {/* usage meter */}
      <Card>
        <CardTitle serif eyebrow="THIS MONTH">
          YEET credit usage
        </CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <Kpi label="used" value={u.used.toLocaleString()} small />
          <Kpi label="remaining" value={u.remaining.toLocaleString()} small />
          <Kpi label="allowance" value={total.toLocaleString()} sub={u.granted > 0 ? `incl. ${u.granted.toLocaleString()} granted` : undefined} small />
          <Kpi label="resets in" value={`${daysLeft}d`} small />
        </div>
        <div className="planmeter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`planmeter__fill${low ? ' planmeter__fill--low' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mono text-[11px] tracking-wider text-[color:var(--muted-2)] mt-2">
          {pct}% USED · 1 CREDIT = 1 HOUSE-MODEL ANSWER · ON-CHAIN CALLS ARE NEVER CREDITS
        </p>
        {low && (
          <p className="text-[13px] text-[color:var(--muted)] mt-2">
            Running low — <Link href="/pricing" className="underline underline-offset-2">upgrade</Link> to keep
            house-model answers flowing, or add a paid engine and continue pay-per-call.
          </p>
        )}
      </Card>

      {/* the token note + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
        <Card className="min-w-0">
          <CardTitle serif eyebrow="THE TOKEN">
            YEET, off-chain for now
          </CardTitle>
          <p className="text-[13.5px] leading-relaxed text-[color:var(--muted)] mt-2">
            Credits are ledgered off-chain today and are designed to become an <strong className="text-white font-medium">ERC-20</strong>.
            When that ships, this balance and its history move on-chain — what a credit buys doesn&rsquo;t change.
          </p>
        </Card>
        <Card className="min-w-0">
          <CardTitle serif eyebrow="RECENT">
            Credit activity
          </CardTitle>
          {data.ledger.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] mt-2">
              Nothing yet — house-model answers in chat spend the first credit.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {data.ledger.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[color:var(--line)] last:border-0 text-[13px]">
                  <span className="text-[color:var(--muted)] truncate">{REASON_LABELS[e.reason] ?? e.reason}</span>
                  <span className="mono whitespace-nowrap">
                    <span className={e.delta < 0 ? 'text-[color:var(--muted)]' : 'text-[color:var(--accent)]'}>
                      {e.delta > 0 ? `+${e.delta}` : e.delta}
                    </span>{' '}
                    <span className="text-[color:var(--muted-2)]">{timeAgo(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
