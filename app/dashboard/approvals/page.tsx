'use client'

// Dashboard · Approvals — the per-agent on/off switches. A toggle re-derives
// the grant allowlist server-side (and voids a stale EIP-712 signature).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, type Approval } from '@/lib/dashboard-ui'

export default function DashboardApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null)

  useEffect(() => {
    void fetch('/api/approvals', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => a && setApprovals(a))
  }, [])

  const toggle = async (serverId: string, approved: boolean) => {
    setApprovals((prev) => prev?.map((a) => (a.serverId === serverId ? { ...a, approved } : a)) ?? prev)
    const res = await fetch('/api/approvals', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, approved }),
    })
    if (!res.ok) {
      setApprovals((prev) => prev?.map((a) => (a.serverId === serverId ? { ...a, approved: !approved } : a)) ?? prev)
    }
  }

  return (
    <>
      <h1 className="dash__h1">Agent approvals</h1>
      <p className="dash__sub">
        Off means your expense account refuses to pay that agent — toggles are enforcement, not
        décor. Approving an agent allowlists its hosts; it also voids a signed grant until you
        re-sign on the Overview.
      </p>
      <Card>
        {!approvals ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">Loading agents…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {approvals.map((a) => (
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
                  'flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer min-h-[44px] min-w-0',
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
                    {a.category}
                    {a.priceUsd ? ` · $${a.priceUsd}/call` : ''}
                  </span>
                </span>
                <Link
                  href={`/servers/${a.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-shrink-0 p-1 max-lg:p-[13px] max-lg:-my-2 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
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
    </>
  )
}
