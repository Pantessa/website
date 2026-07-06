'use client'

// Routability panel (RR14) — the server page's "is this MCP built well
// enough for the router?" surface. Renders the saved mcp:lint report
// (score + dimensions + concrete fixes), lets anyone re-run diagnostics
// (POST /api/servers/[slug]/lint, server-side cooldown), and emits a
// copy-paste Claude Code prompt that turns the findings into an upgrade
// session on the MCP's own codebase. Sibling of ReputationPanel: that one
// says "is it reliable?", this one says "can the router even use it?".

import { useState } from 'react'
import { Activity, Check, ChevronDown, Copy, Loader2, Wrench, X } from 'lucide-react'
import { tierColor } from '@/components/ReputationPanel'
import { buildUpgradePrompt, type RoutabilityReport } from '@/lib/mcp-lint-report'

const DIM_LABELS: Record<string, string> = {
  schema: 'Param schemas',
  description: 'Descriptions',
  probe: 'Live probe',
  planner: 'Planner test',
  affordances: 'Affordances',
}

function DimBar({ label, weight, score }: { label: string; weight: number; score: number | null }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-28 flex-shrink-0 text-[color:var(--muted)]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        {score != null && (
          <div className="h-full rounded-full" style={{ width: `${Math.round(score * 100)}%`, background: 'var(--accent)' }} />
        )}
      </div>
      <span className="w-14 text-right mono text-[color:var(--muted-2)]">
        {score != null ? `${Math.round(score * 100)}% · w${weight}` : 'skipped'}
      </span>
    </div>
  )
}

export default function RoutabilityPanel({ slug, initial }: { slug: string; initial: RoutabilityReport | null }) {
  const [report, setReport] = useState<RoutabilityReport | null>(initial)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      const res = await fetch(`/api/servers/${slug}/lint`, { method: 'POST' })
      const data = (await res.json()) as { report?: RoutabilityReport; cached?: boolean; error?: string }
      if (!res.ok || !data.report) throw new Error(data.error || `HTTP ${res.status}`)
      setReport(data.report)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnostics failed.')
    } finally {
      setRunning(false)
    }
  }

  const copyPrompt = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(buildUpgradePrompt(report))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Clipboard unavailable — select the prompt text manually.')
    }
  }

  const gradeC = report ? tierColor(report.grade) : 'var(--muted)'

  return (
    <div className="svc__section">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[color:var(--muted)]" />
          <h2 className="text-[13px] font-medium text-[color:var(--fg)]">Routability</h2>
          <span className="text-[11px] text-[color:var(--muted-2)]">can the Reason Router discover, pick, and call this service?</span>
        </div>
        <button
          onClick={() => void run()}
          disabled={running}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white disabled:opacity-50 transition-colors"
          title="Run the routability linter against this service (probes + a live planner test, nothing paid)"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
          {running ? 'Running diagnostics…' : report ? 'Re-run diagnostics' : 'Run diagnostics'}
        </button>
      </div>

      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}

      {!report && !error && (
        <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">
          Not yet graded. Diagnostics check param schemas, description quality, live health, and run the actual routing
          planner against this service&rsquo;s own tools — construction only, nothing is paid or executed.
        </p>
      )}

      {report && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 mono font-semibold"
              style={{ color: gradeC, border: `1px solid ${gradeC}`, background: `color-mix(in srgb, ${gradeC} 12%, transparent)` }}
            >
              <span className="text-[18px]">{report.score}</span>
              <span className="text-[11px] text-[color:var(--muted-2)]">/100</span>
              <span className="text-[13px] ml-1">{report.grade}</span>
            </span>
            <span className="text-[11px] mono text-[color:var(--muted-2)]">
              linted {new Date(report.lintedAt).toLocaleString()}
            </span>
          </div>

          <div className="space-y-1.5">
            {report.dimensions.map((d) => (
              <DimBar key={d.key} label={DIM_LABELS[d.key] ?? d.key} weight={d.weight} score={d.score} />
            ))}
          </div>

          <details className="group">
            <summary className="cursor-pointer text-[12px] mono text-[color:var(--muted)] hover:text-[color:var(--fg)] inline-flex items-center gap-1">
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
              {report.dimensions.reduce((n, d) => n + d.checks.length, 0)} checks
            </summary>
            <ul className="mt-2 space-y-1">
              {report.dimensions.flatMap((d) =>
                d.checks.map((c, i) => (
                  <li key={`${d.key}-${i}`} className="flex items-start gap-1.5 text-[12px]">
                    {c.ok ? (
                      <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-400" />
                    )}
                    <span className={c.ok ? 'text-[color:var(--muted)]' : 'text-[color:var(--fg)]'}>
                      <span className="mono text-[color:var(--muted-2)]">{d.key}</span> · {c.note}
                    </span>
                  </li>
                )),
              )}
            </ul>
          </details>

          {report.fixes.length > 0 ? (
            <div>
              <h3 className="text-[12px] font-medium text-[color:var(--fg)]">Suggested fixes</h3>
              <ol className="mt-1 space-y-1 list-decimal list-inside">
                {report.fixes.map((f, i) => (
                  <li key={i} className="text-[12px] text-[color:var(--muted)]">{f}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-[12px] text-emerald-400">No fixes suggested — routable as built.</p>
          )}

          {report.fixes.length > 0 && (
            <details className="group rounded-lg border border-[var(--line)] p-3">
              <summary className="cursor-pointer text-[12px] font-medium text-[color:var(--fg)] inline-flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5" />
                Fix it with Claude Code
                <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-[12px] text-[color:var(--muted)]">
                Paste this into Claude Code inside the MCP&rsquo;s repo — it carries the failing checks, the fix list,
                and the conventions the router grades against.
              </p>
              <div className="relative mt-2">
                <button
                  onClick={() => void copyPrompt()}
                  className="absolute right-2 top-2 inline-flex items-center gap-1 text-[11px] mono px-2 py-1 rounded-md border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white transition-colors bg-black/40"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy prompt'}
                </button>
                <pre className="max-h-64 overflow-auto rounded-md bg-white/[0.03] border border-[var(--line)] p-3 text-[11px] leading-relaxed text-[color:var(--muted)] whitespace-pre-wrap">
                  {buildUpgradePrompt(report)}
                </pre>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
