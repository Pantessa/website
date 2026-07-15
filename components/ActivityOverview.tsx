'use client'

// The /activity overview — the whole system's progress, public. One giant
// money-moved figure, the cumulative curve, day-by-day flow, the per-venue
// built→signed conversion board (with brand marks), the per-MCP rails table,
// and a merged recent-value feed. Data: GET /api/activity/overview (all
// aggregates + artifact labels — never prompts, never full wallets).

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ShieldOff } from 'lucide-react'
import { Card, Kpi, SkeletonCard, SkeletonKpi, timeAgo } from '@/lib/dashboard-ui'
import { DailyFlow, MoneyCurve } from '@/components/LazyCharts'
import type { FlowPoint } from '@/components/ActivityCharts'
import { ConvRing, Medallion, SectionHead } from '@/components/board-ui'

const POLL_MS = 30_000

interface VenueRow {
  venue: string
  built: number
  signed: number
  builtUsd: number
  signedUsd: number
}
interface RailRow {
  service: string
  slug: string | null
  iconSlug: string | null
  logoUrl: string | null
  free: boolean
  calls: number
  usd: number
  settleRate: number | null
  lastAt: string
}
interface RecentEvent {
  kind: 'tx' | 'x402' | 'guardian'
  label: string
  outcome: string
  chain: string | null
  venue: string | null
  usd: number | null
  link: string | null
  at: string
}
interface Overview {
  seriesDays: number
  hero: {
    systemTotalUsd: number
    signedUsd: number
    signedCount: number
    builtUsd: number
    builtCount: number
    x402Usd: number
    x402Count: number
    guardianUsd: number
    guardianCount: number
    wallets: number
    mcps: number
    freeMcps: number
  }
  series: FlowPoint[]
  venues: VenueRow[]
  rails: RailRow[]
  funnel: { turns: number; answered: number; clarify: number; txBuilt: number; signed: number; refused: number }
  recent: RecentEvent[]
}

/** What each venue key IS — label + the kind of money it moves. */
const VENUE_META: Record<string, { label: string; sub: string }> = {
  uniswap: { label: 'Uniswap', sub: 'swaps · v3 + v4' },
  cow: { label: 'CoW Protocol', sub: 'swaps · limit orders' },
  aave: { label: 'Aave', sub: 'supply · borrow · repay' },
  'near-intents': { label: 'NEAR Intents', sub: 'cross-chain swaps' },
  hyperliquid: { label: 'Hyperliquid', sub: 'perps' },
  guardian: { label: 'HL Guardian', sub: 'autonomous stop-loss / take-profit' },
  lido: { label: 'Lido', sub: 'ETH staking' },
  jobs: { label: 'Jobs API', sub: 'headless builds' },
  snapshot: { label: 'Snapshot', sub: 'DAO votes' },
  planner: { label: 'Planner-routed', sub: 'model-picked MCP tools' },
  manual: { label: 'Direct tools', sub: 'hand-called MCP tools' },
  unattributed: { label: 'Unattributed', sub: 'built before per-layer tagging' },
}

/** $1,234 above a grand, cents below — money reads at a glance either way. */
const fmtUsd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
/** Tiny x402 fees keep their precision (trailing zeros trimmed). */
const fmtFee = (n: number) =>
  n >= 1 ? fmtUsd(n) : `$${n.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`

/** Ease-out count-up for the hero figure — animates from the currently shown
 *  value to each new target (first paint AND poll updates); honors
 *  prefers-reduced-motion. */
function useCountUp(target: number, duration = 1600): number {
  const [value, setValue] = useState(0)
  const shown = useRef(0)
  useEffect(() => {
    const from = shown.current
    if (target === from) return
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown.current = target
      setValue(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3))
      shown.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

const KIND_CHIP: Record<string, { label: string; cls: string }> = {
  signed: { label: 'signed', cls: 'bg-[color:var(--accent)] text-black border-transparent font-semibold' },
  'tx-built': { label: 'built', cls: 'border-[color:var(--accent)] text-[color:var(--accent)]' },
  settled: { label: 'x402', cls: 'border-[color:var(--line-2)] text-[color:var(--muted)]' },
  executed: { label: 'auto', cls: 'border-amber-400/50 text-amber-400' },
}

export default function ActivityOverview({ header }: { header?: React.ReactNode }) {
  const [data, setData] = useState<Overview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const load = () =>
      fetch('/api/activity/overview', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: Overview) => {
          setData(d)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const total = data?.hero.systemTotalUsd ?? 0
  const counted = useCountUp(total)
  const heroFigure = total >= 1000 ? `$${Math.round(counted).toLocaleString('en-US')}` : `$${counted.toFixed(2)}`

  // ── the hero: page title left, the number right, one glow over both ──────
  const heroSection = (
    <section className="relative mb-8">
      <div
        aria-hidden
        className="absolute -inset-x-8 -top-16 -bottom-6 pointer-events-none"
        style={{
          background:
            'radial-gradient(62% 88% at 68% 38%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 72%)',
        }}
      />
      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-x-12 gap-y-10 items-center">
        <div className="min-w-0">{header}</div>
        <div className="lg:text-right px-1 pb-4 lg:pb-0">
          <p className="mono text-[11px] uppercase tracking-[0.24em] text-[color:var(--muted-2)]">
            Money moved · whole system · all time
          </p>
          {data ? (
            <div
              className="text-white tabular-nums mt-2"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'clamp(56px, 8.5vw, 118px)',
                lineHeight: 1.02,
                letterSpacing: '-0.02em',
                fontWeight: 500,
              }}
            >
              {heroFigure}
            </div>
          ) : (
            <div className="animate-pulse rounded-xl bg-white/6 h-24 w-72 mt-3 lg:ml-auto" />
          )}
          <p className="mt-3 text-[13px] text-[color:var(--muted)] max-w-[48ch] lg:ml-auto leading-relaxed">
            Swaps, lending, staking, cross-chain, perps and DAO votes — notional USD of every
            transaction signed through chat, every embed and the guardian agent, plus every x402 call
            fee settled on-chain.
          </p>
        </div>
      </div>
    </section>
  )

  if (!data) {
    return (
      <div className="flex flex-col gap-4 pb-16">
        {heroSection}
        {failed ? (
          <p className="text-sm text-[color:var(--muted)] py-16 text-center">
            Activity is unavailable right now — try a refresh.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonKpi key={i} />
              ))}
            </div>
            <SkeletonCard bodyClassName="h-64" />
          </>
        )}
      </div>
    )
  }

  const h = data.hero
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)
  const venueMaxUsd = Math.max(...data.venues.map((v) => Math.max(v.signedUsd, v.builtUsd)), 0.01)
  const railMaxCalls = Math.max(...data.rails.map((r) => r.calls), 1)

  return (
    <div className="pb-16">
      {heroSection}

      {/* ── the vitals ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-10">
        <Kpi label="Tx signed" value={String(h.signedCount)} sub={`${fmtUsd(h.signedUsd)} notional`} />
        <Kpi label="Built, awaiting sig" value={String(h.builtCount)} sub={`${fmtUsd(h.builtUsd)} notional`} />
        <Kpi label="x402 calls settled" value={String(h.x402Count)} sub={`${fmtFee(h.x402Usd)} in fees`} />
        <Kpi label="Autonomous closes" value={String(h.guardianCount)} sub={`${fmtUsd(h.guardianUsd)} · guardian agent`} />
        <Kpi label="Wallets" value={String(h.wallets)} sub="with receipts" />
        <Kpi label="MCPs on the network" value={String(h.mcps)} sub={`${h.freeMcps} free`} />
      </div>

      {/* ── the curve + day by day ─────────────────────────────────────── */}
      {data.series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-10 min-w-0">
          <Card className="lg:col-span-3 min-w-0">
            <div className="mb-1">
              <span className="cardh__eyebrow mono">THE CURVE</span>
              <h2 className="cardh--serif text-white">Money moved, cumulative</h2>
            </div>
            <MoneyCurve series={data.series} />
          </Card>
          <Card className="lg:col-span-2 min-w-0">
            <div className="mb-1">
              <span className="cardh__eyebrow mono">DAY BY DAY</span>
              <h2 className="cardh--serif text-white">Daily flow</h2>
            </div>
            <DailyFlow series={data.series} />
          </Card>
        </div>
      )}

      {/* ── where it moves: per-venue conversion board ─────────────────── */}
      <section className="mb-10">
        <SectionHead
          eyebrow="WHERE IT MOVES"
          title="Money by venue"
          sub="Every venue the transaction layer builds against — how much moved, and how many builds became signatures. The ring is the built → signed conversion."
        />
        {data.venues.length === 0 ? (
          <Card>
            <p className="text-[13px] text-[color:var(--muted-2)] py-4">
              No transactions built yet — the first venue lights up with the first build.
            </p>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-col divide-y divide-[color:var(--line)]">
              {data.venues.map((v) => {
                const meta = VENUE_META[v.venue] ?? { label: v.venue, sub: '' }
                const conv = v.built > 0 ? v.signed / v.built : null
                const usd = v.signedUsd > 0 ? v.signedUsd : v.builtUsd
                return (
                  <div key={v.venue} className="flex items-center gap-3 sm:gap-4 py-3 min-w-0">
                    <Medallion name={meta.label} keys={[v.venue === 'guardian' ? 'hyperliquid' : v.venue]} />
                    <div className="w-36 sm:w-48 flex-shrink-0 min-w-0">
                      <p className="text-white text-[14px] font-medium truncate">{meta.label}</p>
                      <p className="mono text-[10.5px] text-[color:var(--muted-2)] truncate">{meta.sub}</p>
                    </div>
                    <div className="flex-1 hidden sm:flex flex-col gap-1 min-w-0">
                      <div className="h-2.5 rounded overflow-hidden" style={{ background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}>
                        <div
                          className="h-full rounded opacity-40"
                          style={{ width: `${Math.max(v.built > 0 ? 2 : 0, Math.round((v.builtUsd / venueMaxUsd) * 100))}%`, background: 'var(--accent)' }}
                        />
                      </div>
                      <div className="h-2.5 rounded overflow-hidden" style={{ background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}>
                        <div
                          className="h-full rounded"
                          style={{ width: `${Math.max(v.signed > 0 ? 2 : 0, Math.round((v.signedUsd / venueMaxUsd) * 100))}%`, background: 'var(--accent)' }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 w-24 flex-shrink-0 justify-end">
                      {conv != null ? (
                        <>
                          <ConvRing pct={conv} />
                          <span className="mono text-[12px] tabular-nums text-[color:var(--muted)] w-9 text-right">
                            {Math.round(conv * 100)}%
                          </span>
                        </>
                      ) : (
                        <span className="mono text-[10.5px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-amber-400/50 text-amber-400">
                          auto
                        </span>
                      )}
                    </div>
                    <div className="w-28 flex-shrink-0 text-right">
                      <p className="mono text-[14px] tabular-nums text-[color:var(--accent)]">{usd > 0 ? fmtUsd(usd) : '—'}</p>
                      <p className="mono text-[10.5px] text-[color:var(--muted-2)] tabular-nums">
                        {v.built > 0 ? `${v.built} built → ${v.signed} signed` : `${v.signed} executed`}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-3">
              faint bar = built notional · solid bar = signed notional · builds priced by the guardrail layer at build time
            </p>
          </Card>
        )}
      </section>

      {/* ── funnel + rails ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10 min-w-0 items-start">
        <section className="min-w-0 flex flex-col">
          <SectionHead
            eyebrow="THE FUNNEL"
            title="Ask → built → signed"
            sub="Every chat turn across every surface, all time — how many asks become transactions, and how many transactions become signatures."
          />
          <Card>
            <div className="flex flex-col gap-2.5 mt-1">
              {[
                { label: 'Turns', n: data.funnel.turns },
                { label: 'Transactions built', n: data.funnel.txBuilt },
                { label: 'Signed', n: data.funnel.signed },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 min-w-0">
                  <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] w-40 flex-shrink-0">
                    {row.label}
                  </span>
                  <div className="flex-1 h-5 rounded-md overflow-hidden min-w-0" style={{ background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}>
                    <div
                      className="h-full rounded-md opacity-85"
                      style={{ width: `${Math.max(2, pct(row.n, data.funnel.turns))}%`, background: 'var(--accent)' }}
                    />
                  </div>
                  <span className="mono text-[12px] w-20 text-right flex-shrink-0 tabular-nums">
                    {row.n} <span className="text-[color:var(--muted-2)]">· {pct(row.n, data.funnel.turns)}%</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 mono text-[11.5px] text-[color:var(--muted-2)]">
              <span>
                <span className="text-[color:var(--accent)]">{pct(data.funnel.signed, data.funnel.txBuilt)}%</span> of built
                transactions get signed
              </span>
              <span>{data.funnel.answered} answered</span>
              <span>{data.funnel.clarify} clarified</span>
              <span>{data.funnel.refused} refused / errored</span>
            </div>
          </Card>
        </section>

        <section className="min-w-0 flex flex-col">
          <SectionHead
            eyebrow="THE RAILS"
            title="Calls by MCP"
            sub="Every MCP the router actually called — free fleet and paid x402 catalog alike — with its settle rate and fees, straight from the ledger."
          />
          <Card>
            <div className="flex flex-col divide-y divide-[color:var(--line)]">
              {data.rails.map((r) => (
                <div key={r.service} className="flex items-center gap-3 py-2.5 min-w-0 relative">
                  <div
                    aria-hidden
                    className="absolute inset-y-1 left-0 rounded-md pointer-events-none"
                    style={{
                      width: `${Math.max(2, Math.round((r.calls / railMaxCalls) * 100))}%`,
                      background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
                    }}
                  />
                  <Medallion name={r.service} keys={[r.iconSlug, r.slug]} logoUrl={r.logoUrl} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-[13px] truncate">
                      {r.service}
                      {r.free && (
                        <span className="mono text-[9.5px] uppercase tracking-wide ml-2 px-1.5 py-px rounded-full border border-[color:var(--line-2)] text-[color:var(--muted-2)]">
                          free
                        </span>
                      )}
                    </p>
                    <p className="mono text-[10.5px] text-[color:var(--muted-2)]">{timeAgo(r.lastAt)}</p>
                  </div>
                  <span className="mono text-[12px] tabular-nums text-[color:var(--muted)] flex-shrink-0 w-16 text-right">
                    {r.calls} call{r.calls === 1 ? '' : 's'}
                  </span>
                  <span className="mono text-[11px] tabular-nums text-[color:var(--muted-2)] flex-shrink-0 w-12 text-right">
                    {r.settleRate != null ? `${Math.round(r.settleRate * 100)}%` : '—'}
                  </span>
                  <span className="mono text-[12px] tabular-nums flex-shrink-0 w-16 text-right" style={{ color: r.usd > 0 ? 'var(--accent)' : 'var(--muted-2)' }}>
                    {r.usd > 0 ? fmtFee(r.usd) : 'free'}
                  </span>
                </div>
              ))}
            </div>
            <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-3">
              shaded track = call volume · % = settle rate · $ = x402 fees settled
            </p>
          </Card>
        </section>
      </div>

      {/* ── recent value events ────────────────────────────────────────── */}
      <section>
        <SectionHead
          eyebrow="THE RECEIPTS"
          title="Latest value events"
          sub="Transactions built and signed, x402 fees settled, guardian closes executed — newest first."
        />
        <Card>
          {data.recent.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)] py-4">
              Nothing yet — the first built transaction or settled call shows up here.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-[color:var(--line)]">
              {data.recent.map((e, i) => {
                const chip = KIND_CHIP[e.outcome] ?? KIND_CHIP.settled
                const venueLabel = e.venue ? VENUE_META[e.venue]?.label : null
                return (
                  <div key={i} className="flex items-center gap-3 py-2.5 text-[13px] min-w-0">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] mono uppercase tracking-wide whitespace-nowrap flex-shrink-0 ${chip.cls}`}
                    >
                      {chip.label}
                    </span>
                    <span className="text-white truncate min-w-0">{e.label}</span>
                    {venueLabel && (
                      <span className="mono text-[10.5px] text-[color:var(--muted-2)] flex-shrink-0 hidden sm:inline">
                        {venueLabel}
                      </span>
                    )}
                    {e.chain && (
                      <span className="mono text-[10.5px] text-[color:var(--muted-2)] flex-shrink-0 hidden sm:inline">
                        {e.chain}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 flex-shrink-0">
                      {e.usd != null && e.usd > 0 && (
                        <span className="mono text-[12px] tabular-nums text-[color:var(--accent)]">
                          {e.kind === 'x402' ? fmtFee(e.usd) : fmtUsd(e.usd)}
                        </span>
                      )}
                      {e.link && (
                        <a
                          href={e.link}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-[11px] text-[color:var(--muted)] inline-flex items-center gap-0.5 hover:text-white transition-colors"
                          title="View on the block explorer"
                        >
                          tx <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                      <span className="mono text-[11px] text-[color:var(--muted-2)]">{timeAgo(e.at)}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        <p className="mt-4 text-[11px] text-[color:var(--muted-2)] flex items-center gap-1.5">
          <ShieldOff className="w-3.5 h-3.5" />
          Aggregates and artifact labels only — no prompts, no wallets. Refusals are counted, never
          listed. Updates every 30s.
        </p>
      </section>
    </div>
  )
}
