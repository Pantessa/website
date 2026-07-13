'use client'

// JobsPanel — every multi-step job this wallet has run, with its per-step
// receipt trail. The dashboard home of the primitive; the live signing
// surface stays the chat JobCard.

import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCircle2, Circle, Loader2, PenLine, XCircle } from 'lucide-react'

interface StepLite {
  seq: number
  kind: string
  status: string
  builder: string
  title: string
  valueUsd: number | null
  result: Record<string, unknown> | null
}

interface JobRow {
  id: string
  title: string
  status: string
  currentStep: number
  valueUsd: number | null
  failReason: string | null
  createdAt: string
  steps: StepLite[]
}

const label = 'mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]'

function chip(status: string) {
  const tone =
    status === 'done'
      ? 'border-emerald-500/40 text-emerald-500'
      : status === 'failed'
        ? 'border-red-500/40 text-red-500'
        : status === 'canceled'
          ? 'border-[color:var(--line-2)] text-[color:var(--muted-2)]'
          : 'border-sky-500/40 text-sky-500'
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status.replace(/_/g, ' ')}</span>
}

function stepIcon(s: StepLite) {
  if (s.status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" aria-hidden />
  if (s.status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" aria-hidden />
  if (s.status === 'offered') return <PenLine className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
  if (s.status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" aria-hidden />
  if (s.kind === 'auto') return <Bot className="w-3.5 h-3.5 text-[color:var(--muted-2)] flex-shrink-0" aria-hidden />
  return <Circle className="w-3 h-3 text-[color:var(--line-2)] flex-shrink-0" aria-hidden />
}

export default function JobsPanel() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' })
      if (!res.ok) return
      setJobs(((await res.json()) as { jobs: JobRow[] }).jobs)
    } catch {
      /* keep last */
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  if (!jobs) return <p className="text-[13px] text-[color:var(--muted-2)]">Loading jobs…</p>
  if (jobs.length === 0) {
    return (
      <p className="text-[13px] text-[color:var(--muted-2)]">
        No jobs yet. Chain steps in one chat ask — “deposit 12 usdc to hyperliquid, then long $12 of eth on
        hyperliquid, then protect my eth long with a 5% stop” — and the whole run lands here with a receipt per step.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[color:var(--line,rgba(128,128,128,0.15))]">
      {jobs.map((j) => (
        <li key={j.id} className="py-2.5">
          <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(open === j.id ? null : j.id)}>
            <span className="text-[13px] truncate">{j.title}</span>
            <span className="flex items-center gap-2 flex-shrink-0">
              {j.valueUsd != null && j.valueUsd > 0 && <span className="mono text-[11.5px]">${j.valueUsd.toFixed(2)}</span>}
              {chip(j.status)}
              <span className="mono text-[10.5px] text-[color:var(--muted-2)]">{new Date(j.createdAt).toLocaleDateString()}</span>
            </span>
          </button>
          {open === j.id && (
            <div className="mt-2 ml-1 space-y-1">
              {j.steps.map((s) => (
                <div key={s.seq} className="flex items-center gap-2 text-[12px]">
                  {stepIcon(s)}
                  <span className={s.status === 'pending' ? 'text-[color:var(--muted-2)]' : ''}>{s.title}</span>
                  {s.valueUsd != null && <span className="mono text-[10.5px] text-[color:var(--muted)]">${s.valueUsd.toFixed(2)}</span>}
                  <span className={label}>{s.builder.replace('native-', '')}</span>
                </div>
              ))}
              {j.failReason && <p className="text-[11.5px] text-red-500 ml-5">{j.failReason.slice(0, 160)}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
