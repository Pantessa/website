'use client'

// The live network board on /activity: stat tiles, the 30-day spend chart,
// per-service totals, and the anonymized receipt feed. Polls /api/activity
// (~30s — the API is CDN-cached at s-maxage=30, so polling faster is noise).
// All privacy filtering happens server-side; this component only renders.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Coins, ExternalLink, Loader2, ShieldOff } from 'lucide-react'
import Link from 'next/link'
import { SpendByAgent, SpendOverTime } from '@/components/LazyCharts'
import { Card, CardTitle, Kpi, short, timeAgo } from '@/lib/dashboard-ui'
import type { LaunchpadSummary } from '@/lib/launchpad-summary'

const POLL_MS = 30_000
const FEED_PAGE_SIZE = 10

// Public aggregate routing metrics (B14) — mirrors the dashboard Routing tab so
// the engine is observable on the open page too.
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

// Token amounts span a huge range (supplies are billions; a stake can be a
// fraction). Show enough precision that a small but real stake never rounds to
// "0" — the caller renders a distinct "no stake yet" for an actual zero.
function fmtStaked(v: string): string {
  const n = Number(v)
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })
}

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
  launchpad: LaunchpadSummary | null
}

export default function ActivityBoard() {
  const [data, setData] = useState<NetworkActivity | null>(null)
  const [routing, setRouting] = useState<RouteMetrics | null>(null)
  const [failed, setFailed] = useState(false)
  const [feedPage, setFeedPage] = useState(0)
  const [openCall, setOpenCall] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sharp-routing value (B24): aggregate, public, separate from the ledger feed.
  useEffect(() => {
    void fetch('/api/route/metrics', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: RouteMetrics | null) => m && setRouting(m))
      .catch(() => {})
  }, [])

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
  const lp = data.launchpad
  const showStakerRewards = !!lp && lp.tokensLive > 0
  const pct = lp ? (lp.feeShareBps / 100).toFixed(lp.feeShareBps % 100 === 0 ? 0 : 1) : '0'
  const avgPerCall = s.settledCalls > 0 ? s.settledUsd / s.settledCalls : 0
  // Show the routing tiles once the engine has data; until then they'd all read
  // zero and just pad the grid.
  const showRouting = !!routing && routing.turns > 0
  return (
    <div className="pb-16">
      {/* Network + routing KPIs in one grid → two rows on a big screen
          (6-up at xl fits the 10–11 tiles into two clean rows). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-6">
        <Kpi label="Settled" value={`$${s.settledUsd.toFixed(4)}`} sub={`${s.settledCalls} paid calls`} />
        <Kpi label="Calls today" value={String(s.callsToday)} sub="UTC day" />
        <Kpi label="Avg per call" value={`$${avgPerCall.toFixed(4)}`} sub="settled ÷ paid calls" />
        <Kpi label="Blocked by policy" value={String(s.blockedCalls)} sub="refused before any payment" />
        <Kpi label="Active accounts" value={String(s.activeAccounts)} sub="wallets with receipts" />
        {showRouting && (
          <>
            <Kpi
              label="Routed turns"
              value={String(routing!.turns)}
              sub="ask → engine picked the MCP"
            />
            <Kpi
              label="Saved via sharp routing"
              value={`$${routing!.totalSavedUsd.toFixed(4)}`}
              sub="vs naive routing"
            />
            <Kpi label="Avg cost / turn" value={`$${routing!.avgCostUsd.toFixed(4)}`} sub="answered turn" />
            <Kpi label="Cache hit rate" value={`${Math.round(routing!.cacheHitRate * 100)}%`} sub="answers served from cache" />
            <Kpi
              label="Latency p50 / p95"
              value={`${routing!.latencyMs.p50} / ${routing!.latencyMs.p95} ms`}
              sub={`avg shortlist ${routing!.avgShortlisted.toFixed(1)}`}
              small
            />
          </>
        )}
        {showStakerRewards && (
          <Kpi
            label="Staker rewards"
            value={`$${lp!.stakerRewardsUsd.toFixed(4)}`}
            sub={`${pct}% of paid calls · ${lp!.tokensLive} token${lp!.tokensLive === 1 ? '' : 's'} live`}
          />
        )}
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

      {/* MCP reliability — mirrors the dashboard Routing tab: how often each
          service actually settles a routed call. Public aggregate, no PII. */}
      {routing && routing.services.length > 0 && (
        <Card className="mb-6">
          <CardTitle>MCP reliability</CardTitle>
          <p className="text-[11px] text-[color:var(--muted-2)] mb-3">
            Settle rate per service across routed calls — how reliably the engine got a paid answer.
          </p>
          <div className="divide-y divide-white/5">
            {routing.services.map((sv) => (
              <div key={sv.service} className="flex items-center gap-3 py-2.5 text-xs min-h-10">
                <span className="text-white truncate min-w-0">{sv.service}</span>
                <span className="ml-auto mono text-[color:var(--muted)] flex-shrink-0">
                  {Math.round(sv.settleRate * 100)}% settled
                </span>
                <span className="mono text-[color:var(--muted-2)] flex-shrink-0 w-20 text-right">
                  {sv.settled} call{sv.settled === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {lp && lp.tokens.length > 0 && (
        <Card className="mb-6">
          <CardTitle>Staked by token</CardTitle>
          <p className="text-[11px] text-[color:var(--muted-2)] mb-3">
            Each MCP token stakes on its own — amounts are per token, not summed. Stakers earn {pct}% of
            every paid call to that MCP in USDC.
          </p>
          <div className="divide-y divide-white/5">
            {lp.tokens.map((t) => (
              <div key={t.tokenAddress} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs min-h-10">
                <Coins className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <Link href={`/servers/${t.slug}`} className="text-white hover:underline truncate max-w-[40vw] lg:max-w-none">
                  {t.name}
                </Link>
                {t.symbol && <span className="mono text-[color:var(--muted-2)]">{t.symbol}</span>}
                {Number(t.totalStaked) > 0 ? (
                  <span className="ml-auto mono text-[color:var(--muted)] flex-shrink-0">
                    {fmtStaked(t.totalStaked)} staked
                  </span>
                ) : (
                  <span className="ml-auto mono text-[color:var(--muted-2)] flex-shrink-0">no stake yet</span>
                )}
                <a
                  href={`${t.explorer}/address/${t.stakingAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  title="View the staking vault on the block explorer"
                  className="text-[color:var(--muted-2)] hover:text-white flex-shrink-0 inline-flex items-center min-h-10 -my-2.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {(() => {
          const pageCount = Math.max(1, Math.ceil(data.recent.length / FEED_PAGE_SIZE))
          const page = Math.min(feedPage, pageCount - 1)
          const start = page * FEED_PAGE_SIZE
          const rows = data.recent.slice(start, start + FEED_PAGE_SIZE)
          return (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <CardTitle>Latest settled calls</CardTitle>
                {data.recent.length > FEED_PAGE_SIZE && (
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="mono text-[11px] text-[color:var(--muted-2)] tabular-nums">
                      {start + 1}–{start + rows.length} of {data.recent.length}
                    </span>
                    <button
                      onClick={() => setFeedPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      aria-label="Newer settled calls"
                      className="p-1 rounded-md border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-40 disabled:hover:text-[color:var(--muted)] disabled:hover:border-[var(--line)] transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setFeedPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page >= pageCount - 1}
                      aria-label="Older settled calls"
                      className="p-1 rounded-md border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] disabled:opacity-40 disabled:hover:text-[color:var(--muted)] disabled:hover:border-[var(--line)] transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {data.recent.length === 0 ? (
                <p className="text-xs text-[color:var(--muted-2)] py-4">
                  No payments yet — the network is young. The first settled call will show up here.
                </p>
              ) : (
                // Router-row styling (mimics the landing "Pick a need. Watch it
                // route." list): each settled call expands to reveal the paid
                // endpoint, the account, and the on-chain receipt.
                <div className="swtry__rows swtry--calls mono">
                  {rows.map((r) => {
                    const isOpen = openCall === r.id
                    return (
                      <div className={`swtry__item ${isOpen ? 'is-open' : ''}`} key={r.id}>
                        <button
                          className="swtry__row"
                          aria-expanded={isOpen}
                          onClick={() => setOpenCall(isOpen ? null : r.id)}
                        >
                          <span className="swtry__chev" aria-hidden="true">›</span>
                          <span className="swtry__route">{r.service}</span>
                          <span className="swtry__proven" title="Settled on-chain">✓ settled</span>
                          <span className="swtry__price">−${r.amountUsd.toFixed(4)}</span>
                          <span className="swtry__when">{timeAgo(r.createdAt)}</span>
                        </button>

                        {isOpen && (
                          <div className="swtry__detail">
                            <div className="swtry__call">
                              <span className="swtry__method">PAID</span>
                              <span className="swtry__url">{r.host}</span>
                            </div>
                            <div className="swtry__meta">
                              <span>{r.account}</span>
                              <span>−${r.amountUsd.toFixed(4)} · x402 · settled</span>
                              {r.txHash && (
                                <a
                                  href={`https://basescan.org/tx/${r.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="View the settlement on Basescan"
                                  className="hover:text-white transition-colors"
                                >
                                  {short(r.txHash)} ↗
                                </a>
                              )}
                              <span>{new Date(r.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )
        })()}
      </Card>

      <p className="mt-4 text-[11px] text-[color:var(--muted-2)] flex items-center gap-1.5">
        <ShieldOff className="w-3.5 h-3.5" />
        Wallets are truncated and refusals are aggregate-only — receipts are public, identities are
        not. Updates every 30s.
      </p>
    </div>
  )
}
