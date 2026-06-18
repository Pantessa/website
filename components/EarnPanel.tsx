'use client'

// Dashboard · Overview → the EARN side (mirror of the spend KPIs). Aggregates
// the receipts your MCPs report via POST /api/mcp/receipts. Only renders once
// the wallet has earnings — operators with no claimed/reporting MCP don't see
// an empty block. Wallet-scoped.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardTitle, Kpi } from '@/lib/dashboard-ui'

interface Earnings {
  kpis: {
    totalEarnedUsd: number
    earned30dUsd: number
    callsServed: number
    calls30d: number
    payers: number
    topMcp: { slug: string; name: string; earnedUsd: number } | null
    mcpCount: number
  }
  byMcp: { slug: string; name: string; earnedUsd: number; earned30dUsd: number; calls: number }[]
  series30d: { date: string; usd: number }[]
}

function usd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

export default function EarnPanel() {
  const [data, setData] = useState<Earnings | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/earnings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
  }, [])

  // Nothing reported yet → stay quiet (the Payees panel already nudges claiming).
  if (!data || data.kpis.callsServed === 0) return null

  const k = data.kpis
  const peak = Math.max(...data.series30d.map((d) => d.usd), 0.0001)

  return (
    <section className="mb-6">
      <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Earn · your MCP servers
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 min-w-0">
        <Kpi label="Total earned" value={usd(k.totalEarnedUsd)} />
        <Kpi label="Earned · 30 days" value={usd(k.earned30dUsd)} />
        <Kpi
          label="Calls served"
          value={String(k.callsServed)}
          sub={k.calls30d ? `${k.calls30d} in 30 days` : undefined}
        />
        <Kpi
          label="Paying agents"
          value={String(k.payers)}
          sub={k.topMcp ? `top: ${k.topMcp.name} · ${usd(k.topMcp.earnedUsd)}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
        {/* 30-day earn sparkline (bars) — light-weight, no Recharts dependency. */}
        <Card className="min-w-0">
          <CardTitle>Earned · last 30 days</CardTitle>
          <div className="flex items-end gap-[2px] h-24 mt-3" aria-hidden>
            {data.series30d.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${usd(d.usd)}`}
                className="flex-1 rounded-t bg-emerald-400/70 min-h-[2px]"
                style={{ height: `${Math.max(2, (d.usd / peak) * 100)}%` }}
              />
            ))}
          </div>
        </Card>

        {/* Per-MCP breakdown. */}
        <Card className="min-w-0">
          <CardTitle>Earned by server</CardTitle>
          <ul className="mt-3 space-y-2">
            {data.byMcp.map((m) => (
              <li key={m.slug} className="flex items-center gap-3 min-w-0">
                <Link
                  href={`/servers/${m.slug}`}
                  className="text-xs font-medium text-white truncate min-w-0 hover:underline underline-offset-2"
                >
                  {m.name}
                </Link>
                <span className="text-[10px] mono text-[color:var(--muted-2)] flex-shrink-0">{m.calls} calls</span>
                <span className="text-xs mono text-emerald-400 flex-shrink-0 ml-auto">{usd(m.earnedUsd)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  )
}
