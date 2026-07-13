'use client'

// JobCard — one compound intent, every guarded step of it, live. The
// generalization of SendTxChain across venues: sign steps embed the EXISTING
// sign buttons (SendTxButton for EVM transfers, SignHlActionButton for HL
// L1 actions), wait steps breathe while the runner polls settlement, auto
// steps show the server acting under an existing consent. Nothing here is
// aspirational: a step renders only what the runner actually built and
// guard-checked.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, PenLine, ShieldCheck, XCircle } from 'lucide-react'
import SendTxButton from '@/components/SendTxButton'
import SignHlActionButton from '@/components/SignHlActionButton'
import { orderRequestOf, txRequestOf } from '@/lib/transaction-layer'

interface StepRow {
  seq: number
  kind: 'sign' | 'wait' | 'auto'
  status: string
  builder: string
  title: string
  artifact?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  valueUsd?: number | null
}

interface JobRow {
  id: string
  title: string
  status: string
  currentStep: number
  valueUsd?: number | null
  failReason?: string | null
  steps: StepRow[]
}

const ACTIVE = new Set(['running', 'waiting_signature', 'waiting_settlement'])

function StepIcon({ step, isCurrent }: { step: StepRow; isCurrent: boolean }) {
  if (step.status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden />
  if (step.status === 'failed') return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden />
  if (step.status === 'offered') return <PenLine className="w-4 h-4 text-[color:var(--fg)] flex-shrink-0" aria-hidden />
  if (step.status === 'running' || (isCurrent && step.kind === 'wait'))
    return <Loader2 className="w-4 h-4 animate-spin text-[color:var(--muted)] flex-shrink-0" aria-hidden />
  if (step.kind === 'auto') return <Bot className="w-4 h-4 text-[color:var(--muted-2)] flex-shrink-0" aria-hidden />
  return <Circle className="w-3.5 h-3.5 text-[color:var(--line-2)] flex-shrink-0" aria-hidden />
}

export default function JobCard({
  jobId,
  onStepSigned,
}: {
  jobId: string
  /** Telemetry hook — fired once per signed step with its value + builder. */
  onStepSigned?: (info: { builder: string; valueUsd?: number | null; detail?: string }) => void
}) {
  const [job, setJob] = useState<JobRow | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' })
      if (!res.ok) {
        setError(res.status === 401 ? 'Sign in to watch this job.' : 'Job not found.')
        return
      }
      const data = (await res.json()) as { job: JobRow }
      setJob(data.job)
      setError('')
    } catch {
      /* transient poll miss — keep the last state */
    }
  }, [jobId])

  useEffect(() => {
    void load()
    timer.current = setInterval(() => void load(), 4000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  // Stop polling once terminal.
  useEffect(() => {
    if (job && !ACTIVE.has(job.status) && timer.current) clearInterval(timer.current)
  }, [job])

  const completeStep = async (seq: number, builder: string, result: Record<string, unknown>, valueUsd?: number | null) => {
    await fetch(`/api/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seq, result }),
    }).catch(() => {})
    onStepSigned?.({ builder, valueUsd, detail: String(result.detail ?? result.txHash ?? '') })
    void load()
  }

  const cancel = async () => {
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {})
    void load()
  }

  if (error) return <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">{error}</p>
  if (!job) return <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">Loading job…</p>

  const doneCount = job.steps.filter((s) => s.status === 'done').length
  const statusLine =
    job.status === 'done'
      ? '✓ complete'
      : job.status === 'failed'
        ? 'failed'
        : job.status === 'canceled'
          ? 'canceled'
          : job.status === 'waiting_signature'
            ? 'your signature'
            : job.status === 'waiting_settlement'
              ? 'settling…'
              : 'running'

  return (
    <div className="mt-2.5 rounded-xl border border-[var(--line)] overflow-hidden">
      {/* header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 text-[color:var(--muted)]" aria-hidden />
          <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] flex-shrink-0">
            Job · {doneCount}/{job.steps.length}
          </span>
          <span className="text-[12.5px] truncate">{job.title}</span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-[11px] mono ${
              job.status === 'done' ? 'text-emerald-400' : job.status === 'failed' ? 'text-red-400' : 'text-[color:var(--muted)]'
            }`}
          >
            {statusLine}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1">
          {job.steps.map((step) => {
            const isCurrent = step.seq === job.currentStep && ACTIVE.has(job.status)
            const order = step.status === 'offered' ? orderRequestOf(step.artifact) : null
            const tx = step.status === 'offered' && !order ? txRequestOf(step.artifact) : null
            const resultNote =
              step.status === 'done' && step.result
                ? String(
                    (step.result as { positionNote?: string }).positionNote ??
                      (step.result as { status?: string }).status ??
                      (step.result as { detail?: string }).detail ??
                      '',
                  )
                : step.status === 'failed' && step.result
                  ? String((step.result as { error?: string }).error ?? '')
                  : ''
            return (
              <div key={step.seq} className={`rounded-lg px-2 py-1.5 ${isCurrent ? 'bg-[color:color-mix(in_srgb,var(--fg)_4%,transparent)]' : ''}`}>
                <div className="flex items-center gap-2 text-[12.5px]">
                  <StepIcon step={step} isCurrent={isCurrent} />
                  <span className={step.status === 'pending' ? 'text-[color:var(--muted-2)]' : ''}>{step.title}</span>
                  {step.valueUsd != null && <span className="mono text-[11px] text-[color:var(--muted)]">${step.valueUsd.toFixed(2)}</span>}
                  {step.kind === 'auto' && step.status !== 'failed' && (
                    <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">auto</span>
                  )}
                </div>
                {resultNote && (
                  <div className={`ml-6 text-[11.5px] ${step.status === 'failed' ? 'text-red-400' : 'text-[color:var(--muted-2)]'}`}>{resultNote.slice(0, 180)}</div>
                )}
                {/* the embedded sign surface — the SAME buttons chat uses */}
                {order && (
                  <div className="ml-6">
                    <SignHlActionButton
                      order={order}
                      onPlaced={(info) => void completeStep(step.seq, step.builder, { detail: info.detail, explorerUrl: info.explorerUrl }, info.valueUsd)}
                    />
                  </div>
                )}
                {tx && (
                  <div className="ml-6">
                    <SendTxButton
                      tx={tx}
                      summary={(step.artifact as { summary?: string } | null)?.summary}
                      onConfirmed={(hash) => void completeStep(step.seq, step.builder, { txHash: hash }, step.valueUsd)}
                    />
                  </div>
                )}
              </div>
            )
          })}

          <div className="flex items-center justify-between pt-1 border-t border-[var(--line)]">
            <span className="text-[11px] text-[color:var(--muted-2)]">
              {job.status === 'failed' && job.failReason
                ? job.failReason.slice(0, 160)
                : job.status === 'done'
                  ? `Money moved: $${(job.valueUsd ?? 0).toFixed(2)} — every step receipted.`
                  : 'Steps are built + guard-checked only when offered; waits verify settlement.'}
            </span>
            {ACTIVE.has(job.status) && (
              <button onClick={() => void cancel()} className="text-[11px] mono text-[color:var(--muted-2)] hover:text-red-400 transition-colors">
                cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
