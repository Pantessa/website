'use client'

// The /activity overview — the whole system's progress, public.
//
// 2026-07-28 rethink: the page used to open with a big number and then hand
// you six tables to join in your head. It now leads with the two things that
// actually explain the number — WHERE the money came from and went (the flow
// map) and WHAT the system builds that nobody else does (multi-step chains) —
// and keeps the tables underneath as the detail they always were.
//
// Data: GET /api/activity/overview (aggregates + artifact labels — never
// prompts, never full wallets; chains carry step SHAPE only).

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ShieldOff } from 'lucide-react'
import { Card, Kpi, SkeletonCard, SkeletonKpi, timeAgo } from '@/lib/dashboard-ui'
import { DailyFlow, MoneyCurve } from '@/components/LazyCharts'
import type { FlowPoint } from '@/components/ActivityCharts'
import { ConvRing, Medallion, SectionHead } from '@/components/board-ui'
import ActivityFlow, { type FlowEdge } from '@/components/ActivityFlow'
import ActivityChains, { type BuiltChain } from '@/components/ActivityChains'

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
    attendedUsd: number
    attendedCount: number
    standingUsd: number
    standingCount: number
    standing: {
      jobsUsd: number
      jobsCount: number
      guardianUsd: number
      guardianCount: number
      x402Usd: number
      x402Count: number
    }
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
  flow: FlowEdge[]
  chains: BuiltChain[]
}

/** What each venue key IS — label + the kind of money it moves. */
const VENUE_META: Record<string, { label: string; sub: string }> = {
  uniswap: { label: 'Uniswap', sub: 'swaps · v3 + v4' },
  cow: { label: 'CoW Protocol', sub: 'swaps · limit orders' },
  aave: { label: 'Aave', sub: 'supply · borrow · repay' },
  'near-intents': { label: 'NEAR Intents', sub: 'cross-chain swaps' },
  hyperliquid: { label: 'Hyperliquid', sub: 'perps' },
  guardian: { label: 'HL Guardian', sub: 'autonomous stop-loss / take-profit' },
  morpho: { label: 'Morpho', sub: 'lend · borrow · repay' },
  lido: { label: 'Lido', sub: 'ETH staking' },
  lifi: { label: 'LiFi', sub: 'tokenized-stock settlement' },
  opensea: { label: 'OpenSea', sub: 'NFT sales · transfers' },
  transfer: { label: 'Transfers', sub: 'token sends' },
  jobs: { label: 'Jobs API', sub: 'headless builds' },
  snapshot: { label: 'Snapshot', sub: 'DAO votes' },
  x402: { label: 'MCP call fees', sub: 'x402 agent calls' },
  planner: { label: 'Planner-routed', sub: 'model-picked MCP tools' },
  manual: { label: 'Direct tools', sub: 'hand-called MCP tools' },
  // Legacy rows with no build_path, plus surface-only paths (App Mode) whose
  // venue the row never recorded — see lib/build-path.ts.
  unattributed: { label: 'Unattributed', sub: 'venue not recorded' },
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

export default function ActivityOverview({
  header,
  lead,
}: {
  header?: React.ReactNode
  /** Server-rendered section slotted right under the hero (the link
   *  economy leads the page) — before the overview's own sections. */
  lead?: React.ReactNode
}) {
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

  // ── the hero ─────────────────────────────────────────────────────────────
  // Was: title parked on the left, the figure floating on the right, and a
  // paragraph of explanation right-aligned under it. Two things fighting for
  // the top of the page and neither winning. It's one centred column now, and
  // the figure IS the hero — everything else is scale around it: the claim
  // above, what the number contains below, the attended/standing split as a
  // single bar, and the tape running underneath.
  const attendedPct =
    data && data.hero.systemTotalUsd > 0
      ? Math.round((data.hero.attendedUsd / data.hero.systemTotalUsd) * 100)
      : 0
  const heroSection = (
    <section className="acthero">
      <div className="acthero__glow" aria-hidden />
      <div className="acthero__top">{header}</div>

      <div className="acthero__figure">
        <p className="acthero__eyebrow mono">Money moved · whole system · all time</p>
        {data ? (
          <div className="acthero__num">
            <span className="acthero__numtext">{heroFigure}</span>
            <span className="acthero__numglow" aria-hidden>
              {heroFigure}
            </span>
          </div>
        ) : (
          <div className="acthero__skel" />
        )}
        {data && data.hero.systemTotalUsd > 0 && (
          <div className="acthero__split">
            <span className="acthero__leg mono">
              <i className="acthero__legdot acthero__legdot--att" /> {fmtUsd(data.hero.attendedUsd)}{' '}
              attended
            </span>
            <span className="acthero__bar" aria-hidden>
              <i className="acthero__att" style={{ width: `${attendedPct}%` }} />
              <i className="acthero__std" style={{ width: `${100 - attendedPct}%` }} />
            </span>
            <span className="acthero__leg mono">
              {fmtUsd(data.hero.standingUsd)} standing{' '}
              <i className="acthero__legdot acthero__legdot--std" />
            </span>
          </div>
        )}
      </div>

      {/* The tape: the newest value events, running. A number this big needs
          something under it that is visibly still happening. */}
      {data && data.recent.length > 0 && (
        <div className="tape" aria-hidden>
          <div className="tape__track">
            {[0, 1].map((copy) => (
              <div className="tape__run" key={copy}>
                {data.recent.slice(0, 14).map((e, i) => (
                  <span className={`tape__item${e.outcome === 'signed' ? ' is-signed' : ''}`} key={`${copy}-${i}`}>
                    <i className="tape__dot" />
                    <span className="tape__label">{e.label}</span>
                    {e.usd != null && e.usd > 0 && (
                      <span className="tape__usd mono">{e.kind === 'x402' ? fmtFee(e.usd) : fmtUsd(e.usd)}</span>
                    )}
                    <span className="tape__age mono">{timeAgo(e.at)}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )

  if (!data) {
    return (
      <div className="flex flex-col gap-4 pb-16">
        {heroSection}
        {lead}
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
    <div className="actpage pb-16">
      {heroSection}

      {/* The link economy leads, right under the header — it's the surface
          the whole page is about, and the sections below explain it. */}
      {lead}

      {/* ── the flow: where it came from, where it went ───────────────────
          Head left, map right. Full-bleed the map stretched into shallow
          wires on a wide display — "too big and stretchy" — so above 1280px
          the copy takes a quarter and the drawing takes the rest. */}
      {data.flow.length > 0 && (
        <section className="flowsec">
          <div className="flowsec__copy">
            <SectionHead
              eyebrow="THE SHAPE OF THE MONEY"
              title="Where every dollar came from, and where it went"
              sub="Left: what started the ask — someone typing in chat, an intent link opening on a phone, the agent on a host's page, a standing intent firing with nobody watching. Right: the venue the transaction layer built against. Thickness is dollars, and every lane is traced end to end."
            />
          </div>
          <Card className="flowsec__card">
            <ActivityFlow edges={data.flow} total={h.systemTotalUsd} />
          </Card>
        </section>
      )}

      {/* ── chains built: the multi-step work, drawn as chains ──────────── */}
      <section>
        <SectionHead
          eyebrow="CHAINS BUILT"
          title="Almost nothing is one transaction"
          sub="Real asks compile into chains — bridge, wait for settlement, then buy; set the leverage, open the position, arm the stop. Each row is one compiled chain and what happened to each of its steps. Shape only: no titles, no wallets, nothing anyone typed."
        />
        <Card>
          <ActivityChains chains={data.chains} />
        </Card>
      </section>

      {/* ── attended vs standing: the split that matters ───────────────── */}
      <section>
        <SectionHead
          eyebrow="WHO MOVED IT"
          title="Attended vs standing"
          sub="Attended money moved because a human typed the ask and signed it. Standing money moved because something they set up earlier — a job, a schedule, the guardian, a paying agent — fired on its own."
        />
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="mono text-[10.5px] uppercase tracking-[0.2em] text-[color:var(--muted-2)]">Attended</p>
              <p className="mono text-[28px] tabular-nums text-white mt-1">{fmtUsd(h.attendedUsd)}</p>
              <p className="mono text-[11px] text-[color:var(--muted-2)] tabular-nums">
                {h.attendedCount} signatures · chat + embeds
              </p>
            </div>
            <div>
              <p className="mono text-[10.5px] uppercase tracking-[0.2em] text-[color:var(--accent)]">Standing</p>
              <p className="mono text-[28px] tabular-nums text-[color:var(--accent)] mt-1">{fmtUsd(h.standingUsd)}</p>
              <p className="mono text-[11px] text-[color:var(--muted-2)] tabular-nums">
                {h.standing.jobsCount > 0 && `${fmtUsd(h.standing.jobsUsd)} jobs + DCA · `}
                {h.standing.guardianCount > 0 && `${fmtUsd(h.standing.guardianUsd)} guardian · `}
                {fmtFee(h.standing.x402Usd)} agent call fees
              </p>
            </div>
          </div>
          {h.systemTotalUsd > 0 && (
            <div className="mt-4">
              <div className="h-2.5 rounded overflow-hidden flex" style={{ background: 'color-mix(in srgb, var(--fg) 5%, transparent)' }}>
                <div className="h-full opacity-40" style={{ width: `${pct(h.attendedUsd, h.systemTotalUsd)}%`, background: 'var(--fg)' }} />
                <div className="h-full" style={{ width: `${pct(h.standingUsd, h.systemTotalUsd)}%`, background: 'var(--accent)' }} />
              </div>
              <p className="mono text-[10.5px] text-[color:var(--muted-2)] mt-2">
                {pct(h.standingUsd, h.systemTotalUsd)}% of everything the system has moved, it moved with nobody at the keyboard.
              </p>
            </div>
          )}
        </Card>
      </section>

      {/* ── the vitals ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Tx signed" value={String(h.signedCount)} sub={`${fmtUsd(h.signedUsd)} notional`} />
        <Kpi label="Built, awaiting sig" value={String(h.builtCount)} sub={`${fmtUsd(h.builtUsd)} notional`} />
        <Kpi label="x402 calls settled" value={String(h.x402Count)} sub={`${fmtFee(h.x402Usd)} in fees`} />
        <Kpi label="Autonomous closes" value={String(h.guardianCount)} sub={`${fmtUsd(h.guardianUsd)} · guardian agent`} />
        <Kpi label="Wallets" value={String(h.wallets)} sub="with receipts" />
        <Kpi label="MCPs on the network" value={String(h.mcps)} sub={`${h.freeMcps} free`} />
      </div>

      {/* ── the curve + day by day ─────────────────────────────────────── */}
      {data.series.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-w-0">
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
      <section>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 items-start">
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
