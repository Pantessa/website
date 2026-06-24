'use client'

// Dashboard · Routing (B17) — observability for the sharp-routing engine:
// what it routed, what it saved, and how reliable each MCP is. Reads the
// public aggregate /api/route/metrics (no PII).

import { useEffect, useState } from 'react'
import { Card, CardTitle, Kpi } from '@/lib/dashboard-ui'

interface RouteMetrics {
  turns: number
  avgCostUsd: number
  totalSavedUsd: number
  cacheHitRate: number
  avgShortlisted: number
  blockedRate: number
  latencyMs: { p50: number; p95: number }
  services: { service: string; settled: number; failed: number; settleRate: number }[]
}

export default function DashboardRoutingPage() {
  const [m, setM] = useState<RouteMetrics | null>(null)

  useEffect(() => {
    void fetch('/api/route/metrics', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setM(d))
  }, [])

  return (
    <>
      <h1 className="dash__h1">Sharp routing</h1>
      <p className="dash__sub">
        How the engine routed across MCPs — what it picked, what it saved vs naive routing, and how reliable each
        service has been.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6 min-w-0">
        <Kpi label="Routed turns" value={String(m?.turns ?? 0)} />
        <Kpi label="Saved (vs naive)" value={`$${(m?.totalSavedUsd ?? 0).toFixed(4)}`} />
        <Kpi label="Avg cost / turn" value={`$${(m?.avgCostUsd ?? 0).toFixed(4)}`} />
        <Kpi label="Cache hit rate" value={`${Math.round((m?.cacheHitRate ?? 0) * 100)}%`} />
        <Kpi label="Latency p50 / p95" value={`${m?.latencyMs.p50 ?? 0} / ${m?.latencyMs.p95 ?? 0} ms`} small />
        <Kpi label="Avg shortlist" value={(m?.avgShortlisted ?? 0).toFixed(1)} />
      </div>

      <Card>
        <CardTitle>MCP reliability</CardTitle>
        {!m || m.services.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No routed calls yet — turn on Auto Router in chat and routing metrics show up here.
          </p>
        ) : (
          <div className="divide-y divide-white/5 mt-2">
            {m.services.map((s) => (
              <div key={s.service} className="flex items-center gap-3 py-2 text-xs min-h-10">
                <span className="text-white truncate min-w-0">{s.service}</span>
                <span className="ml-auto mono text-[color:var(--muted)] flex-shrink-0">{Math.round(s.settleRate * 100)}% settled</span>
                <span className="mono text-[color:var(--muted-2)] flex-shrink-0 w-20 text-right">{s.settled} calls</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
