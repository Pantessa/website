'use client'

// Dashboard · Activity — the receipt ledger feed.

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Card, short, timeAgo, type Stats } from '@/lib/dashboard-ui'

export default function DashboardActivityPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void fetch('/api/dashboard/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStats(s))
  }, [])

  return (
    <>
      <h1 className="dash__h1">Activity</h1>
      <p className="dash__sub">Every authorization decision under your grant — settlements and refusals alike.</p>
      <Card>
        {!stats || stats.recent.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No receipts yet — send a paid chat message and it&apos;ll show up here.
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
  )
}
