import Link from 'next/link'
import { Activity, ArrowRight } from 'lucide-react'
import type { McpHealth } from '@/lib/mcp-health'
import { HEALTH_STATUS_META } from '@/lib/mcp-health'

const TONE: Record<'good' | 'warn' | 'bad' | 'muted', string> = {
  good: 'var(--accent)',
  warn: '#f4b740',
  bad: '#ff6b6b',
  muted: 'var(--muted)',
}

/** The at-a-glance "how well is this MCP working" header — fuses usage,
 *  routability, and unresolved failures above the detailed panels below. */
export default function McpHealthPanel({ health, docsHref = '/docs/routable-mcp' }: { health: McpHealth; docsHref?: string }) {
  const meta = HEALTH_STATUS_META[health.status]
  const color = TONE[meta.tone]
  const inc = health.incidents

  return (
    <section
      className="rounded-2xl border p-5 mb-4"
      style={{ borderColor: 'var(--line)', background: 'var(--surf-1)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-2 mono uppercase tracking-wide text-[11px] text-[color:var(--muted-2)]">
          <Activity className="w-3.5 h-3.5" /> MCP health
        </span>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] mono uppercase tracking-wide"
          style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          {meta.label}
        </span>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="u-name-serif text-[44px] leading-none" style={{ color }}>
            {health.health ?? '—'}
          </span>
          {health.health != null && <span className="mono text-[13px] text-[color:var(--muted-2)]">/100</span>}
        </div>
        <p className="text-[14px] text-[color:var(--muted)] flex-1 min-w-[200px] mb-1">{health.headline}</p>
      </div>

      {/* The three fused signals */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <Signal
          label="Usage"
          value={health.reputation?.qualified ? `${health.reputation.tier} · ${Math.round(health.reputation.settleRate * 100)}%` : '—'}
          sub={health.reputation?.qualified ? `${health.reputation.calls} call${health.reputation.calls === 1 ? '' : 's'}` : 'no traffic'}
        />
        <Signal
          label="Routability"
          value={health.routability ? `${health.routability.grade} · ${health.routability.score}` : '—'}
          sub={health.routability ? 'graded' : 'not linted'}
        />
        <Signal
          label="Failures"
          value={inc.open > 0 ? `${inc.occurrences}` : '0'}
          sub={inc.open > 0 ? `${inc.open} open incident${inc.open === 1 ? '' : 's'}` : 'none open'}
          tone={inc.open > 0 ? 'bad' : 'muted'}
        />
      </div>

      {(health.status === 'attention' || health.status === 'watch') && (
        <div className="mt-4 flex items-center gap-4 flex-wrap text-[12.5px]">
          <Link
            href={docsHref}
            className="inline-flex items-center gap-1 text-[color:var(--fg)] underline decoration-dotted underline-offset-4"
          >
            Fix it with Claude Code <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          {inc.open > 0 && inc.topId && (
            <Link href={`/incidents/${inc.topId}`} className="inline-flex items-center gap-1 text-[color:var(--muted)] underline decoration-dotted underline-offset-4">
              View the failing trace
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

function Signal({ label, value, sub, tone = 'muted' }: { label: string; value: string; sub: string; tone?: 'bad' | 'muted' }) {
  return (
    <div className="rounded-xl border p-3 min-w-0" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
      <div className="mono text-[10px] uppercase tracking-wide text-[color:var(--muted-2)]">{label}</div>
      <div className="mt-1 text-[15px] font-medium truncate" style={{ color: tone === 'bad' ? '#ff6b6b' : 'var(--fg)' }}>{value}</div>
      <div className="text-[11px] text-[color:var(--muted-2)] truncate">{sub}</div>
    </div>
  )
}
