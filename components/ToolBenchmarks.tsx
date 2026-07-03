'use client'

import { useState } from 'react'
import Link from 'next/link'
import BrandIcon from '@/components/BrandIcon'
import type { ToolBenchmark, ToolStatus } from '@/lib/tool-benchmarks'
import type { HealthState } from '@/lib/health'

const STATUS_META: Record<ToolStatus, { label: string; color: string; dot: string }> = {
  healthy: { label: 'Getting the job done', color: 'var(--accent)', dot: 'var(--accent)' },
  degraded: { label: 'Degraded', color: '#f4b740', dot: '#f4b740' },
  failing: { label: 'Failing', color: '#ff6b6b', dot: '#ff6b6b' },
  new: { label: 'Not tested yet', color: 'var(--muted)', dot: 'var(--muted-2)' },
}

const stateColor = (s: HealthState): string =>
  s === 'live' ? 'var(--accent)' : s === 'needs' ? '#f4b740' : '#ff6b6b'
const stateLabel = (s: HealthState): string =>
  s === 'live' ? 'live' : s === 'needs' ? 'needs params/auth' : 'down'
const cleanUrl = (u: string) => u.replace(/^https?:\/\//, '')

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="mono text-[10px] uppercase tracking-wide text-[color:var(--muted-2)]">{label}</span>
      <span className="mono text-[13px] font-medium truncate" style={{ color: tone ?? 'var(--fg)' }}>
        {value}
      </span>
    </div>
  )
}

function BenchmarkCard({ tool }: { tool: ToolBenchmark }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[tool.status]
  const health = tool.health
  const hasHealth = !!health && health.total > 0
  const rate = tool.calls > 0 ? `${Math.round(tool.settleRate * 100)}%` : '—'
  const rateTone =
    tool.calls === 0
      ? 'var(--muted-2)'
      : tool.settleRate >= 0.85
        ? 'var(--accent)'
        : tool.settleRate >= 0.5
          ? '#f4b740'
          : '#ff6b6b'

  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-white/[0.015] overflow-hidden">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BrandIcon
            server={{
              id: tool.slug,
              slug: tool.slug,
              name: tool.name,
              description: tool.description,
              category: tool.category,
              websiteUrl: tool.websiteUrl,
              color: tool.color,
              iconSlug: tool.iconSlug,
            }}
            size={26}
          />
          <div className="min-w-0 flex-1">
            <Link href={`/servers/${tool.slug}`} className="font-medium hover:underline truncate block">
              {tool.name}
            </Link>
            <div className="flex items-center gap-2 mono text-[11px] text-[color:var(--muted)] mt-0.5">
              <span>{tool.category}</span>
              <span className="text-[color:var(--muted-2)]">·</span>
              <span>{tool.gated ? (tool.priceUsd ? `$${tool.priceUsd}/call` : 'x402') : 'free'}</span>
              <span className="text-[color:var(--muted-2)]">·</span>
              <span>{tool.toolCount} {tool.toolCount === 1 ? 'tool' : 'tools'}</span>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] mono whitespace-nowrap flex-shrink-0"
            style={{ color: meta.color, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: meta.dot }} />
            {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-[var(--line)]">
          <Stat label="Success" value={rate} tone={rateTone} />
          <Stat label="Calls (30d)" value={String(tool.calls)} />
          <Stat
            label="Failures"
            value={String(tool.failed + tool.openIncidents)}
            tone={tool.failed + tool.openIncidents > 0 ? '#ff6b6b' : 'var(--muted)'}
          />
          <Stat label="p50" value={tool.medianLatencyMs != null ? `${tool.medianLatencyMs}ms` : '—'} />
        </div>

        <div className="flex items-center justify-between gap-2 mono text-[11px] text-[color:var(--muted)]">
          <span>
            {hasHealth ? (
              <span className="inline-flex items-center gap-1.5" title={`${health!.live}/${health!.total} endpoints answered the probe`}>
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ background: stateColor(health!.live > 0 ? 'live' : health!.needs > 0 ? 'needs' : 'down') }}
                />
                {health!.live}/{health!.total} endpoints live
              </span>
            ) : (
              <span className="text-[color:var(--muted-2)]">no health probe yet</span>
            )}
            <span className="text-[color:var(--muted-2)]">{'  ·  '}last success {ago(tool.lastSettledAt)}</span>
          </span>
          {hasHealth ? (
            <button
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="text-[color:var(--muted-2)] hover:text-[color:var(--fg)] whitespace-nowrap"
            >
              {open ? '▾ hide tools' : '▸ tools'}
            </button>
          ) : null}
        </div>

        {tool.openIncidents > 0 ? (
          <div
            className="rounded-md px-2.5 py-1.5 mono text-[11px]"
            style={{ background: 'color-mix(in srgb, #ff6b6b 10%, transparent)', color: '#ff9a9a' }}
          >
            {tool.openIncidents} open {tool.openIncidents === 1 ? 'incident' : 'incidents'}
            {tool.incidentClasses.length ? ` · ${tool.incidentClasses.join(', ')}` : ''}
            {' · '}
            <Link href="/incidents" className="underline hover:text-white">
              self-heal log
            </Link>
          </div>
        ) : null}
      </div>

      {open && hasHealth ? (
        <div className="border-t border-[var(--line)] bg-white/[0.01] divide-y divide-[var(--line)]">
          {health!.endpoints.map((e, i) => (
            <div key={`${e.method}-${e.url}-${i}`} className="px-4 py-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1.5 text-[11px] mono whitespace-nowrap" style={{ color: stateColor(e.state) }}>
                  <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: stateColor(e.state) }} />
                  {stateLabel(e.state)}
                </span>
                <span className="mono text-[11px] text-[color:var(--muted-2)]">{e.method}</span>
                <span className="mono text-[11px] text-[color:var(--muted)] truncate">{cleanUrl(e.url)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function ToolBenchmarks({ tools }: { tools: ToolBenchmark[] }) {
  if (tools.length === 0) return null
  return (
    <section className="mb-12">
      <div className="grid gap-3 md:grid-cols-2 min-w-0">
        {tools.map((t) => (
          <BenchmarkCard key={t.slug} tool={t} />
        ))}
      </div>
    </section>
  )
}
