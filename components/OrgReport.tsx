'use client'

// The expense report card on /dashboard/org — org spend over a range, broken
// down per agent / per member / per service, with a CSV download built
// client-side from the same payload. OrgReportView is presentational so the
// visual harness can render it with mock data.

import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Card, CardTitle, short } from '@/lib/dashboard-ui'

export interface OrgReportData {
  org: { id: string; name: string; slug: string }
  range: { from: string; to: string }
  totals: { spentUsd: number; calls: number; deniedCalls: number }
  perAgent: { keyId: string | null; label: string; prefix: string | null; mintedBy: string | null; spentUsd: number; calls: number }[]
  perMember: { address: string; spentUsd: number; calls: number; agents: string[] }[]
  perService: { service: string; spentUsd: number; calls: number; denied: number }[]
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const

function fmt(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One CSV, three sections, machine-friendly: section,name,detail,spent_usd,calls */
export function reportToCsv(r: OrgReportData): string {
  const rows: (string | number)[][] = [['section', 'name', 'detail', 'spent_usd', 'calls']]
  for (const a of r.perAgent) rows.push(['agent', a.label, a.mintedBy ?? '', a.spentUsd.toFixed(6), a.calls])
  for (const m of r.perMember) rows.push(['member', m.address, m.agents.join(' · '), m.spentUsd.toFixed(6), m.calls])
  for (const s of r.perService) rows.push(['service', s.service, `${s.denied} denied`, s.spentUsd.toFixed(6), s.calls])
  rows.push(['total', r.org.name, `${r.range.from.slice(0, 10)}..${r.range.to.slice(0, 10)}`, r.totals.spentUsd.toFixed(6), r.totals.calls])
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

export function OrgReportView({
  data,
  days,
  onDays,
  loading,
}: {
  data: OrgReportData | null
  days: number
  onDays: (d: number) => void
  loading: boolean
}) {
  const download = () => {
    if (!data) return
    const blob = new Blob([reportToCsv(data)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${data.org.slug}-expense-report-${data.range.from.slice(0, 10)}-${data.range.to.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <CardTitle>Expense report</CardTitle>
        <div className="flex items-center gap-1 ml-auto">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`mono text-[11px] px-2.5 rounded-md min-h-[40px] transition-colors ${
                days === r.days ? 'bg-[var(--surf-2)] text-white' : 'text-[color:var(--muted-2)] hover:text-white'
              }`}
              onClick={() => onDays(r.days)}
            >
              {r.label}
            </button>
          ))}
          <button
            className="flex items-center gap-1.5 text-[11px] px-3 rounded-md min-h-[40px] bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-colors ml-1"
            onClick={download}
            disabled={!data}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {loading || !data ? (
        <p className="text-xs text-[color:var(--muted-2)] py-4">Building the report…</p>
      ) : (
        <>
          <p className="text-xs text-[color:var(--muted-2)] mb-3 mono">
            {fmt(data.totals.spentUsd)} settled · {data.totals.calls} calls · {data.totals.deniedCalls} denied ·{' '}
            {data.range.from.slice(0, 10)} → {data.range.to.slice(0, 10)}
          </p>

          {data.totals.calls === 0 && data.totals.deniedCalls === 0 ? (
            <div className="flex items-start gap-2.5 text-[color:var(--muted-2)]">
              <FileSpreadsheet className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                Nothing in this range yet. Spend lands here as the org&apos;s agents settle calls —
                each receipt attributed to the key that paid.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Breakdown
                title="By agent"
                rows={data.perAgent.map((a) => ({
                  name: a.label,
                  sub: a.prefix ? `${a.prefix}…` : null,
                  spent: a.spentUsd,
                  calls: a.calls,
                }))}
              />
              <Breakdown
                title="By member"
                rows={data.perMember.map((m) => ({
                  name: m.address === 'unattributed' ? 'unattributed' : short(m.address),
                  sub: m.agents.length ? `minted ${m.agents.length} agent${m.agents.length === 1 ? '' : 's'}` : null,
                  spent: m.spentUsd,
                  calls: m.calls,
                }))}
              />
              <Breakdown
                title="By service"
                rows={data.perService.map((s) => ({
                  name: s.service,
                  sub: s.denied ? `${s.denied} denied` : null,
                  spent: s.spentUsd,
                  calls: s.calls,
                }))}
              />
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Breakdown({
  title,
  rows,
}: {
  title: string
  rows: { name: string; sub: string | null; spent: number; calls: number }[]
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[color:var(--muted-2)]">—</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 8).map((r, i) => (
            <li key={i} className="flex items-baseline gap-2 min-w-0">
              <span className="text-xs text-white truncate min-w-0" title={r.name}>
                {r.name}
              </span>
              {r.sub && <span className="text-[10px] text-[color:var(--muted-2)] truncate hidden sm:inline">{r.sub}</span>}
              <span className="mono text-[11px] text-[color:var(--muted)] ml-auto flex-shrink-0">
                {fmt(r.spent)} · {r.calls}
              </span>
            </li>
          ))}
          {rows.length > 8 && (
            <li className="text-[10px] text-[color:var(--muted-2)]">+{rows.length - 8} more — full list in the CSV</li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Fetching wrapper used by /dashboard/org. */
export default function OrgReport({ orgId }: { orgId: string }) {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<OrgReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    fetch(`/api/orgs/${orgId}/report?from=${from}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [orgId, days])

  return <OrgReportView data={data} days={days} onDays={setDays} loading={loading} />
}
