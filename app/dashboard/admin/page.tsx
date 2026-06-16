'use client'

// Dashboard · Admin — the company-wide adoption view (CEO glance). Visible only
// to the owner/admin wallets; the layout above guarantees a signed-in session,
// /api/admin/overview enforces the allowlist server-side, and this page mirrors
// the check client-side so non-admins see a clean "not authorized" panel
// instead of a failed fetch.

import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, ShieldAlert } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { Card, CardTitle, Kpi, short, timeAgo } from '@/lib/dashboard-ui'
import { SpendByAgent, SpendOverTime } from '@/components/DashboardCharts'
import { ActiveWallets, Funnel, WalletsOverTime } from '@/components/AdminCharts'

interface Overview {
  excludeOwners: boolean
  tiles: {
    signedIn: number
    new7d: number
    newPrev7d: number
    activated: number
    paid: number
    settledUsd: number
    paidCalls: number
    declineRate: number | null
  }
  funnel: { key: string; label: string; value: number }[]
  newWalletsDaily: { day: string; n: number }[]
  activeWalletsDaily: { day: string; n: number }[]
  revenueDaily: { day: string; settled: number; okCalls: number; declined: number; blocked: number }[]
  byService: { service: string; spent: number; calls: number }[]
  roster: {
    address: string
    firstSeen: string
    lastActive: string
    chats: number
    keys: number
    settled: number
    okCalls: number
    orgs: number
  }[]
  orgs: { orgs: number; members: number; org_settled: number }
  supply: { callable: number; servers: number }
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The wallet roster as a CSV a CEO can drop into a spreadsheet. */
function rosterToCsv(roster: Overview['roster']): string {
  const head = ['address', 'first_seen', 'last_active', 'chats', 'keys', 'settled_calls', 'settled_usd', 'orgs']
  const rows = roster.map((r) => [
    r.address,
    r.firstSeen,
    r.lastActive,
    r.chats,
    r.keys,
    r.okCalls,
    r.settled.toFixed(6),
    r.orgs,
  ])
  return [head, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}

export default function AdminPage() {
  const { address } = useSession()
  const [data, setData] = useState<Overview | null>(null)
  const [excludeOwners, setExcludeOwners] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/overview${excludeOwners ? '?excludeOwners=1' : ''}`, { cache: 'no-store' })
      if (r.ok) setData(await r.json())
      else {
        setData(null)
        setError(`The adoption API returned ${r.status}. ${r.status === 403 ? 'This wallet is not an admin.' : 'Check the server logs.'}`)
      }
    } catch {
      setData(null)
      setError('Could not reach the adoption API.')
    } finally {
      setLoading(false)
    }
  }, [excludeOwners])

  useEffect(() => {
    if (isAdminAddress(address)) void load()
    else setLoading(false)
  }, [address, load])

  if (address && !isAdminAddress(address)) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">The adoption dashboard is limited to Yeetful admins.</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Couldn’t load adoption data</h1>
        <p className="text-sm text-[color:var(--muted)] mb-6">{error}</p>
        <button className="btn btn--solid" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-[color:var(--muted)] py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading adoption data…
      </div>
    )
  }

  const t = data.tiles
  const wow = t.new7d - t.newPrev7d
  const revDaily = data.revenueDaily.map((d) => ({ day: d.day, spent: d.settled, calls: d.okCalls }))

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="dash__h1">Adoption</h1>
        <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeOwners}
            onChange={(e) => setExcludeOwners(e.target.checked)}
            className="accent-[var(--accent,#34E0A1)]"
          />
          Exclude owner wallets
        </label>
      </div>
      <p className="text-sm text-[color:var(--muted)] mb-5">
        Company-wide. A “user” is a distinct wallet that has signed in and acted; pre-sign-in connects aren’t recorded.
      </p>

      {/* North-star tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Signed-in wallets"
          value={String(t.signedIn)}
          sub={`${t.new7d} new this week${wow !== 0 ? ` (${wow > 0 ? '+' : ''}${wow} WoW)` : ''}`}
        />
        <Kpi label="Activated" value={String(t.activated)} sub="minted a key or approved an agent" />
        <Kpi label="Paid wallets" value={String(t.paid)} sub={`${t.paidCalls} settled calls`} />
        <Kpi
          label="Settled USDC"
          value={usd(t.settledUsd)}
          sub={t.declineRate != null ? `${Math.round(t.declineRate * 100)}% declined` : 'no calls yet'}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card>
          <CardTitle>Onboarding funnel</CardTitle>
          <Funnel steps={data.funnel} />
        </Card>
        <Card>
          <CardTitle>New wallets (60d)</CardTitle>
          <WalletsOverTime daily={data.newWalletsDaily} />
        </Card>
        <Card>
          <CardTitle>Active wallets (30d)</CardTitle>
          <ActiveWallets daily={data.activeWalletsDaily} />
        </Card>
        <Card>
          <CardTitle>Settled USDC (30d)</CardTitle>
          <SpendOverTime daily={revDaily} />
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Revenue by service</CardTitle>
          <SpendByAgent perAgent={data.byService} />
        </Card>
      </div>

      {/* Wallet roster */}
      <Card className="mt-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <CardTitle>Wallets ({data.roster.length})</CardTitle>
          <button
            className="flex items-center gap-1.5 text-[11px] px-3 rounded-md min-h-[36px] bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
            onClick={() => {
              const blob = new Blob([rosterToCsv(data.roster)], { type: 'text/csv;charset=utf-8' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `yeetful-wallets-${new Date().toISOString().slice(0, 10)}.csv`
              a.click()
              URL.revokeObjectURL(a.href)
            }}
            disabled={data.roster.length === 0}
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                <th className="py-2 pr-3 font-medium">Wallet</th>
                <th className="py-2 pr-3 font-medium">First seen</th>
                <th className="py-2 pr-3 font-medium">Last active</th>
                <th className="py-2 pr-3 font-medium text-right">Chats</th>
                <th className="py-2 pr-3 font-medium text-right">Keys</th>
                <th className="py-2 pr-3 font-medium text-right">Calls</th>
                <th className="py-2 pr-3 font-medium text-right">Settled</th>
                <th className="py-2 pr-3 font-medium text-right">Orgs</th>
              </tr>
            </thead>
            <tbody className="text-[color:var(--muted)]">
              {data.roster.map((r) => (
                <tr key={r.address} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-3 mono text-white">{short(r.address)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(r.firstSeen)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(r.lastActive)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.chats}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.keys}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.okCalls}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-white">{usd(r.settled)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.orgs || '—'}</td>
                </tr>
              ))}
              {data.roster.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-[color:var(--muted-2)]">
                    No wallets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Orgs + supply context */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <Kpi label="Organizations" value={String(data.orgs.orgs)} sub={`${data.orgs.members} members`} />
        <Kpi label="Org spend" value={usd(data.orgs.org_settled)} small />
        <Kpi label="Callable services" value={String(data.supply.callable)} sub={`of ${data.supply.servers} listed`} />
        <Kpi label="Repeat users" value={String(data.funnel.find((f) => f.key === 'repeat')?.value ?? 0)} sub="≥2 paid calls" />
      </div>
    </>
  )
}
