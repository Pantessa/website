'use client'

// Dashboard · Treasury — what Pantessa has actually collected. Admin-only:
// /api/admin/treasury enforces the allowlist server-side; this page mirrors
// the check client-side for a clean "not authorized" panel.
//
// Headline lane = ON-CHAIN inflow to the treasury address (swap fees arrive
// as their own transfer step in the sell token and are persisted nowhere in
// the DB — the chain is the only honest ledger). Secondary lane = x402
// settlements against Pantessa-owned services (the attributable DB view of a
// subset of that same money — the lanes are never summed). Every payer is
// badged tester (yellow) vs wild (green).

import { useCallback, useEffect, useState } from 'react'
import { Landmark, ShieldAlert } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { Card, CardTitle, Kpi, SkeletonKpi, SkeletonCard, WalletKindBadge, short, timeAgo } from '@/lib/dashboard-ui'
import { FeeCurve, FeeDaily } from '@/components/LazyCharts'
import type { FeePoint } from '@/components/TreasuryCharts'

interface Treasury {
  windowDays: number
  treasury: string
  onchain: {
    enabled: boolean
    allTimeUsd: number
    windowUsd: number
    wildWindowUsd: number
    transfers: number
    unpriced: number
    payers: number
    wildPayers: number
    daily: FeePoint[]
    byAsset: { key: string; usd: number; n: number }[]
    byChain: { key: string; usd: number; n: number }[]
    recent: {
      at: string
      chain: string
      asset: string
      amount: number
      usd: number | null
      from: string
      test: boolean
      explorerUrl: string
    }[]
  }
  x402: {
    allTimeUsd: number
    windowUsd: number
    allTimeCalls: number
    windowCalls: number
    recent: { at: string; service: string; usd: number; wallet: string | null; test: boolean; txHash: string | null }[]
  }
}

const WINDOWS = [30, 90] as const

const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`

const amt = (n: number) =>
  n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 4 : 6 })

export default function TreasuryPage() {
  const { address } = useSession()
  const [data, setData] = useState<Treasury | null>(null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/treasury?days=${days}`, { cache: 'no-store' })
      if (r.ok) setData(await r.json())
      else {
        setData(null)
        setError(`The treasury API returned ${r.status}. ${r.status === 403 ? 'This wallet is not an admin.' : 'Check the server logs.'}`)
      }
    } catch {
      setData(null)
      setError('Could not reach the treasury API.')
    } finally {
      setLoading(false)
    }
  }, [days])

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
        <p className="text-sm text-[color:var(--muted)]">The treasury dashboard is limited to Pantessa admins.</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Couldn’t load treasury data</h1>
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
        <h1 className="dash__h1">Treasury</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <SkeletonCard className="mt-3" bodyClassName="h-64" />
        <span className="sr-only" role="status">Loading treasury data…</span>
      </>
    )
  }

  const oc = data.onchain
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="dash__h1">Treasury</h1>
        <div className="flex items-center gap-4">
          <a
            className="mono text-xs text-[color:var(--muted)] hover:text-white transition-colors"
            href={`https://basescan.org/address/${data.treasury}`}
            target="_blank"
            rel="noreferrer"
            title={data.treasury}
          >
            {short(data.treasury)}
          </a>
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
        </div>
      </div>
      <p className="text-sm text-[color:var(--muted)] mb-5">
        Fees actually collected — on-chain transfers into the treasury (swap fees + x402 settlements),
        split <span style={{ color: 'var(--accent, #34E0A1)' }}>wild</span> vs{' '}
        <span style={{ color: '#EAB308' }}>tester</span> so our own dogfooding never reads as revenue.
      </p>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Collected, all time" value={usd(oc.allTimeUsd)} sub={`on-chain · ${oc.transfers} transfers`} />
        <Kpi label={`Last ${data.windowDays} days`} value={usd(oc.windowUsd)} sub="on-chain inflow" />
        <Kpi label="From the wild" value={usd(oc.wildWindowUsd)} sub={`last ${data.windowDays}d · ${oc.wildPayers} wild payers all time`} />
        <Kpi label="x402 settled" value={usd(data.x402.allTimeUsd)} sub={`${data.x402.allTimeCalls} paid calls · ledger view`} />
      </div>

      {!oc.enabled && (
        <Card className="mt-3">
          <p className="text-sm text-[color:var(--muted)]">
            ALCHEMY_API_KEY is not set, so the on-chain inflow lane is dark — only the x402 ledger below is
            populated. Set the key on Vercel to light up the ground-truth view.
          </p>
        </Card>
      )}

      {/* Trend charts */}
      {oc.enabled && (
        <>
          <Card className="mt-3">
            <CardTitle>Fees accumulated · cumulative</CardTitle>
            <FeeCurve series={oc.daily} />
          </Card>
          <Card className="mt-3">
            <CardTitle>Daily inflow · tester vs wild</CardTitle>
            <FeeDaily series={oc.daily} />
          </Card>
        </>
      )}

      {/* Where it comes from */}
      {oc.enabled && (oc.byAsset.length > 0 || oc.byChain.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <Card>
            <CardTitle>By asset</CardTitle>
            <BreakdownRows rows={oc.byAsset} />
          </Card>
          <Card>
            <CardTitle>By chain</CardTitle>
            <BreakdownRows rows={oc.byChain} />
          </Card>
        </div>
      )}

      {/* Recent inflow transactions */}
      {oc.enabled && (
        <Card className="mt-3">
          <CardTitle>Recent inflow · on-chain ({oc.recent.length})</CardTitle>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
            Every transfer into the treasury, newest first. Swap fees arrive in the sell token; x402
            settlements arrive as USDC.
            {oc.unpriced > 0 && ` ${oc.unpriced} transfer${oc.unpriced === 1 ? '' : 's'} in a token we don't price — shown, but outside the USD totals.`}
          </p>
          {oc.recent.length === 0 ? (
            <p className="text-xs text-[color:var(--muted-2)] py-4">Nothing has reached the treasury yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                    <th className="py-2 pr-3 font-medium">From</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Chain</th>
                    <th className="py-2 pr-3 font-medium text-right">Amount</th>
                    <th className="py-2 pr-3 font-medium text-right">USD</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--muted)]">
                  {oc.recent.map((t) => (
                    <tr key={`${t.explorerUrl}:${t.from}:${t.asset}`} className="border-t border-[var(--line)]">
                      <td className="py-2 pr-3 mono text-white whitespace-nowrap">
                        {short(t.from)}
                        <WalletKindBadge test={t.test} />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <a className="hover:text-white transition-colors" href={t.explorerUrl} target="_blank" rel="noreferrer">
                          {timeAgo(t.at)}
                        </a>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{t.chain}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {amt(t.amount)} <span className="text-[color:var(--muted-2)]">{t.asset}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{t.usd === null ? '—' : usd(t.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* x402 ledger lane */}
      <Card className="mt-3">
        <CardTitle>x402 settlements · Pantessa services ({data.x402.recent.length})</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          Settled paid calls against *.yeetful.com services, attributed via the payer’s spend grant. The
          same money is visible on-chain above — this is the who-paid-for-what view, not a second total.
        </p>
        {data.x402.recent.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">No settled x402 calls against Pantessa services yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Payer</th>
                  <th className="py-2 pr-3 font-medium">Service</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.x402.recent.map((r, i) => (
                  <tr key={`${r.at}:${i}`} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 mono text-white whitespace-nowrap">
                      {r.wallet ? (
                        <>
                          {short(r.wallet)}
                          <WalletKindBadge test={r.test} />
                        </>
                      ) : (
                        'org'
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.service}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(r.at)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{usd(r.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-[color:var(--muted-2)] flex items-center gap-1.5">
        <Landmark className="w-3.5 h-3.5" />
        Swap fees are 0.20% of input, taken as a visible transfer step on LiFi-venue swaps (lib/fees.ts).
      </p>
    </>
  )
}

/** Compact asset/chain breakdown rows with a proportional bar. */
function BreakdownRows({ rows }: { rows: { key: string; usd: number; n: number }[] }) {
  const top = rows[0]?.usd ?? 0
  if (rows.length === 0) return <p className="text-xs text-[color:var(--muted-2)] py-4">Nothing priced yet.</p>
  return (
    <div className="space-y-2.5">
      {rows.slice(0, 8).map((r) => (
        <div key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs text-[color:var(--muted)] truncate">
              {r.key} <span className="text-[color:var(--muted-2)]">· {r.n}×</span>
            </span>
            <span className="text-sm text-white font-semibold tabular-nums">{usd(r.usd)}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surf-2,rgba(255,255,255,0.04))] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${top > 0 ? Math.max((r.usd / top) * 100, r.usd > 0 ? 4 : 0) : 0}%`,
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
