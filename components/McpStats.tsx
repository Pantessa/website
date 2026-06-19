'use client'

// Per-MCP performance on the token/service page (public). Pulls
// /api/servers/[slug]/stats — the receipts this MCP reported, scoped by slug —
// and shows settled vs total earned, calls served, active accounts, a 30-day
// usage chart, and recent settlements with their on-chain verification. Zero
// state is honest: numbers fill in as agents actually pay the MCP.

import { useEffect, useState } from 'react'
import { UsageChart } from '@/components/LazyCharts'

type Tx = {
  id: string
  amountUsd: number
  payer: string | null
  tool: string | null
  verified: boolean | null
  createdAt: string
  explorerUrl: string | null
}
type Stats = {
  kpis: { settledUsd: number; totalEarnedUsd: number; callsServed: number; activeAccounts: number; verifiedCalls: number }
  series30d: { date: string; calls: number; usd: number }[]
  transactions: Tx[]
}

function usd(n: number): string {
  if (!isFinite(n) || n <= 0) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${n.toFixed(4)}`
}
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tok__metric">
      <span className="tok__metriclbl mono">{label}</span>
      <span className="tok__metricval">{value}</span>
      {sub && <span className="tok__metricsub mono">{sub}</span>}
    </div>
  )
}

export default function McpStats({ slug }: { slug: string }) {
  const [d, setD] = useState<Stats | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/servers/${slug}/stats`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Stats) => live && setD(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [slug])

  if (!d) return null
  const k = d.kpis

  return (
    <div className="tok__card">
      <div className="tok__perfhead">
        <p className="tok__cardhead">Performance</p>
        {k.verifiedCalls > 0 && (
          <span className="tok__vbadge mono">✓ {k.verifiedCalls.toLocaleString()} on-chain verified</span>
        )}
      </div>

      <div className="tok__metrics">
        <Metric label="Settled on-chain" value={usd(k.settledUsd)} sub="verified" />
        <Metric label="Total earned" value={usd(k.totalEarnedUsd)} sub="self-reported" />
        <Metric label="Calls served" value={k.callsServed.toLocaleString()} />
        <Metric label="Active accounts" value={k.activeAccounts.toLocaleString()} />
      </div>

      <div className="tok__perfblock">
        <p className="tok__cardhead">Usage · 30 days</p>
        <UsageChart data={d.series30d} />
      </div>

      {d.transactions.length > 0 && (
        <div className="tok__perfblock">
          <p className="tok__cardhead">Verified earning transactions</p>
          <div className="tok__txs">
            {d.transactions.map((t) => (
              <div key={t.id} className="tok__tx mono">
                <span className="tok__txamt">{usd(t.amountUsd)}</span>
                <span className="tok__txmeta">
                  {t.payer ? short(t.payer) : 'unknown payer'}
                  {t.tool ? ` · ${t.tool}` : ''}
                </span>
                <span className="tok__txtime">{ago(t.createdAt)}</span>
                <span
                  className={
                    t.verified === true ? 'tok__txok' : t.verified === false ? 'tok__txflag' : 'tok__txpending'
                  }
                >
                  {t.verified === true ? '✓ verified' : t.verified === false ? '⚠ flagged' : 'pending'}
                </span>
                {t.explorerUrl ? (
                  <a className="tok__txlink" href={t.explorerUrl} target="_blank" rel="noopener noreferrer">
                    tx ↗
                  </a>
                ) : (
                  <span className="tok__txlink tok__txlink--none">no tx</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
