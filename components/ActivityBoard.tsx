'use client'

// The live network board on /activity: stat tiles, the 30-day spend chart,
// per-service totals, and the anonymized receipt feed. Polls /api/activity
// (~30s — the API is CDN-cached at s-maxage=30, so polling faster is noise).
// All privacy filtering happens server-side; this component only renders.

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, ShieldOff } from 'lucide-react'
import { SpendByAgent, SpendOverTime } from '@/components/DashboardCharts'
import { Card, CardTitle, Kpi, short, timeAgo } from '@/lib/dashboard-ui'

const POLL_MS = 30_000

export interface NetworkActivity {
  stats: {
    settledUsd: number
    settledCalls: number
    callsToday: number
    blockedCalls: number
    activeAccounts: number
  }
  daily: { day: string; spent: number; calls: number }[]
  top: { service: string; spent: number; calls: number }[]
  recent: {
    id: string
    service: string
    host: string
    amountUsd: number
    txHash: string | null
    account: string
    createdAt: string
  }[]
}

export default function ActivityBoard() {
  const [data, setData] = useState<NetworkActivity | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/activity', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: NetworkActivity) => {
          setData(d)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    void load()
    timer.current = setInterval(load, POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-[color:var(--muted)] py-16 justify-center">
        {failed ? (
          'Activity is unavailable right now — try a refresh.'
        ) : (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading network activity…
          </>
        )}
      </div>
    )
  }

  const s = data.stats
  return (
    <div className="pb-16">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Settled" value={`$${s.settledUsd.toFixed(4)}`} sub={`${s.settledCalls} paid calls`} />
        <Kpi label="Calls today" value={String(s.callsToday)} sub="UTC day" />
        <Kpi
          label="Blocked by policy"
          value={String(s.blockedCalls)}
          sub="refused before any payment"
        />
        <Kpi label="Active accounts" value={String(s.activeAccounts)} sub="wallets with receipts" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="min-w-0">
          <CardTitle>Network spend · last 30 days</CardTitle>
          <SpendOverTime daily={data.daily} />
        </Card>
        <Card className="min-w-0">
          <CardTitle>Spend by service</CardTitle>
          <SpendByAgent perAgent={data.top} />
        </Card>
      </div>

      <Card>
        <CardTitle>Latest settled calls</CardTitle>
        {data.recent.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No payments yet — the network is young. The first settled call will show up here.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {data.recent.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs min-h-10">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-white truncate max-w-[40vw] lg:max-w-none">{r.service}</span>
                <span className="text-[color:var(--muted-2)] truncate hidden sm:block">{r.host}</span>
                <span className="mono text-[color:var(--muted-2)]">{r.account}</span>
                <span className="ml-auto mono text-[color:var(--muted)] flex-shrink-0">
                  −${r.amountUsd.toFixed(4)}
                </span>
                {r.txHash && (
                  <a
                    href={`https://basescan.org/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View the settlement on Basescan"
                    className="mono text-[color:var(--muted-2)] hover:text-white flex-shrink-0 inline-flex items-center min-h-10 -my-2.5"
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

      <p className="mt-4 text-[11px] text-[color:var(--muted-2)] flex items-center gap-1.5">
        <ShieldOff className="w-3.5 h-3.5" />
        Wallets are truncated and refusals are aggregate-only — receipts are public, identities are
        not. Updates every 30s.
      </p>
    </div>
  )
}
