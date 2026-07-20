'use client'

// Dashboard · Users — recent-users progress (the leak-phase cohort view).
// Sibling of /dashboard/embeds, admin-only: /api/admin/cohorts enforces the
// allowlist server-side; this page mirrors the check client-side so
// non-admins see a clean "not authorized" panel instead of a failed fetch.
//
// One row per wallet FIRST SEEN in the window, with the journey milestones
// that matter post-pivot: first chat turn (which surface), first MCP toggle,
// first SIGNED value artifact, first standing intent (job / DCA / guardian),
// and money moved to date.

import { useCallback, useEffect, useState } from 'react'
import { Check, ShieldAlert } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { Card, CardTitle, Kpi, SkeletonKpi, SkeletonCard, WalletKindBadge, short, timeAgo } from '@/lib/dashboard-ui'

interface Cohort {
  windowDays: number
  external: boolean
  funnel: { key: string; label: string; value: number }[]
  moneyMovedUsd: number
  movedEvents: number
  wallets: {
    address: string
    firstSeen: string
    surface: 'chat' | 'embed' | null
    firstChat: string | null
    firstToggle: string | null
    firstSigned: string | null
    firstStanding: string | null
    standingKind: 'job' | 'dca' | 'guardian' | null
    via: string | null
    moneyMovedUsd: number
    movedEvents: number
    embedOrigins: string[]
    test: boolean
  }[]
}

const WINDOWS = [7, 14, 30] as const

const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`

/** Short absolute date for a milestone cell (month/day; the window is ≤30d). */
function mmdd(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/**
 * Milestone bars — like the Adoption funnel but each bar is % OF THE COHORT,
 * not step-over-step conversion: milestones aren't strictly ordered (a wallet
 * can set up a job without a recorded chat-signed tx), so step conversion
 * would read >100% and lie.
 */
function MilestoneBars({ steps }: { steps: { key: string; label: string; value: number }[] }) {
  const top = steps[0]?.value ?? 0
  if (top === 0) return <p className="text-xs text-[color:var(--muted-2)] py-4">No wallets in this window yet.</p>
  return (
    <div className="space-y-2.5">
      {steps.map((s) => (
        <div key={s.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs text-[color:var(--muted)] truncate">{s.label}</span>
            <span className="text-sm text-white font-semibold tabular-nums">
              {s.value}
              <span className="text-[11px] text-[color:var(--muted-2)] font-normal ml-1.5">
                {Math.round((s.value / top) * 100)}%
              </span>
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--surf-2,rgba(255,255,255,0.04))] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((s.value / top) * 100, s.value > 0 ? 4 : 0)}%`,
                background: 'linear-gradient(90deg, var(--accent, #34E0A1), #60A5FA)',
                opacity: 0.85,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A milestone cell: green check + the date it happened, or a quiet dash. */
function Mile({ at, note }: { at: string | null; note?: string }) {
  if (!at) return <span className="text-[color:var(--muted-2)]">—</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Check className="w-3.5 h-3.5 text-[color:var(--accent,#34E0A1)]" />
      <span className="tabular-nums">{mmdd(at)}</span>
      {note && <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">{note}</span>}
    </span>
  )
}

export default function UsersPage() {
  const { address } = useSession()
  const [data, setData] = useState<Cohort | null>(null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(14)
  const [external, setExternal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/cohorts?days=${days}${external ? '&external=1' : ''}`, { cache: 'no-store' })
      if (r.ok) setData(await r.json())
      else {
        setData(null)
        setError(`The cohorts API returned ${r.status}. ${r.status === 403 ? 'This wallet is not an admin.' : 'Check the server logs.'}`)
      }
    } catch {
      setData(null)
      setError('Could not reach the cohorts API.')
    } finally {
      setLoading(false)
    }
  }, [days, external])

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
        <p className="text-sm text-[color:var(--muted)]">The users dashboard is limited to Yeetful admins.</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Couldn’t load cohort data</h1>
        <p className="text-sm text-[color:var(--muted)] mb-6">{error}</p>
        <button className="btn btn--solid" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <>
        <h1 className="dash__h1">Users</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <SkeletonCard className="mt-3" bodyClassName="h-48" />
        <span className="sr-only" role="status">Loading cohort data…</span>
      </>
    )
  }

  const f = Object.fromEntries(data.funnel.map((s) => [s.key, s.value]))

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="dash__h1">Users</h1>
        <div className="flex items-center gap-4">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`px-3 py-1.5 text-xs mono transition-colors ${
                  days === w ? 'bg-[var(--surf-1)] text-white' : 'text-[color:var(--muted)] hover:text-white'
                }`}
                aria-pressed={days === w}
              >
                {w}d
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={external}
              onChange={(e) => setExternal(e.target.checked)}
              className="accent-[var(--accent,#34E0A1)]"
            />
            External only
          </label>
        </div>
      </div>
      <p className="text-sm text-[color:var(--muted)] mb-5">
        Every wallet first seen in the last {data.windowDays} days, and how far each got: first chat turn →
        MCP toggled → transaction signed → standing intent set up.
      </p>

      {/* Cohort tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="New wallets" value={String(f.arrived ?? 0)} sub={`last ${data.windowDays} days`} />
        <Kpi label="Signed a tx" value={String(f.signed ?? 0)} sub="signing log + job steps" />
        <Kpi label="Standing intent" value={String(f.standing ?? 0)} sub="job · DCA · guardian" />
        <Kpi label="Money moved" value={usd(data.moneyMovedUsd)} sub="job steps + guardian, this cohort" />
      </div>

      {/* Milestone funnel */}
      <Card className="mt-3">
        <CardTitle>Milestone funnel · wallets reaching each step</CardTitle>
        <MilestoneBars steps={data.funnel} />
      </Card>

      {/* Per-wallet journey table */}
      <Card className="mt-3">
        <CardTitle>Cohort · newest first ({data.wallets.length})</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          <em>chat</em> = first-party /chat; <em>embed</em> = turns under an embed key this wallet owns
          (embed visitors are anonymous by design). Moved = wallet-attributable notional (signed job
          steps + guardian closes) — anonymous first-party signs stay in the global number on{' '}
          <span className="mono">/dashboard/embeds</span>.
        </p>
        {data.wallets.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No {data.external ? 'external ' : ''}wallets first seen in the last {data.windowDays} days.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Wallet</th>
                  <th className="py-2 pr-3 font-medium">Arrived</th>
                  <th className="py-2 pr-3 font-medium">Chatted</th>
                  <th className="py-2 pr-3 font-medium">MCP</th>
                  <th className="py-2 pr-3 font-medium">Signed</th>
                  <th className="py-2 pr-3 font-medium">Standing</th>
                  <th className="py-2 pr-3 font-medium text-right">Moved</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.wallets.map((w) => (
                  <tr key={w.address} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 mono text-white whitespace-nowrap">
                      {short(w.address)}
                      <WalletKindBadge test={w.test} />
                      {w.embedOrigins.length > 0 && (
                        <span
                          className="ml-2 align-middle text-[10px] text-[color:var(--muted-2)]"
                          title={w.embedOrigins.join(', ')}
                        >
                          {w.embedOrigins[0].replace(/^https?:\/\//, '')}
                          {w.embedOrigins.length > 1 && ` +${w.embedOrigins.length - 1}`}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {timeAgo(w.firstSeen)}
                      {w.via && (
                        <span
                          className="ml-2 align-middle px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide bg-[color:color-mix(in_srgb,var(--accent,#34E0A1)_14%,transparent)] text-[color:var(--accent,#34E0A1)]"
                          title={`First sign-in carried a share link (sharer id ${w.via})`}
                        >
                          via share
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstChat} note={w.firstChat ? (w.surface ?? undefined) : undefined} />
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstToggle} />
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstSigned} />
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstStanding} note={w.standingKind ?? undefined} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">
                      {w.moneyMovedUsd > 0 ? usd(w.moneyMovedUsd) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
