'use client'

// Dashboard · Growth — the go-to-market books (admin-only).
//
// Rebuilt 2026-09-18 for the links + markets era. The old Adoption page
// measured the x402 expense-account funnel (keys, settled calls, agent
// toggles, embedders); the company now earns a take rate on signed trades, so
// this page answers four questions in order:
//
//   1. How much money is moving, and from where (links · app · embeds · standing)?
//   2. What did it earn, and how does that split — Pantessa vs link creators?
//   3. Who showed up — the Coinbase accounts with their email AND the native
//      wallet connections that never signed up for anything — how far did each
//      one get, and what were they trying to do?
//   4. Is it compounding — traders coming back, creators converting, the
//      strangers' arc?
//
// /api/admin/growth + /api/admin/cohorts both enforce the allowlist
// server-side; this page mirrors the check so a non-admin sees a clean panel.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Check, Copy, Download, Footprints, Mail, ScrollText, ShieldAlert } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isAdminAddress } from '@/lib/admin'
import { formatEarnedUsd } from '@/lib/fees'
import { ACCOUNT_STAGES, GROWTH_WINDOWS, PEOPLE_FILTERS, filterPeople, peopleCounts, type AccountStage, type PeopleFilter } from '@/lib/admin-growth'
import { Card, CardTitle, SkeletonCard, SkeletonKpi, WalletKindBadge, short, timeAgo } from '@/lib/dashboard-ui'
import { FeeSplitDaily, MoneyBySource, TradersWeekly } from '@/components/LazyCharts'
import { SOURCE_LABEL, useSourceColors, type GrowthPoint } from '@/components/GrowthCharts'
import { DeskLogSection } from '@/components/DeskLogSection'
import type { DeskGrowth } from '@/lib/desk-activity'

interface FeeSplit {
  volumeUsd: number
  trades: number
  feeBearingUsd: number
  feeUsd: number
  creatorUsd: number
  pantessaUsd: number
}
interface VenueRow extends FeeSplit {
  venue: string
  effectiveBps: number | null
}
/** One person, however they arrived: an email/Google account, or a native
 *  wallet that never signed up for anything. */
interface Account {
  key: string
  email: string | null
  name: string | null
  /** 'email' | 'google' — or 'wallet' for a native connection. */
  method: string
  wallet: string | null
  wallets: string[]
  test: boolean
  createdAt: string
  lastSignInAt: string | null
  lastSeenAt: string | null
  lastTurnAt: string | null
  turns: number
  built: number
  signed: number
  usd: number
  chats: number
  links: number
  watching: number
  /** The path they tried: the last thing they asked for, walled or not. */
  lastAsk: string | null
  lastAskAt: string | null
  lastAskWalled: boolean
  stage: AccountStage
}
interface Growth {
  windowDays: number
  external: boolean
  generatedAt: string
  /** The agent desk (lib/desk-activity); null when its tables did not answer. */
  desk: DeskGrowth | null
  tiles: {
    volumeUsd: number
    volumeDelta: number | null
    volumeAllTimeUsd: number
    trades: number
    tradesDelta: number | null
    avgTradeUsd: number | null
    feeUsd: number
    feeDelta: number | null
    feeAllTimeUsd: number
    pantessaUsd: number
    creatorUsd: number
    takeRateBps: number | null
    activeTraders: number
    newTraders: number
    newTradersDelta: number | null
    tradersAllTime: number
    repeatTraders: number
    teamUsd: number
    anonymousUsd: number
    signups: number
    signupsDelta: number | null
    accountsAllTime: number
    peopleAllTime: number
    newPeople: number
    walletOnlyAllTime: number
  }
  series: GrowthPoint[]
  sources: { source: string; usd: number; trades: number }[]
  fees: {
    window: VenueRow[]
    allTime: VenueRow[]
    totals: { window: FeeSplit; allTime: FeeSplit }
    claims: { requestedUsd: number; paidUsd: number }
    creatorOwedUsd: number
  }
  weekly: { week: string; newTraders: number; returningTraders: number; usd: number }[]
  traders: {
    wallet: string
    email: string | null
    test: boolean
    usd: number
    trades: number
    usdWindow: number
    activeDays: number
    firstAt: string
    lastAt: string
    referredBy: string | null
  }[]
  creators: {
    creator: string
    handle: string | null
    brandName: string | null
    test: boolean
    links: number
    linksWindow: number
    lastMint: string
    opens: number
    connects: number
    signs: number
    referred: number
    volumeUsd: number
    trades: number
    earnedUsd: number
    claimRequestedUsd: number
    claimPaidUsd: number
    owedUsd: number
  }[]
  creatorCount: number
  linkFunnel: { opens: number; connects: number; built: number; signed: number; signers: number }
  accounts: { ok: boolean; reason: string | null; truncated: boolean; rows: Account[] }
  subscribers: { email: string; status: string; createdAt: string }[]
  alertEmails: { email: string; owner: string; alerts: number; lastAt: string }[]
  engagement: Record<string, number> | null
  topWatched: { symbol: string; n: number }[]
  topTraded: { symbol: string; n: number; usd: number }[]
  failures: { kind: string; n: number; funded: number; fundsUsd: number }[]
}

interface ArcStops {
  arrived: number
  asked: number
  built: number
  signed: number
  returned: number
}
interface Cohort {
  windowDays: number
  arc?: { total: ArcStops; bySource: ({ source: string } & ArcStops)[] }
  wallets: {
    address: string
    firstSeen: string
    surface: 'chat' | 'embed' | null
    firstChat: string | null
    firstSigned: string | null
    firstStanding: string | null
    standingKind: 'job' | 'dca' | 'guardian' | null
    firstLink: string | null
    links: number
    viaLink: boolean
    via: string | null
    moneyMovedUsd: number
    test: boolean
  }[]
}

const usd = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`
const ARC_KEYS = ['arrived', 'asked', 'built', 'signed', 'returned'] as const
const STAGE_LABEL: Record<AccountStage, string> = {
  'signed-up': 'Signed up',
  asked: 'Asked',
  built: 'Built a trade',
  traded: 'Traded',
}
/** Where each account's journey ends — the four buckets are disjoint. */
const STAGE_STOP: Record<AccountStage, string> = {
  'signed-up': 'Signed up, never asked',
  asked: 'Asked, nothing built',
  built: 'Built, never signed',
  traded: 'Traded',
}
const WHO_LABEL: Record<PeopleFilter, string> = { all: 'All', email: 'With email', wallet: 'Wallet only' }
const WHO_HELP: Record<PeopleFilter, string> = {
  all: 'Everyone who showed up — accounts and native wallet connections',
  email: 'Email + Google accounts: someone we can reach out to',
  wallet: 'MetaMask, Phantom, Coinbase Wallet and friends — no account, no email',
}
const VENUE_LABEL: Record<string, string> = {
  uniswap: 'Uniswap',
  cow: 'CoW Swap',
  lifi: 'LiFi (stocks)',
  'near-intents': 'NEAR Intents',
  hyperliquid: 'Hyperliquid',
  unattributed: 'No venue stamped',
}
const venueLabel = (v: string) => VENUE_LABEL[v] ?? v.charAt(0).toUpperCase() + v.slice(1)

function mmdd(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function csvEscape(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(name: string, head: string[], rows: (string | number | null)[][]) {
  const body = [head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  a.download = `pantessa-${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Change vs the previous window. Quiet when there's no base to compare to. */
function Delta({ value }: { value: number | null }) {
  if (value == null) return null
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] mono tabular-nums ${up ? 'text-[color:var(--accent,#34E0A1)]' : 'text-red-400'}`}
      title="vs the previous window of the same length"
    >
      <Icon className="w-3 h-3" />
      {value >= 9 ? `${Math.round(value + 1)}×` : `${Math.round(Math.abs(value) * 100)}%`}
    </span>
  )
}

function Stat({ label, value, delta, sub, lead }: { label: string; value: string; delta?: number | null; sub?: React.ReactNode; lead?: boolean }) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-4 ${lead ? 'border-[color:color-mix(in_srgb,var(--accent,#34E0A1)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent,#34E0A1)_6%,var(--surf-1))]' : 'border-[var(--line)] bg-[var(--surf-1)]'}`}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-2)] mono">{label}</p>
      <p className="flex items-baseline gap-2 mt-1 min-w-0">
        <span className="text-white font-semibold text-2xl truncate tabular-nums">{value}</span>
        <Delta value={delta ?? null} />
      </p>
      {sub && <p className="text-[11px] text-[color:var(--muted-2)] mt-0.5">{sub}</p>}
    </div>
  )
}

const TH = 'py-2 pr-3 font-medium'
const THEAD = 'text-left text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mono'
const BTN =
  'inline-flex items-center gap-1.5 text-[11px] px-3 rounded-md min-h-[32px] border border-[var(--line)] text-[color:var(--muted)] hover:text-white transition-colors disabled:opacity-40'

/** Where each dollar of fee came from and went: four bars on one scale per pair. */
function FeeWaterfall({ t, owedUsd, claims }: { t: FeeSplit; owedUsd: number; claims: { requestedUsd: number; paidUsd: number } }) {
  const feeFree = Math.max(0, t.volumeUsd - t.feeBearingUsd)
  const bar = (part: number, whole: number) => `${whole > 0 ? Math.max((part / whole) * 100, part > 0 ? 2 : 0) : 0}%`
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between text-xs mb-1.5">
          <span className="text-[color:var(--muted)]">Signed volume</span>
          <span className="text-white font-semibold tabular-nums">{usd(t.volumeUsd)}</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surf-2,rgba(255,255,255,0.04))]">
          <div style={{ width: bar(t.feeBearingUsd, t.volumeUsd), background: 'var(--accent, #34E0A1)', opacity: 0.85 }} />
        </div>
        <p className="text-[11px] text-[color:var(--muted-2)] mt-1.5">
          <span className="text-[color:var(--accent,#34E0A1)]">{usd(t.feeBearingUsd)}</span> took a fee ·{' '}
          {usd(feeFree)} rode a fee-free route (bridges, stakes, lending, sends, NFT listings, or a turn with no venue stamped)
        </p>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-xs mb-1.5">
          <span className="text-[color:var(--muted)]">Fees earned</span>
          <span className="text-white font-semibold tabular-nums">{formatEarnedUsd(t.feeUsd)}</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surf-2,rgba(255,255,255,0.04))]">
          <div style={{ width: bar(t.pantessaUsd, t.feeUsd), background: 'var(--accent, #34E0A1)', opacity: 0.85 }} />
          <div style={{ width: bar(t.creatorUsd, t.feeUsd), background: '#6AA8FF', opacity: 0.85 }} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] mono text-[color:var(--accent,#34E0A1)]">Pantessa keeps</p>
            <p className="text-white font-semibold tabular-nums">{formatEarnedUsd(t.pantessaUsd)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] mono text-[#6AA8FF]">Creators earn</p>
            <p className="text-white font-semibold tabular-nums">{formatEarnedUsd(t.creatorUsd)}</p>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-[color:var(--muted-2)] border-t border-[var(--line)] pt-3">
        Owed to creators, all time: <span className="text-white tabular-nums">{formatEarnedUsd(owedUsd)}</span> ·
        claims requested {usd(claims.requestedUsd)} · paid {usd(claims.paidUsd)}. A creator&rsquo;s half is owed on their
        own links and on every later trade by a wallet they referred; house links owe nobody.
      </p>
    </div>
  )
}

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

function StageChip({ stage }: { stage: AccountStage }) {
  const hot = stage === 'traded'
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide whitespace-nowrap ${
        hot
          ? 'bg-[color:color-mix(in_srgb,var(--accent,#34E0A1)_14%,transparent)] text-[color:var(--accent,#34E0A1)]'
          : 'bg-[var(--surf-2,rgba(255,255,255,0.05))] text-[color:var(--muted)]'
      }`}
    >
      {STAGE_LABEL[stage]}
    </span>
  )
}

export default function AdminPage() {
  const { address } = useSession()
  const [data, setData] = useState<Growth | null>(null)
  const [cohort, setCohort] = useState<Cohort | null>(null)
  const [days, setDays] = useState<(typeof GROWTH_WINDOWS)[number]>(30)
  const [external, setExternal] = useState(false)
  const [feeScope, setFeeScope] = useState<'window' | 'allTime'>('window')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [who, setWho] = useState<PeopleFilter>('all')
  const S = useSourceColors()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = `days=${days}${external ? '&external=1' : ''}`
      const [gRes, cRes] = await Promise.all([
        fetch(`/api/admin/growth?${q}`, { cache: 'no-store' }),
        fetch(`/api/admin/cohorts?${q}`, { cache: 'no-store' }),
      ])
      if (cRes.ok) setCohort(await cRes.json())
      if (gRes.ok) setData(await gRes.json())
      else {
        setData(null)
        setError(gRes.status === 403 ? 'This wallet is not an admin.' : `The growth API returned ${gRes.status}. Check the server logs.`)
      }
    } catch {
      setData(null)
      setError('Could not reach the growth API.')
    } finally {
      setLoading(false)
    }
  }, [days, external])

  useEffect(() => {
    if (isAdminAddress(address)) void load()
    else setLoading(false)
  }, [address, load])

  /** The people the filter is showing, and how far each of them got. */
  const shown = useMemo(() => filterPeople(data?.accounts.rows ?? [], who), [data, who])
  const whoCounts = useMemo(() => peopleCounts(data?.accounts.rows ?? []), [data])
  const stageCounts = useMemo(() => {
    const c: Record<AccountStage, number> = { 'signed-up': 0, asked: 0, built: 0, traded: 0 }
    for (const a of shown) c[a.stage]++
    return c
  }, [shown])

  if (address && !isAdminAddress(address)) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Not authorized</h1>
        <p className="text-sm text-[color:var(--muted)]">The growth dashboard is limited to Pantessa admins.</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-md mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Couldn’t load growth data</h1>
        <p className="text-sm text-[color:var(--muted)] mb-6">{error}</p>
        <button className="btn btn--solid" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <>
        <h1 className="dash__h1">Growth</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonKpi key={i} />
          ))}
        </div>
        <SkeletonCard className="mt-3" bodyClassName="h-64" />
        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          <SkeletonCard bodyClassName="h-48" />
          <SkeletonCard bodyClassName="h-48" />
        </div>
        <span className="sr-only" role="status">Loading growth data…</span>
      </>
    )
  }

  const t = data.tiles
  const e = data.engagement
  const w = `${data.windowDays}d`
  const accounts = shown
  const emails = accounts.map((a) => a.email).filter((x): x is string => !!x)
  const sourceTotal = data.sources.reduce((s, x) => s + x.usd, 0)
  const feeRows = data.fees[feeScope]
  const feeTotals = data.fees.totals[feeScope]
  const failTotal = data.failures.reduce((s, f) => s + f.n, 0)
  const failFunded = data.failures.reduce((s, f) => s + f.funded, 0)
  const lf = data.linkFunnel

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="dash__h1">Growth</h1>
        <div className="flex items-center gap-4 flex-wrap">
          {/* The other half of this page: not how much moved, but what each
              person did and where they stopped. */}
          <Link href="/dashboard/admin/flows" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--accent,#34E0A1)] hover:underline whitespace-nowrap">
            <Footprints className="w-3.5 h-3.5" /> User flows
          </Link>
          {/* The agent desk's own log: one row per brokered intent, its legs and receipts. */}
          <Link href="/dashboard/admin/desk" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--accent,#34E0A1)] hover:underline whitespace-nowrap">
            <ScrollText className="w-3.5 h-3.5" /> Desk log
          </Link>
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {GROWTH_WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs mono transition-colors ${
                  days === d ? 'bg-[var(--surf-1)] text-white' : 'text-[color:var(--muted)] hover:text-white'
                }`}
                aria-pressed={days === d}
              >
                {d}d
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={external}
              onChange={(ev) => setExternal(ev.target.checked)}
              className="accent-[var(--accent,#34E0A1)]"
            />
            Strangers only
          </label>
        </div>
      </div>
      <p className="text-sm text-[color:var(--muted)] mb-5">
        Real, receipt-counted money only. Harness and drill runs never count.{' '}
        {external
          ? 'Team wallets are out, and so is any trade with no wallet on it.'
          : `Of this window, ${usd(t.teamUsd)} was our own wallets${t.anonymousUsd > 0 ? ` and ${usd(t.anonymousUsd)} has no wallet on the turn` : ''}.`}
      </p>

      {/* 1 — the six numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat lead label={`Money moved · ${w}`} value={usd(t.volumeUsd)} delta={t.volumeDelta} sub={`${usd(t.volumeAllTimeUsd)} all time · ${t.trades} trades${t.avgTradeUsd != null ? ` · avg ${usd(t.avgTradeUsd)}` : ''}`} />
        <Stat label={`Fees earned · ${w}`} value={formatEarnedUsd(t.feeUsd)} delta={t.feeDelta} sub={`${formatEarnedUsd(t.feeAllTimeUsd)} all time${t.takeRateBps != null ? ` · ${t.takeRateBps.toFixed(1)} bps blended take` : ''}`} />
        <Stat
          label="The split"
          value={formatEarnedUsd(t.pantessaUsd)}
          sub={
            <>
              Pantessa keeps · creators earn <span className="text-white">{formatEarnedUsd(t.creatorUsd)}</span>
            </>
          }
        />
        <Stat label={`Active traders · ${w}`} value={String(t.activeTraders)} sub={`${t.tradersAllTime} ever · ${t.repeatTraders} traded on 2+ days`} />
        <Stat label={`First-time traders · ${w}`} value={String(t.newTraders)} delta={t.newTradersDelta} sub="wallets whose first signed trade landed in the window" />
        <Stat
          label={`New accounts · ${w}`}
          value={data.accounts.ok ? String(t.signups) : '—'}
          delta={t.signupsDelta}
          sub={data.accounts.ok ? `${t.accountsAllTime} email + Google accounts ever` : 'Coinbase did not answer'}
        />
      </div>

      {/* 2 — money, by where it came from */}
      <Card className="mt-3">
        <CardTitle eyebrow={`last ${w}`}>Money moved · by source</CardTitle>
        <MoneyBySource series={data.series} />
        <div className="flex h-2 rounded-full overflow-hidden bg-[var(--surf-2,rgba(255,255,255,0.04))] mt-4">
          {data.sources.map((s) => (
            <div key={s.source} style={{ width: `${sourceTotal > 0 ? (s.usd / sourceTotal) * 100 : 0}%`, background: S[s.source], opacity: 0.85 }} />
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {data.sources.map((s) => (
            <div key={s.source} className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: S[s.source] }} />
                <span className="truncate">{SOURCE_LABEL[s.source]}</span>
              </p>
              <p className="text-white font-semibold tabular-nums">
                {usd(s.usd)}
                <span className="text-[11px] text-[color:var(--muted-2)] font-normal ml-1.5">
                  {sourceTotal > 0 ? `${Math.round((s.usd / sourceTotal) * 100)}%` : '—'} · {s.trades}
                </span>
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[color:var(--muted-2)] mt-3">
          Bars are daily signed dollars; the line is the all-time total. <em>Links</em> = signed on an /i link.{' '}
          <em>App chat</em> = /chat, /markets and /t. <em>Standing</em> = job steps and DCA runs, money that moved after the
          first signature.
        </p>
      </Card>

      {/* 3 — the fee, and who gets it */}
      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <CardTitle eyebrow={feeScope === 'window' ? `last ${w}` : 'all time'}>Where the fee goes</CardTitle>
            <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
              {(['window', 'allTime'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFeeScope(k)}
                  aria-pressed={feeScope === k}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${feeScope === k ? 'bg-[var(--surf-2,rgba(255,255,255,0.06))] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}
                >
                  {k === 'window' ? w : 'all'}
                </button>
              ))}
            </div>
          </div>
          <FeeWaterfall t={feeTotals} owedUsd={data.fees.creatorOwedUsd} claims={data.fees.claims} />
        </Card>
        <Card>
          <CardTitle eyebrow={`last ${w}`}>Fees per day · Pantessa and creators</CardTitle>
          <FeeSplitDaily series={data.series} />
          <p className="text-[11px] text-[color:var(--muted-2)] mt-3">
            Computed from each signed trade&rsquo;s stamped fee tier. What actually landed on-chain is on{' '}
            <Link href="/dashboard/treasury" className="underline hover:text-white">
              Treasury
            </Link>
            .
          </p>
        </Card>
      </div>

      <Card className="mt-3">
        <CardTitle eyebrow={feeScope === 'window' ? `last ${w}` : 'all time'}>Volume and fees · by venue</CardTitle>
        {feeRows.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">Nothing signed in this window.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Venue</th>
                  <th className={`${TH} text-right`}>Trades</th>
                  <th className={`${TH} text-right`}>Volume</th>
                  <th className={`${TH} text-right`}>Net rate</th>
                  <th className={`${TH} text-right`}>Fees</th>
                  <th className={`${TH} text-right`}>Creators</th>
                  <th className={`${TH} text-right`}>Pantessa</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {feeRows.map((r) => (
                  <tr key={r.venue} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 text-white">{venueLabel(r.venue)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.trades}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{usd(r.volumeUsd)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.effectiveBps != null ? `${(r.effectiveBps / 100).toFixed(2)}%` : <span className="text-[color:var(--muted-2)]">no fee</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.feeUsd > 0 ? formatEarnedUsd(r.feeUsd) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.creatorUsd > 0 ? formatEarnedUsd(r.creatorUsd) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{r.pantessaUsd > 0 ? formatEarnedUsd(r.pantessaUsd) : '—'}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--line-2,var(--line))] font-medium text-white">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{feeTotals.trades}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(feeTotals.volumeUsd)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {feeTotals.feeBearingUsd > 0 ? `${((feeTotals.feeUsd / feeTotals.feeBearingUsd) * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatEarnedUsd(feeTotals.feeUsd)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatEarnedUsd(feeTotals.creatorUsd)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatEarnedUsd(feeTotals.pantessaUsd)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-[11px] text-[color:var(--muted-2)] mt-2">
              Net rate is what reaches us after the venue&rsquo;s own share (NEAR Intents keeps half of its app fee). &ldquo;No
              venue stamped&rdquo; is signed volume whose turn carries no build path. Today that is every job step, swaps
              included, so a funded buy run as a job counts as volume and books no fee even where one was charged on-chain.
              Treasury has what actually arrived.
            </p>
          </div>
        )}
      </Card>

      {/* 4 — who showed up: accounts and wallets, one list */}
      <Card className="mt-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <CardTitle eyebrow="Email + Google accounts · native wallet connections">Everyone who showed up ({accounts.length})</CardTitle>
          <div className="flex items-center gap-2">
            {/* An account is one lane in, not the only one — a native wallet
                never signs up, it just starts acting. Both are people; the
                only difference is whether there's an email to reach out on. */}
            <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
              {PEOPLE_FILTERS.map((k) => (
                <button
                  key={k}
                  onClick={() => setWho(k)}
                  aria-pressed={who === k}
                  title={WHO_HELP[k]}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${who === k ? 'bg-[var(--surf-2,rgba(255,255,255,0.06))] text-white' : 'text-[color:var(--muted)] hover:text-white'}`}
                >
                  {WHO_LABEL[k]} <span className="tabular-nums opacity-60">{whoCounts[k]}</span>
                </button>
              ))}
            </div>
            <button
              className={BTN}
              disabled={emails.length === 0}
              onClick={() => {
                void navigator.clipboard.writeText(emails.join(', ')).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy emails'}
            </button>
            <button
              className={BTN}
              disabled={accounts.length === 0}
              onClick={() =>
                downloadCsv(
                  `people-${who}`,
                  ['email', 'name', 'method', 'wallet', 'kind', 'stage', 'joined', 'last_sign_in', 'last_seen', 'asks', 'trades', 'moved_usd', 'links', 'watching', 'last_ask', 'last_ask_walled'],
                  accounts.map((a) => [a.email, a.name, a.method, a.wallet, a.test ? 'tester' : 'wild', a.stage, a.createdAt, a.lastSignInAt, a.lastSeenAt, a.turns, a.signed, a.usd, a.links, a.watching, a.lastAsk, a.lastAskWalled ? 'walled' : '']),
                )
              }
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>
        {!data.accounts.ok && (
          <p className="text-xs text-[color:var(--muted-2)] mt-2 mb-1">
            Couldn&rsquo;t read the account list from Coinbase: {data.accounts.reason} The emails live at Coinbase, not in our
            database, so only wallet connections are listed until it answers.
          </p>
        )}
        {accounts.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">
            {who === 'email' ? 'No email or Google accounts yet.' : who === 'wallet' ? 'No native wallet connections yet.' : 'Nobody has shown up yet.'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {ACCOUNT_STAGES.map((s) => (
                <div key={s} className="rounded-xl border border-[var(--line)] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] mono text-[color:var(--muted-2)]">{STAGE_STOP[s]}</p>
                  <p className="text-white font-semibold tabular-nums">
                    {stageCounts[s]}
                    <span className="text-[11px] text-[color:var(--muted-2)] font-normal ml-1.5">
                      {Math.round((stageCounts[s] / accounts.length) * 100)}%
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className={THEAD}>
                    <th className={TH}>Who</th>
                    <th className={TH}>Wallet</th>
                    <th className={TH}>Joined</th>
                    <th className={TH}>Last seen</th>
                    <th className={TH}>Got to</th>
                    <th className={`${TH} text-right`}>Asks</th>
                    <th className={`${TH} text-right`}>Trades</th>
                    <th className={`${TH} text-right`}>Moved</th>
                    <th className={`${TH} text-right`}>Reach out</th>
                  </tr>
                </thead>
                <tbody className="text-[color:var(--muted)]">
                  {accounts.map((a) => (
                    <tr key={a.key} className="border-t border-[var(--line)] align-top">
                      <td className="py-2 pr-3 text-white">
                        <span className="break-all">
                          {a.email ?? <span className="text-[color:var(--muted-2)]">wallet only — no email</span>}
                        </span>
                        <span className="ml-2 text-[10px] mono uppercase tracking-wide text-[color:var(--muted-2)]">{a.method}</span>
                        {/* The path they tried, for everyone — a trader was reaching for
                            something too, and it's the line that says what this person
                            came here to do. */}
                        {a.lastAsk && (
                          <span
                            className="block text-[11px] text-[color:var(--muted-2)] mt-0.5 max-w-[340px] truncate"
                            title={`${a.lastAskWalled ? 'Walled' : 'Asked'}${a.lastAskAt ? ` ${timeAgo(a.lastAskAt)}` : ''}: ${a.lastAsk}`}
                          >
                            {a.lastAskWalled ? 'last wall' : 'last ask'}: “{a.lastAsk}”
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">
                        {a.wallet ? (
                          <Link href={`/w/${a.wallet}`} className="hover:text-white" title={a.wallet}>
                            {short(a.wallet)}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <WalletKindBadge test={a.test} />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap" title={a.email ? 'Signed up' : 'First time we saw this wallet'}>
                        {timeAgo(a.createdAt)}
                      </td>
                      {/* An account signs in; a wallet just reappears. One column, and
                          the tooltip says which one this was. */}
                      <td
                        className="py-2 pr-3 whitespace-nowrap"
                        title={a.lastSignInAt ? 'Last sign-in' : a.lastSeenAt ? 'Last activity — a wallet never signs in' : ''}
                      >
                        {a.lastSeenAt ? timeAgo(a.lastSeenAt) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <StageChip stage={a.stage} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.turns || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{a.signed || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-white">{a.usd > 0 ? usd(a.usd) : '—'}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {a.wallet && (
                          <Link href={`/dashboard/admin/flows?wallet=${a.wallet}&days=30`} className={`${BTN} mr-1.5`} title="Everything this account did, in order">
                            <Footprints className="w-3.5 h-3.5" /> Flow
                          </Link>
                        )}
                        {a.email && (
                          <a href={`mailto:${a.email}`} className={BTN}>
                            <Mail className="w-3.5 h-3.5" /> Email
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[color:var(--muted-2)] mt-2">
              Accounts and their emails are read live from Coinbase. Wallet-only rows are native connections (MetaMask,
              Phantom, Coinbase Wallet, WalletConnect) — nobody signs up with those, so they’re everyone our own tables have
              seen act: a chat, an app set, a watchlist, a minted link, a signed turn, or a walled ask.
              {data.accounts.truncated && ' Capped at the 600 most recently seen.'}
            </p>
          </>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card>
          <CardTitle eyebrow="landing form">Waitlist emails ({data.subscribers.length})</CardTitle>
          <EmailList
            rows={data.subscribers.map((s) => ({ email: s.email, note: s.status === 'verified' ? 'verified' : 'pending', at: s.createdAt }))}
            empty="No waitlist signups yet."
          />
        </Card>
        <Card>
          <CardTitle eyebrow="gave an email for a price alert">Alert emails ({data.alertEmails.length})</CardTitle>
          <EmailList
            rows={data.alertEmails.map((a) => ({ email: a.email, note: `${a.alerts} alert${a.alerts === 1 ? '' : 's'} · ${short(a.owner)}`, at: a.lastAt }))}
            empty="Nobody has attached an email to an alert yet."
          />
        </Card>
      </div>

      {/* 5 — is it compounding */}
      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card>
          <CardTitle eyebrow="12 weeks">Traders per week · first trade vs came back</CardTitle>
          <TradersWeekly weekly={data.weekly} />
        </Card>
        <Card>
          <CardTitle eyebrow={`last ${w} · strangers' events`}>The link funnel</CardTitle>
          <div className="space-y-2.5">
            {(
              [
                ['Opened a link', lf.opens],
                ['Connected a wallet', lf.connects],
                ['Got a built trade', lf.built],
                ['Signed', lf.signed],
              ] as const
            ).map(([label, v], i, arr) => {
              const top = arr[0][1]
              const prev = i === 0 ? null : arr[i - 1][1]
              return (
                <div key={label}>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-xs text-[color:var(--muted)]">{label}</span>
                    <span className="text-sm text-white font-semibold tabular-nums">
                      {v}
                      {prev != null && prev > 0 && (
                        <span className="text-[11px] text-[color:var(--muted-2)] font-normal ml-1.5">{Math.round((v / prev) * 100)}% of the step before</span>
                      )}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[var(--surf-2,rgba(255,255,255,0.04))] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${top > 0 ? Math.max((v / top) * 100, v > 0 ? 3 : 0) : 0}%`, background: 'var(--accent, #34E0A1)', opacity: 0.85 }} />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-[color:var(--muted-2)] mt-3">
            {lf.signers} distinct wallets signed. {e ? `${e.links_win} links minted in the window; ${e.handles} creator pages claimed.` : ''}
          </p>
        </Card>
      </div>

      <Card className="mt-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle eyebrow="all time · biggest first">Traders ({t.tradersAllTime})</CardTitle>
          <button
            className={BTN}
            disabled={data.traders.length === 0}
            onClick={() =>
              downloadCsv(
                'traders',
                ['wallet', 'email', 'kind', 'moved_usd', 'trades', 'moved_usd_window', 'active_days', 'first_trade', 'last_trade', 'referred_by'],
                data.traders.map((r) => [r.wallet, r.email, r.test ? 'tester' : 'wild', r.usd, r.trades, r.usdWindow, r.activeDays, r.firstAt, r.lastAt, r.referredBy]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
        {data.traders.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">No wallet has a signed trade on record yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1 max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Wallet</th>
                  <th className={`${TH} text-right`}>Moved</th>
                  <th className={`${TH} text-right`}>{w}</th>
                  <th className={`${TH} text-right`}>Trades</th>
                  <th className={`${TH} text-right`}>Days active</th>
                  <th className={TH}>First trade</th>
                  <th className={TH}>Last trade</th>
                  <th className={TH}>Brought by</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.traders.map((r) => (
                  <tr key={r.wallet} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 mono text-white whitespace-nowrap">
                      <Link href={`/w/${r.wallet}`} className="hover:text-[color:var(--accent,#34E0A1)]" title={r.wallet}>
                        {short(r.wallet)}
                      </Link>
                      <WalletKindBadge test={r.test} />
                      {r.email && <span className="ml-2 text-[11px] font-sans text-[color:var(--muted)]">{r.email}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{usd(r.usd)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.usdWindow > 0 ? usd(r.usdWindow) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.trades}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.activeDays}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(r.firstAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{timeAgo(r.lastAt)}</td>
                    <td className="py-2 pr-3 mono text-xs">{r.referredBy ? short(r.referredBy) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <CardTitle eyebrow="all time · by volume brought in">Link creators ({data.creatorCount})</CardTitle>
        {data.creators.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">No creator has minted a link yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1 max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Creator</th>
                  <th className={`${TH} text-right`}>Links</th>
                  <th className={`${TH} text-right`}>Opens</th>
                  <th className={`${TH} text-right`}>Connects</th>
                  <th className={`${TH} text-right`}>Signs</th>
                  <th className={`${TH} text-right`}>Referred</th>
                  <th className={`${TH} text-right`}>Volume</th>
                  <th className={`${TH} text-right`}>Earned</th>
                  <th className={`${TH} text-right`}>Paid</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {data.creators.map((c) => (
                  <tr key={c.creator} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 text-white whitespace-nowrap">
                      {c.handle ? (
                        <Link href={`/l/${c.handle}`} className="hover:text-[color:var(--accent,#34E0A1)]">
                          @{c.handle}
                        </Link>
                      ) : (
                        <span className="mono">{short(c.creator)}</span>
                      )}
                      <WalletKindBadge test={c.test} />
                      {c.linksWindow > 0 && <span className="ml-2 text-[10px] mono text-[color:var(--accent,#34E0A1)]">+{c.linksWindow} this window</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.links}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.opens || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.connects || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.signs || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.referred || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{c.volumeUsd > 0 ? usd(c.volumeUsd) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.earnedUsd > 0 ? formatEarnedUsd(c.earnedUsd) : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.claimPaidUsd > 0 ? usd(c.claimPaidUsd) : c.claimRequestedUsd > 0 ? <span className="text-amber-400">{usd(c.claimRequestedUsd)} asked</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* The strangers' arc — the one table that never counts us. */}
      <Card className="mt-3">
        <CardTitle eyebrow={`last ${cohort?.windowDays ?? data.windowDays}d · strangers only, always`}>The arc · arrived → asked → built → signed → returned</CardTitle>
        {cohort?.arc ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] mt-1">
              <thead>
                <tr className="text-left text-[color:var(--muted-2)] mono text-[10.5px] uppercase tracking-wider">
                  <th className="py-1 pr-3 font-normal">source</th>
                  {ARC_KEYS.map((k) => (
                    <th key={k} className="py-1 pr-3 font-normal text-right">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohort.arc.bySource.map((r) => (
                  <tr key={r.source} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-3 text-[color:var(--muted)]">{r.source}</td>
                    {ARC_KEYS.map((k) => (
                      <td key={k} className="py-1.5 pr-3 mono text-right">{r[k]}</td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-[var(--line-2,var(--line))] font-medium">
                  <td className="py-1.5 pr-3">all strangers</td>
                  {ARC_KEYS.map((k, i) => {
                    const v = cohort.arc!.total[k]
                    const prev = i === 0 ? null : cohort.arc!.total[ARC_KEYS[i - 1]]
                    return (
                      <td key={k} className="py-1.5 pr-3 mono text-right">
                        {v}
                        {prev != null && prev > 0 && <span className="text-[color:var(--muted-2)] text-[10.5px]"> ({Math.round((v / prev) * 100)}%)</span>}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[color:var(--muted-2)] py-4">Arc data unavailable.</p>
        )}
      </Card>

      <Card className="mt-3">
        <CardTitle eyebrow={`first seen in the last ${cohort?.windowDays ?? data.windowDays}d · newest first`}>New wallets · how far each got ({cohort?.wallets.length ?? 0})</CardTitle>
        {!cohort || cohort.wallets.length === 0 ? (
          <p className="text-xs text-[color:var(--muted-2)] py-4">No {external ? 'stranger ' : ''}wallets first seen in this window.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1 max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className={THEAD}>
                  <th className={TH}>Wallet</th>
                  <th className={TH}>Arrived</th>
                  <th className={TH}>Asked</th>
                  <th className={TH}>Signed</th>
                  <th className={TH}>Standing</th>
                  <th className={TH}>Minted a link</th>
                  <th className={`${TH} text-right`}>Moved</th>
                </tr>
              </thead>
              <tbody className="text-[color:var(--muted)]">
                {cohort.wallets.map((r) => (
                  <tr key={r.address} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3 mono text-white whitespace-nowrap">
                      {short(r.address)}
                      <WalletKindBadge test={r.test} />
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {timeAgo(r.firstSeen)}
                      {(r.viaLink || r.via) && (
                        <span className="ml-2 align-middle px-1.5 py-0.5 rounded text-[10px] mono uppercase tracking-wide bg-[color:color-mix(in_srgb,var(--accent,#34E0A1)_14%,transparent)] text-[color:var(--accent,#34E0A1)]">
                          {r.viaLink ? 'via link' : 'via share'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3"><Mile at={r.firstChat} note={r.firstChat ? (r.surface ?? undefined) : undefined} /></td>
                    <td className="py-2 pr-3"><Mile at={r.firstSigned} /></td>
                    <td className="py-2 pr-3"><Mile at={r.firstStanding} note={r.standingKind ?? undefined} /></td>
                    <td className="py-2 pr-3"><Mile at={r.firstLink} note={r.links > 1 ? `×${r.links}` : undefined} /></td>
                    <td className="py-2 pr-3 text-right tabular-nums text-white">{r.moneyMovedUsd > 0 ? usd(r.moneyMovedUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 6 — the product's pulse */}
      {e && (
        <Card className="mt-3">
          <CardTitle eyebrow="totals, with this window in parentheses">What people use</CardTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
            {(
              [
                ['Asks in saved chats', e.turns_win, `${e.built_win} built trades across every surface · ${w}`],
                ['Chats started', e.chats_win, w],
                ['Watchlists', e.watchlists, `${e.watchlist_owners} people · ${e.watch_items} symbols (+${e.watchlists_win})`],
                ['Public lists', e.public_lists, 'shared at /lists'],
                ['Price alerts live', e.alerts_active, `${e.alerts_fired} fired ever (+${e.alerts_win})`],
                ['Chart posts', e.posts, `${e.comments} comments (+${e.posts_win})`],
                [`Links minted · ${w}`, e.links_win, `${e.handles} creator pages claimed`],
                ['Jobs running', e.jobs_live, `${e.jobs_done} finished`],
                ['DCA schedules', e.dca_active, 'active'],
                ['Guardians armed', e.guardians_active + e.spot_guards_active, `${e.guardians_active} Hyperliquid · ${e.spot_guards_active} spot`],
              ] as const
            ).map(([label, v, sub]) => (
              <div key={label} className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] mono text-[color:var(--muted-2)]">{label}</p>
                <p className="text-white font-semibold text-lg tabular-nums">{v}</p>
                <p className="text-[11px] text-[color:var(--muted-2)]">{sub}</p>
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-6 mt-5 pt-4 border-t border-[var(--line)]">
            <RankList title="Most watched" rows={data.topWatched.map((r) => ({ symbol: r.symbol, value: `${r.n} ${r.n === 1 ? 'person' : 'people'}`, weight: r.n }))} empty="Nobody is watching anything yet." />
            <RankList title="Most bought · all time" rows={data.topTraded.map((r) => ({ symbol: r.symbol, value: `${usd(r.usd)} · ${r.n}`, weight: r.usd }))} empty="No buy has a symbol stamped yet." />
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle eyebrow={`last ${w}`}>Money asks we didn&rsquo;t turn into a trade</CardTitle>
            <p className="text-sm text-[color:var(--muted)] -mt-1">
              <span className="text-white font-semibold tabular-nums">{failTotal}</span> walled ·{' '}
              <span className={failFunded > 0 ? 'text-amber-400 font-semibold tabular-nums' : 'tabular-nums'}>{failFunded}</span> from a wallet
              that had the money
              {data.failures.length > 0 && <> · {data.failures.map((f) => `${f.n} ${f.kind}`).join(' · ')}</>}
            </p>
          </div>
          <Link href="/dashboard/failures?funded=1" className={BTN}>
            Open the queue <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </Card>

      {/* 10 — the agent desk: what other agents asked, executed, signed. */}
      <DeskLogSection desk={data.desk ?? null} external={external} />
    </div>
  )
}

function EmailList({ rows, empty }: { rows: { email: string; note: string; at: string }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-[color:var(--muted-2)] py-4">{empty}</p>
  return (
    <ul className="max-h-[260px] overflow-y-auto -mr-2 pr-2">
      {rows.map((r) => (
        <li key={r.email} className="flex items-center justify-between gap-3 py-1.5 border-t border-[var(--line)] first:border-t-0 text-sm">
          <a href={`mailto:${r.email}`} className="text-white hover:text-[color:var(--accent,#34E0A1)] break-all min-w-0">
            {r.email}
          </a>
          <span className="text-[11px] text-[color:var(--muted-2)] whitespace-nowrap shrink-0">
            {r.note} · {timeAgo(r.at)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function RankList({ title, rows, empty }: { title: string; rows: { symbol: string; value: string; weight: number }[]; empty: string }) {
  const top = rows[0]?.weight ?? 0
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.14em] mono text-[color:var(--muted-2)] mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[color:var(--muted-2)]">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.symbol} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-sm">
              <Link href={`/t/${r.symbol}`} className="mono text-white hover:text-[color:var(--accent,#34E0A1)] truncate">
                {r.symbol}
              </Link>
              <span className="h-1.5 rounded-full bg-[var(--surf-2,rgba(255,255,255,0.04))] overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${top > 0 ? (r.weight / top) * 100 : 0}%`, background: 'var(--accent, #34E0A1)', opacity: 0.7 }} />
              </span>
              <span className="text-[11px] text-[color:var(--muted)] tabular-nums whitespace-nowrap">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
