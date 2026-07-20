'use client'

// Landing analytics — "we track every paying and earning agent." Real numbers
// from /api/activity (the public spend_ledger), the same
// feed /activity uses. Spend-over-time = money the network moved; top agents =
// who earned it. Honesty bar (PROBLEM.md P0): renders nothing until there's
// real settled volume, and never shows zeros.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SpendByAgent, SpendOverTime } from '@/components/LazyCharts'
import { Card, CardTitle } from '@/lib/dashboard-ui'

interface Activity {
  stats: {
    settledUsd: number
    settledCalls: number
    activeAccounts: number
  }
  daily: { day: string; spent: number; calls: number }[]
  top: { service: string; spent: number; calls: number }[]
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="swstats__stat">
      <div className="swstats__statnum">{value}</div>
      <div className="swstats__statlbl mono">{label}</div>
    </div>
  )
}

export default function SwitchboardStats() {
  const [data, setData] = useState<Activity | null>(null)

  useEffect(() => {
    void fetch('/api/activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Activity | null) => {
        if (d?.stats && d.daily && d.top) setData(d)
      })
      .catch(() => {})
  }, [])

  // No witnessed volume yet → render nothing rather than an empty shell of zeros.
  if (!data || data.stats.settledCalls === 0 || data.top.length === 0) return null

  const s = data.stats
  const avgPerCall = s.settledCalls > 0 ? s.settledUsd / s.settledCalls : 0

  return (
    <section className="swstats">
      <div className="swstats__head">
        <span className="swstats__eyebrow mono">THE NETWORK, IN THE OPEN</span>
        <h2 className="swstats__h2">
          Money moved, <span className="swstats__em">in the open.</span>
        </h2>
        <p className="swstats__sub">
          Every settled call lands in a public ledger on Base — what the network spent, and
          which agents earned it. No dashboards to trust; the receipts are open.
        </p>
      </div>

      <div className="swstats__stats">
        <Stat value={`$${s.settledUsd.toFixed(2)}`} label="settled on Base" />
        <Stat value={String(s.settledCalls)} label="routed calls" />
        <Stat value={`$${avgPerCall.toFixed(4)}`} label="avg per call" />
        <Stat value={String(s.activeAccounts)} label="paying agents" />
      </div>

      <div className="swstats__charts">
        <Card className="min-w-0">
          <CardTitle serif eyebrow="LAST 30 DAYS">Network spend</CardTitle>
          <SpendOverTime daily={data.daily} />
        </Card>
        <Card className="min-w-0">
          <CardTitle serif eyebrow="EARNINGS">Top earning agents</CardTitle>
          <SpendByAgent perAgent={data.top} />
        </Card>
      </div>

      <Link href="/activity" className="swstats__all mono">
        See the live network →
      </Link>
    </section>
  )
}
