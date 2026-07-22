'use client'

// Dashboard · Adoption — the company-wide progress view (CEO glance), now the
// MERGED Adoption + Users page (2026-07-22): one place for wallet growth,
// money flow, the link economy, the milestone funnel, and the per-wallet
// cohort journey. Admin-only; /api/admin/overview + /api/admin/cohorts both
// enforce the allowlist server-side, and this page mirrors the check
// client-side so non-admins see a clean "not authorized" panel.
//
// One "External only" toggle governs BOTH sources (cohorts ?external=1 +
// overview ?excludeOwners=1), and every wallet shown anywhere carries the
// tester-vs-wild badge — the leak-phase numbers stay honest.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Download, Mail, ShieldAlert } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress, isTestWallet } from '@/lib/admin'
import { Card, CardTitle, Kpi, SkeletonKpi, SkeletonCard, WalletKindBadge, short, timeAgo } from '@/lib/dashboard-ui'
import { ActiveWallets, LinksDaily, SpendByAgent, SpendOverTime, WalletsOverTime } from '@/components/LazyCharts'

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
  activation: { count: number; medianHours: number | null; p25Hours: number | null; p75Hours: number | null }
  cohorts: { week: string; size: number; returned: number; paid: number }[]
  recentSignups: { email: string; status: string; createdAt: string; verifiedAt: string | null }[]
  agentAdds: {
    slug: string
    name: string
    hasPage: boolean
    added: number
    removed: number
    visitors: number
    lastAt: string | null
  }[]
  embedders: {
    origin: string
    pageUrl: string | null
    turns: number
    owner: string | null
    keyed: boolean
    firstSeen: string
    lastSeen: string
  }[]
}

interface Cohort {
  windowDays: number
  external: boolean
  funnel: { key: string; label: string; value: number }[]
  moneyMovedUsd: number
  movedEvents: number
  linksMinted: number
  linkConversions: number
  linkMovedUsd: number
  linksDaily: { day: string; minted: number; convs: number; usd: number }[]
  wallets: {
    address: string
    firstSeen: string
    surface: 'chat' | 'embed' | null
    firstChat: string | null
    firstToggle: string | null
    firstSigned: string | null
    firstStanding: string | null
    standingKind: 'job' | 'dca' | 'guardian' | null
    firstLink: string | null
    links: number
    linkMovedUsd: number
    viaLink: boolean
    via: string | null
    moneyMovedUsd: number
    movedEvents: number
    embedOrigins: string[]
    test: boolean
  }[]
}

const WINDOWS = [7, 14, 30] as const

const usd = (n: number) => `$${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`

/** Human-friendly duration: hours under 2 days, else days. */
function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function weekLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—')

/** Short absolute date for a milestone cell (month/day; the window is ≤30d). */
function mmdd(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The wallet roster as a CSV a CEO can drop into a spreadsheet. */
function rosterToCsv(roster: Overview['roster']): string {
  const head = ['address', 'kind', 'first_seen', 'last_active', 'chats', 'keys', 'settled_calls', 'settled_usd', 'orgs']
  const rows = roster.map((r) => [
    r.address,
    isTestWallet(r.address) ? 'tester' : 'wild',
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

/**
 * Milestone bars — each bar is % OF THE COHORT, not step-over-step
 * conversion: milestones aren't strictly ordered (a wallet can mint a link
 * without a recorded chat turn), so step conversion would read >100% and lie.
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

const PAGE_SIZE = 25

/** Client-side pager over already-fetched rows — Prev/Next + "x–y of n". */
function usePager<T>(rows: T[], size = PAGE_SIZE) {
  const [page, setPage] = useState(0)
  // Snap back when the data shrinks under the current page (window/toggle flips).
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const cur = Math.min(page, pages - 1)
  return {
    rows: rows.slice(cur * size, (cur + 1) * size),
    cur,
    pages,
    total: rows.length,
    from: rows.length === 0 ? 0 : cur * size + 1,
    to: Math.min(rows.length, (cur + 1) * size),
    prev: () => setPage(Math.max(0, cur - 1)),
    next: () => setPage(Math.min(pages - 1, cur + 1)),
  }
}

function PagerBar({ p }: { p: ReturnType<typeof usePager<unknown>> }) {
  if (p.total <= PAGE_SIZE) return null
  return (
    <div className="flex items-center justify-between gap-3 mt-3">
      <span className="mono text-[11px] text-[color:var(--muted-2)] tabular-nums">
        {p.from}–{p.to} of {p.total}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={p.prev}
          disabled={p.cur === 0}
          className="px-3 py-1.5 text-xs mono rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 disabled:hover:text-[color:var(--muted)] transition-colors"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={p.next}
          disabled={p.cur >= p.pages - 1}
          className="px-3 py-1.5 text-xs mono rounded-lg border border-[var(--line)] text-[color:var(--muted)] hover:text-white disabled:opacity-40 disabled:hover:text-[color:var(--muted)] transition-colors"
        >
          Next →
        </button>
      </span>
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

export default function AdminPage() {
  const { address } = useSession()
  const [data, setData] = useState<Overview | null>(null)
  const [cohort, setCohort] = useState<Cohort | null>(null)
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(14)
  const [external, setExternal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Pagers ride above the early returns (hooks run every render); empty
  // arrays until the data lands.
  const cohortPager = usePager(cohort?.wallets ?? [])
  const rosterPager = usePager(data?.roster ?? [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ovRes, coRes] = await Promise.all([
        fetch(`/api/admin/overview${external ? '?excludeOwners=1' : ''}`, { cache: 'no-store' }),
        fetch(`/api/admin/cohorts?days=${days}${external ? '&external=1' : ''}`, { cache: 'no-store' }),
      ])
      if (ovRes.ok) setData(await ovRes.json())
      if (coRes.ok) setCohort(await coRes.json())
      if (!ovRes.ok && !coRes.ok) {
        setData(null)
        setCohort(null)
        setError(`The adoption APIs returned ${ovRes.status}/${coRes.status}. ${ovRes.status === 403 ? 'This wallet is not an admin.' : 'Check the server logs.'}`)
      }
    } catch {
      setData(null)
      setCohort(null)
      setError('Could not reach the adoption APIs.')
    } finally {
      setLoading(false)
    }
  }, [external, days])

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

  if (error && !data && !cohort) {
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
      <>
        <h1 className="dash__h1">Adoption</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
        <SkeletonCard className="mt-3" bodyClassName="h-48" />
        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <SkeletonCard bodyClassName="h-40" />
          <SkeletonCard bodyClassName="h-40" />
        </div>
        <span className="sr-only" role="status">Loading adoption data…</span>
      </>
    )
  }

  const t = data.tiles
  const wow = t.new7d - t.newPrev7d
  const revDaily = data.revenueDaily.map((d) => ({ day: d.day, spent: d.settled, calls: d.okCalls }))

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="dash__h1">Adoption</h1>
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
        Company-wide progress: wallet growth, money flow, and the link economy. The window picker
        scopes the cohort sections; every wallet shown carries its tester-vs-wild badge.
      </p>

      {/* North-star tiles — all-time on the left, this cohort on the right */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi
          label="Signed-in wallets"
          value={String(t.signedIn)}
          sub={`${t.new7d} new this week${wow !== 0 ? ` (${wow > 0 ? '+' : ''}${wow} WoW)` : ''}`}
        />
        <Kpi label={`New wallets · ${cohort?.windowDays ?? days}d`} value={String(cohort?.funnel[0]?.value ?? 0)} sub="first seen in the window" />
        <Kpi
          label="Links minted"
          value={String(cohort?.linksMinted ?? 0)}
          sub={`${cohort?.funnel.find((s) => s.key === 'minted')?.value ?? 0} wallets, this cohort`}
        />
        <Kpi
          label="Link conversions"
          value={String(cohort?.linkConversions ?? 0)}
          sub={`${usd(cohort?.linkMovedUsd ?? 0)} moved via links`}
        />
        <Kpi label="Money moved" value={usd(cohort?.moneyMovedUsd ?? 0)} sub={`${cohort?.movedEvents ?? 0} events, this cohort`} />
        <Kpi
          label="Settled USDC · x402"
          value={usd(t.settledUsd)}
          sub={t.declineRate != null ? `${Math.round(t.declineRate * 100)}% declined` : 'no calls yet'}
        />
      </div>

      {/* Milestone funnel — links-first key points */}
      <Card className="mt-3">
        <CardTitle>Milestone funnel · wallets reaching each step ({cohort?.windowDays ?? days}d cohort)</CardTitle>
        {cohort ? (
          <MilestoneBars steps={cohort.funnel} />
        ) : (
          <p className="text-xs text-[color:var(--muted-2)] py-4">Cohort data unavailable.</p>
        )}
      </Card>

      {/* Growth + money flow */}
      <div className="grid lg:grid-cols-2 gap-3 mt-3">
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
        <Card>
          <CardTitle>Revenue by service</CardTitle>
          <SpendByAgent perAgent={data.byService} />
        </Card>
      </div>

      {/* Per-wallet journey table (the old Users page, + the link economy) */}
      <Card className="mt-3">
        <CardTitle>Cohort · newest first ({cohort?.wallets.length ?? 0})</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          <em>chat</em> = first-party /chat; <em>embed</em> = turns under an embed key this wallet owns.
          <em> Link</em> = first intent link minted (count in parens). Moved = wallet-attributable
          notional (signed job steps + guardian closes); link $ counts separately toward the global
          number.
        </p>
        {!cohort || cohort.wallets.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No {external ? 'external ' : ''}wallets first seen in the last {cohort?.windowDays ?? days} days.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Wallet</th>
                  <th className="py-2 pr-3 font-medium">Arrived</th>
                  <th className="py-2 pr-3 font-medium">Chatted</th>
                  <th className="py-2 pr-3 font-medium">Signed</th>
                  <th className="py-2 pr-3 font-medium">Standing</th>
                  <th className="py-2 pr-3 font-medium">Link</th>
                  <th className="py-2 pr-3 font-medium text-right">Link $</th>
                  <th className="py-2 pr-3 font-medium text-right">Moved</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {cohortPager.rows.map((w) => (
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
                      {w.viaLink && (
                        <span
                          className="ml-2 align-middle px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide bg-[color:color-mix(in_srgb,var(--accent,#34E0A1)_14%,transparent)] text-[color:var(--accent,#34E0A1)]"
                          title="Connected on someone's /i intent link"
                        >
                          via link
                        </span>
                      )}
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
                      <Mile at={w.firstSigned} />
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstStanding} note={w.standingKind ?? undefined} />
                    </td>
                    <td className="py-2 pr-3">
                      <Mile at={w.firstLink} note={w.links > 1 ? `×${w.links}` : undefined} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {w.linkMovedUsd > 0 ? usd(w.linkMovedUsd) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">
                      {w.moneyMovedUsd > 0 ? usd(w.moneyMovedUsd) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PagerBar p={cohortPager} />
          </div>
        )}
      </Card>

      {/* The link economy per day — minted · conversions · $ moved. */}
      <Card className="mt-3">
        <CardTitle>Link economy · daily (30d)</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          Links minted and signed conversions (bars, left axis) with guardrail-priced dollars moved
          through links (line, right axis). Window-independent — always the last 30 days.
        </p>
        <LinksDaily daily={cohort?.linksDaily ?? []} />
      </Card>

      {/* Embedders — every site that has mounted the embedded chat. */}
      <Card className="mt-3">
        <CardTitle>Embedders · sites running the chat</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          Origins that mounted <span className="mono">/embed</span>, from the sight beacon +
          per-turn attribution. <em>Keyed</em> rows bill the owner&rsquo;s plan; anonymous rows are
          keyless embeds (origin only, referrer-policy permitting).
        </p>
        {(data.embedders?.length ?? 0) === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No embeds sighted yet. This fills in the moment a site mounts the chat.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Origin</th>
                  <th className="py-2 pr-3 font-medium">Owner</th>
                  <th className="py-2 pr-3 font-medium text-right">Turns</th>
                  <th className="py-2 pr-3 font-medium text-right">First seen</th>
                  <th className="py-2 pr-3 font-medium text-right">Last</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.embedders.map((e) => (
                  <tr key={`${e.keyed}-${e.origin}`} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 text-white">
                      <a
                        href={e.pageUrl ?? e.origin}
                        target="_blank"
                        rel="noreferrer"
                        title={e.pageUrl ?? e.origin}
                        className="hover:text-[color:var(--accent,#34E0A1)] transition-colors"
                      >
                        {e.origin.replace(/^https?:\/\//, '')}
                      </a>
                    </td>
                    <td className="py-2 pr-3 mono text-xs">
                      {e.keyed && e.owner ? (
                        <>
                          {short(e.owner)}
                          <WalletKindBadge test={isTestWallet(e.owner)} />
                        </>
                      ) : (
                        <span className="text-[color:var(--muted-2)]">anonymous</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right mono">{e.turns}</td>
                    <td className="py-2 pr-3 text-right text-xs text-[color:var(--muted-2)]">{timeAgo(e.firstSeen)}</td>
                    <td className="py-2 pr-3 text-right text-xs text-[color:var(--muted-2)]">{timeAgo(e.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Agent adoption — toggles into vs out of chat runners. */}
      <Card className="mt-3">
        <CardTitle>Agent adoption · added &amp; removed</CardTitle>
        <p className="text-xs text-[color:var(--muted-2)] mt-0.5 mb-3">
          Each time a user toggles an agent into their chat runner it counts as an <em>add</em>; toggling it back out is a{' '}
          <em>remove</em>. Guest toggles count too, so “Wallets” (distinct signed-in wallets) is a floor.
        </p>
        {data.agentAdds.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            No agent toggles recorded yet. This fills in as users add agents to their runner.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 pr-3 font-medium text-right">Added</th>
                  <th className="py-2 pr-3 font-medium text-right">Removed</th>
                  <th className="py-2 pr-3 font-medium text-right">Net</th>
                  <th className="py-2 pr-3 font-medium text-right">Wallets</th>
                  <th className="py-2 pr-3 font-medium text-right">Last</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.agentAdds.map((a) => {
                  const net = a.added - a.removed
                  return (
                    <tr key={a.slug} className="border-t border-[var(--line)]">
                      <td className="py-2 pr-3 text-white">
                        {a.hasPage ? (
                          <Link
                            href={`/servers/${a.slug}`}
                            className="inline-flex items-center gap-1 hover:text-[color:var(--accent,#34E0A1)] transition-colors"
                          >
                            {a.name}
                            <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
                          </Link>
                        ) : (
                          <span className="whitespace-nowrap">
                            {a.name}
                            <span className="ml-2 align-middle text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surf-1)] border border-[var(--line)] text-[color:var(--muted-2)]">
                              No page
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{a.added}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.removed || '—'}</td>
                      <td
                        className={`py-2 pr-3 text-right tabular-nums ${net > 0 ? 'text-[color:var(--accent,#34E0A1)]' : net < 0 ? 'text-red-400' : ''}`}
                      >
                        {net > 0 ? `+${net}` : net}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.visitors || '—'}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{a.lastAt ? timeAgo(a.lastAt) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Activation & retention */}
      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card>
          <CardTitle>Activation &amp; weekly cohorts</CardTitle>
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mono">
              Median time to first payment
            </p>
            <p className="text-2xl font-semibold text-white mt-1">{fmtHours(data.activation.medianHours)}</p>
            <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5">
              {data.activation.count} activated
              {data.activation.medianHours != null &&
                ` · p25–p75 ${fmtHours(data.activation.p25Hours)}–${fmtHours(data.activation.p75Hours)}`}
            </p>
          </div>
          {data.cohorts.length === 0 ? (
            <p className="text-xs text-[color:var(--muted-2)]">No signup cohorts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                  <th className="py-2 pr-3 font-medium">Week of</th>
                  <th className="py-2 pr-3 font-medium text-right">Signups</th>
                  <th className="py-2 pr-3 font-medium text-right">Returned</th>
                  <th className="py-2 pr-3 font-medium text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.cohorts.map((c) => (
                  <tr key={c.week} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 whitespace-nowrap mono text-white">{weekLabel(c.week)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.size}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.returned} <span className="text-[color:var(--muted-2)]">({pct(c.returned, c.size)})</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">
                      {c.paid} <span className="text-[color:var(--muted-2)]">({pct(c.paid, c.size)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Email signups — the landing "stay up to date" list, with one-click outreach */}
        <Card>
          <CardTitle>Email signups ({data.recentSignups.length})</CardTitle>
          {data.recentSignups.length === 0 ? (
            <p className="text-xs text-[color:var(--muted-2)] py-4">No email signups yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono">
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Signed up</th>
                    <th className="py-2 pr-3 font-medium text-right">Reach out</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--muted)]">
                  {data.recentSignups.map((s) => (
                    <tr key={s.email} className="border-t border-[var(--line)]">
                      <td className="py-2 pr-3 text-white break-all">{s.email}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {s.status === 'verified' ? (
                          <span className="text-[color:var(--accent,#34E0A1)]">Verified</span>
                        ) : (
                          <span className="text-[color:var(--muted-2)]">Pending</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(s.createdAt)}</td>
                      <td className="py-2 pr-3 text-right">
                        <a
                          href={`mailto:${s.email}`}
                          className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
                        >
                          <Mail className="w-3.5 h-3.5" /> Email
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              {rosterPager.rows.map((r) => (
                <tr key={r.address} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-3 mono text-white">
                    {short(r.address)}
                    <WalletKindBadge test={isTestWallet(r.address)} />
                  </td>
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
          <PagerBar p={rosterPager} />
        </div>
      </Card>

      {/* Orgs + supply context */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <Kpi label="Organizations" value={String(data.orgs.orgs)} sub={`${data.orgs.members} members`} />
        <Kpi label="Org spend" value={usd(data.orgs.org_settled)} small />
        <Kpi label="Callable services" value={String(data.supply.callable)} sub={`of ${data.supply.servers} listed`} />
        <Kpi label="Activated wallets" value={String(t.activated)} sub="minted a key or approved an agent" />
      </div>
    </>
  )
}
