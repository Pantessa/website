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
    verifiedEarnedUsd: number
    verifiedCalls: number
    flaggedCalls: number
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

  // Still loading or the endpoint errored → stay quiet (avoid a flash).
  if (!data) return null

  const k = data.kpis

  // Nothing reported yet → show the empty earn surface (mirror of the empty
  // spend KPIs) plus a nudge to connect MCPs, instead of hiding the whole
  // section. An operator should always see where their earnings will land.
  if (k.callsServed === 0) {
    return (
      <section className="mb-6">
        <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
          Earn · your MCP servers
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 min-w-0">
          <Kpi label="Total earned" value="$0.00" sub="no calls served yet" />
          <Kpi label="Earned · 30 days" value="$0.00" />
          <Kpi label="Calls served" value="0" />
          <Kpi label="Paying agents" value="0" />
        </div>
        <Card>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Connect your MCPs to start earning</p>
              <p className="text-xs text-[color:var(--muted-2)] mt-0.5 max-w-md">
                Run an MCP server? Report each paid call with one async SDK line and your
                earnings — total, last 30 days, calls served, paying agents — land right here.
              </p>
            </div>
            <Link
              href="/docs/earn"
              className="flex items-center gap-1.5 flex-shrink-0 text-xs font-medium px-3 py-2 max-lg:min-h-10 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              Connect your MCPs →
            </Link>
          </div>
        </Card>
      </section>
    )
  }

  const peak = Math.max(...data.series30d.map((d) => d.usd), 0.0001)

  return (
    <section className="mb-6">
      <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Earn · your MCP servers
      </h2>

      {/* Honesty line: reported numbers are self-reported telemetry; the trust
          layer is how much we confirmed against an on-chain settlement. */}
      <p className="text-[11px] text-[color:var(--muted-2)] mb-2">
        Self-reported by your MCPs · <span className="text-emerald-400">{usd(k.verifiedEarnedUsd)} verified on-chain</span>
        {k.flaggedCalls > 0 && (
          <span className="text-amber-400"> · {k.flaggedCalls} report{k.flaggedCalls === 1 ? '' : 's'} not backed by a settlement tx</span>
        )}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 min-w-0">
        <Kpi
          label="Total earned"
          value={usd(k.totalEarnedUsd)}
          sub={k.verifiedCalls ? `${usd(k.verifiedEarnedUsd)} on-chain verified` : 'unverified'}
        />
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
