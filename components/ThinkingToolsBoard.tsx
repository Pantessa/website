'use client'

import { useEffect, useMemo, useState } from 'react'
import { Terminal, TrendingUp, Wrench } from 'lucide-react'
import type { RouterTraceEvent } from '@/lib/store'
import { TraceLine } from '@/components/RouteTraceTerminal'
import {
  THINKING_TOOLS,
  toolIdForTraceEvent,
  toolById,
  EVAL_HISTORY,
  EVAL_ANSWERED_AT_FULL,
  EMPTY_TOOLS_STATS,
  type ToolsStats,
} from '@/lib/thinking-tools'

/**
 * /tools — the thinking tools, visualized. Three panels off one public stats
 * endpoint: the toolbox (each yeetful-tool-* with live usage), the decision
 * anatomy of the last real turn, and the self-updating progress strip. Polls
 * /api/tools/stats; local dev and prod share one Neon DB, so turns routed
 * anywhere show up here.
 */

const POLL_MS = 15_000

export default function ThinkingToolsBoard() {
  const [stats, setStats] = useState<ToolsStats>(EMPTY_TOOLS_STATS)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const res = await fetch('/api/tools/stats', { cache: 'no-store' })
        if (res.ok) {
          setStats((await res.json()) as ToolsStats)
          setLive(true)
        }
      } catch {
        setLive(false)
      }
      if (!stop) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className="space-y-14 mb-16">
      <KpiStrip stats={stats} live={live} />
      <Toolbox stats={stats} />
      <DecisionAnatomy stats={stats} />
      <ProgressStrip stats={stats} />
    </div>
  )
}

// ── KPI strip ─────────────────────────────────────────────────────────────

function KpiStrip({ stats, live }: { stats: ToolsStats; live: boolean }) {
  const denials = stats.flow.filter((f) => !f.ok).reduce((s, f) => s + f.calls, 0)
  const kpis = [
    { label: 'turns routed', value: String(stats.events.turns) },
    { label: 'calls settled', value: String(stats.events.settled) },
    { label: 'stops receipted', value: String(denials) },
    { label: 'routed spend', value: `$${stats.events.costUsd.toFixed(2)}` },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-xl border border-[var(--line)] bg-black/40 px-4 py-3 min-w-0">
          <p className="text-xl text-white mono">{k.value}</p>
          <p className="text-[11px] text-[color:var(--muted-2)] mono uppercase tracking-wide flex items-center gap-1.5">
            {k.label}
            {k.label === 'turns routed' && (
              <span
                className={live ? 'w-1.5 h-1.5 rounded-full animate-pulse' : 'w-1.5 h-1.5 rounded-full'}
                style={{ background: live ? 'var(--accent)' : 'var(--muted-2)' }}
              />
            )}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────

function SectionHead({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode
  title: string
  sub: string
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        <h2 className="text-sm font-medium text-white mono uppercase tracking-wide">{title}</h2>
      </div>
      <p className="text-[13px] text-[color:var(--muted)] mt-1 max-w-xl">{sub}</p>
    </div>
  )
}

// ── 1. The toolbox ────────────────────────────────────────────────────────

function Toolbox({ stats }: { stats: ToolsStats }) {
  const liveStat = useMemo(() => buildToolStats(stats), [stats])
  return (
    <section>
      <SectionHead
        icon={<Wrench className="w-4 h-4" />}
        title="The toolbox"
        sub="Eight decisions sit between your message and a settled call. The model proposes, code disposes, policy decides — each decision is a named tool."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 min-w-0">
        {THINKING_TOOLS.map((t) => {
          const s = liveStat.get(t.id)
          return (
            <div
              key={t.id}
              className="rounded-xl border border-[var(--line)] bg-black/40 p-4 flex flex-col gap-2 min-w-0"
            >
              <p className="mono text-[12px] text-white [overflow-wrap:anywhere]">
                <span style={{ color: 'var(--accent)' }}>⚙</span> {t.name}
              </p>
              <p className="text-[12px] text-[color:var(--muted)] leading-relaxed flex-1">{t.decides}</p>
              <p className="mono text-[11px] text-[color:var(--muted-2)] [overflow-wrap:anywhere]">
                {t.signature}
              </p>
              {s ? (
                <p className="mono text-[11px] [overflow-wrap:anywhere]" style={{ color: 'var(--accent)' }}>
                  {s.stat}
                  {s.example ? <span className="text-[color:var(--muted)]"> · {s.example}</span> : null}
                </p>
              ) : null}
              <p className="mono text-[10px] text-[color:var(--muted-2)] [overflow-wrap:anywhere]">{t.home}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface ToolLiveStat {
  stat: string
  example?: string
}

function buildToolStats(stats: ToolsStats): Map<string, ToolLiveStat> {
  const m = new Map<string, ToolLiveStat>()
  const traceN = (type: string) => stats.trace.find((t) => t.type === type)?.n ?? 0
  const endpointSelects = stats.selects.filter((s) => /endpoint|planner/i.test(s.reason ?? '')).length
  const serverSelects = stats.selects.length - endpointSelects
  const runsFor = (re: RegExp) => stats.toolRuns.filter((r) => re.test(r.name))
  const flowCalls = (re: RegExp, ok?: boolean) =>
    stats.flow
      .filter((f) => re.test(f.service) && (ok === undefined || f.ok === ok))
      .reduce((s, f) => s + f.calls, 0)

  const lastServerPick = stats.selects.find((s) => !/endpoint|planner/i.test(s.reason ?? ''))
  m.set('server-picker', {
    stat: `${serverSelects} picks in the live window`,
    example: lastServerPick ? `last: ${lastServerPick.service}` : undefined,
  })
  m.set('endpoint-picker', {
    stat: `${endpointSelects} planner picks · ${stats.endpoints.withParams} auto-callable endpoints on the menu`,
  })
  const spaces = runsFor(/resolve[_-]?space/i)
  const spaceExample = spaces.find((r) => r.example?.includes('→'))?.example
  m.set('resolve-space', {
    stat: `${spaces.reduce((s, r) => s + r.runs, 0)} resolutions in the live window`,
    example: spaceExample ?? undefined,
  })
  const tokens = runsFor(/token/i)
  m.set('resolve-token', {
    stat: tokens.length
      ? `${tokens.reduce((s, r) => s + r.runs, 0)} lookups in the live window`
      : 'two official lists merged · zero guessed addresses',
  })
  const venueCalls = flowCalls(/uniswap|cow/i)
  m.set('venue-picker', {
    stat: venueCalls > 0 ? `${venueCalls} venue calls receipted` : 'CoW by default · Uniswap when you name it',
  })
  m.set('guardrails', { stat: `${traceN('eip712')} sign surfaces raised in the live window` })
  const denials = stats.flow.filter((f) => !f.ok).reduce((s, f) => s + f.calls, 0)
  const settles = stats.flow.filter((f) => f.ok).reduce((s, f) => s + f.calls, 0)
  m.set('policy-gate', { stat: `${settles} allowed · ${denials} stopped — every one receipted` })
  m.set('house-synthesizer', { stat: `${flowCalls(/house/i, true)} answers written at $0.00` })
  return m
}

// ── 2. Decision anatomy ───────────────────────────────────────────────────

function DecisionAnatomy({ stats }: { stats: ToolsStats }) {
  const turn = stats.latestTurn
  return (
    <section>
      <SectionHead
        icon={<Terminal className="w-4 h-4" />}
        title="Decision anatomy — live"
        sub="The last routed turn, line by line, with the tool that made each decision. Same trace the chat terminal streams — here it's annotated."
      />
      <div className="rounded-xl border border-[var(--line)] bg-black/60 overflow-hidden">
        <div className="flex items-center gap-2 px-3 h-10 border-b border-[var(--line)] bg-black/40">
          <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          <span className="text-[11px] font-medium text-white mono uppercase tracking-wide">
            latest turn
          </span>
          {turn ? (
            <span className="text-[10px] text-[color:var(--muted-2)] mono truncate">
              · {turn.turnId.slice(0, 8)}…{turn.payer ? ` · ${turn.payer}` : ''}
            </span>
          ) : null}
        </div>
        <div className="px-3 py-3 overflow-x-auto">
          {!turn || turn.lines.length === 0 ? (
            <p className="mono text-[11px] text-[color:var(--muted-2)]">
              <span style={{ color: 'var(--accent)' }}>$</span> idle — route a message in chat and its anatomy
              lands here.
            </p>
          ) : (
            <div className="space-y-1.5 min-w-[560px]">
              {turn.lines.map((ev, i) => {
                const id = toolIdForTraceEvent(ev)
                const tool = id ? toolById(id) : undefined
                return (
                  <div key={i} className="grid grid-cols-[210px_1fr] gap-2 items-start">
                    <span className="mono text-[10px] pt-0.5 truncate text-right">
                      {tool ? (
                        <span
                          className="inline-block px-1.5 py-px rounded border"
                          style={{ color: 'var(--accent)', borderColor: 'var(--line)' }}
                        >
                          {tool.name}
                        </span>
                      ) : (
                        <span className="text-[color:var(--muted-2)]">·</span>
                      )}
                    </span>
                    <div className="mono text-[11px] leading-relaxed min-w-0">
                      <TraceLine event={ev as RouterTraceEvent} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ── 4. Self-updating progress ────────────────────────────────────────────

function ProgressStrip({ stats }: { stats: ToolsStats }) {
  return (
    <section>
      <SectionHead
        icon={<TrendingUp className="w-4 h-4" />}
        title="Self-updating"
        sub="The tools learn from every receipt: settle rates rerank tomorrow's menus, failures become tracked incidents, and the routing eval keeps score."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 min-w-0">
        <EvalCard />
        <SettleRateCard stats={stats} />
        <IncidentCard stats={stats} />
        <DataGrowthCard stats={stats} />
      </div>
    </section>
  )
}

function ProgressCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-black/40 p-4 min-w-0">
      <p className="text-[11px] font-medium text-white mono uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  )
}

function EvalCard() {
  const pts = EVAL_HISTORY
  const W = 220
  const H = 64
  const min = 50
  const max = 100
  const x = (i: number) => 8 + (i * (W - 16)) / (pts.length - 1)
  const y = (v: number) => H - 6 - ((v - min) / (max - min)) * (H - 12)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.recallAtShortlist)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <ProgressCard title="Eval scoreboard">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl text-white mono">{last.recallAtShortlist}%</span>
        <span className="text-[11px] text-[color:var(--muted)] mono">recall@shortlist</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-2" role="img" aria-label="Routing eval history">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.recallAtShortlist)} r={3} fill="var(--accent)" />
        ))}
      </svg>
      <p className="text-[10px] text-[color:var(--muted-2)] mono mt-1">
        {pts[0].recallAtShortlist}% → {last.recallAtShortlist}% across {pts.length} retrieval upgrades ·
        answered@full {EVAL_ANSWERED_AT_FULL}%
      </p>
    </ProgressCard>
  )
}

function SettleRateCard({ stats }: { stats: ToolsStats }) {
  const rows = useMemo(() => {
    const by = new Map<string, { ok: number; total: number }>()
    for (const f of stats.flow) {
      const r = by.get(f.service) ?? { ok: 0, total: 0 }
      r.total += f.calls
      if (f.ok) r.ok += f.calls
      by.set(f.service, r)
    }
    return [...by.entries()]
      .filter(([, r]) => r.total >= 3)
      .map(([name, r]) => ({ name, rate: r.ok / r.total, total: r.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [stats.flow])
  return (
    <ProgressCard title="Settle rate → menu rank">
      {rows.length === 0 ? (
        <p className="text-[11px] text-[color:var(--muted-2)] mono">Not enough receipts yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="min-w-0">
              <div className="flex justify-between text-[11px] mono">
                <span className="text-white truncate">{r.name}</span>
                <span className="text-[color:var(--muted)] flex-shrink-0 ml-2">
                  {Math.round(r.rate * 100)}% · {r.total}
                </span>
              </div>
              <div className="h-1 rounded bg-white/5 mt-0.5">
                <div
                  className="h-1 rounded"
                  style={{ width: `${r.rate * 100}%`, background: 'var(--accent)', opacity: 0.8 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-[color:var(--muted-2)] mono mt-2">
        Reputation from settled receipts feeds yeetful-tool-server-picker&apos;s ranking.
      </p>
    </ProgressCard>
  )
}

function IncidentCard({ stats }: { stats: ToolsStats }) {
  const n = (statuses: string[]) =>
    stats.incidents.filter((i) => statuses.includes(i.status)).reduce((s, i) => s + i.n, 0)
  const steps = [
    { label: 'open', value: n(['open', 'dispatched']) },
    { label: 'fix PR', value: n(['pr_open']) },
    { label: 'resolved', value: n(['resolved', 'wontfix']) },
  ]
  return (
    <ProgressCard title="Failure → incident → fix">
      <div className="flex items-center gap-2 mono">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="text-center">
              <p className="text-xl text-white">{s.value}</p>
              <p className="text-[10px] text-[color:var(--muted-2)] uppercase tracking-wide">{s.label}</p>
            </div>
            {i < steps.length - 1 && <span className="text-[color:var(--muted-2)]">→</span>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[color:var(--muted-2)] mono mt-3">
        Repeated failures dedupe into incidents; dead hosts sink in the picker&apos;s ranking.
      </p>
    </ProgressCard>
  )
}

function DataGrowthCard({ stats }: { stats: ToolsStats }) {
  const traceTotal = stats.trace.reduce((s, t) => s + t.n, 0)
  const rows = [
    { label: 'endpoints in the catalog', value: stats.endpoints.total },
    { label: 'with param schemas (auto-callable)', value: stats.endpoints.withParams },
    { label: 'vector-embedded for retrieval', value: stats.endpoints.embedded },
    { label: 'trace lines, live 2-day window', value: traceTotal },
  ]
  return (
    <ProgressCard title="The map keeps growing">
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between items-baseline text-[11px] mono min-w-0">
            <span className="text-[color:var(--muted)] truncate">{r.label}</span>
            <span className="text-white flex-shrink-0 ml-2">{r.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[color:var(--muted-2)] mono mt-3">
        Daily ingest + tag + embed passes keep the pickers&apos; menu honest.
      </p>
    </ProgressCard>
  )
}
