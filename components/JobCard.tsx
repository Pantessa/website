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
import SendTxChain from '@/components/SendTxChain'
import SignHlActionButton from '@/components/SignHlActionButton'
import SignNftListingButton from '@/components/SignNftListingButton'
import SpendPolicyFix, { type PolicyBlockInfo } from '@/components/SpendPolicyFix'
import ShareReceiptButton from '@/components/ShareReceiptButton'
import { orderRequestOf, txChainOf, txRequestOf } from '@/lib/transaction-layer'
import { LIVE_JOB_STATUSES, jobStatusWord } from '@/lib/step-status'

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

const ACTIVE = new Set<string>(LIVE_JOB_STATUSES)

function StepIcon({ step, isCurrent }: { step: StepRow; isCurrent: boolean }) {
  if (step.status === 'done') return <CheckCircle2 className="w-4 h-4 text-[color:var(--done)] flex-shrink-0" aria-hidden />
  if (step.status === 'failed') return <XCircle className="w-4 h-4 text-[color:var(--fail)] flex-shrink-0" aria-hidden />
  if (step.status === 'offered') return <PenLine className="w-4 h-4 text-[color:var(--fg)] flex-shrink-0" aria-hidden />
  if (step.status === 'running' || (isCurrent && step.kind === 'wait'))
    return <Loader2 className="w-4 h-4 animate-spin text-[color:var(--muted)] flex-shrink-0" aria-hidden />
  if (step.kind === 'auto') return <Bot className="w-4 h-4 text-[color:var(--muted-2)] flex-shrink-0" aria-hidden />
  return <Circle className="w-3.5 h-3.5 text-[color:var(--line-2)] flex-shrink-0" aria-hidden />
}

export default function JobCard({
  jobId,
  token,
  onStepSigned,
  onSettled,
}: {
  jobId: string
  /** Capability token from the turn that compiled the job — the embed path's
   *  auth (no SIWE session in an iframe visitor). Appended as ?t=. */
  token?: string
  /** Telemetry hook — fired once per signed step with its value + builder. */
  onStepSigned?: (info: { builder: string; valueUsd?: number | null; detail?: string }) => void
  /** Fired ONCE when the poll first observes a terminal status — the
   *  settlement signal /i's arc and embed hosts read. Also fires on mount
   *  for an already-finished job (a reopened thread), which is truthful. */
  onSettled?: (info: { jobId: string; status: 'done' | 'failed' | 'canceled'; valueUsd?: number | null }) => void
}) {
  const [job, setJob] = useState<JobRow | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const q = token ? `?t=${token}` : ''

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}${q}`, { cache: 'no-store' })
      if (!res.ok) {
        setError(res.status === 401 ? 'Sign in to watch this job.' : 'Job not found.')
        // Auth won't materialize mid-poll — stop instead of hammering 401s.
        if (timer.current) clearInterval(timer.current)
        return
      }
      const data = (await res.json()) as { job: JobRow }
      setJob(data.job)
      setError('')
    } catch {
      /* transient poll miss — keep the last state */
    }
  }, [jobId, q])

  useEffect(() => {
    void load()
    timer.current = setInterval(() => void load(), 4000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  // Stop polling once terminal — and emit the one-shot settlement signal.
  const settledFired = useRef(false)
  useEffect(() => {
    if (!job || ACTIVE.has(job.status)) return
    if (timer.current) clearInterval(timer.current)
    if (!settledFired.current) {
      settledFired.current = true
      onSettled?.({ jobId, status: job.status as 'done' | 'failed' | 'canceled', valueUsd: job.valueUsd })
    }
  }, [job, jobId, onSettled])

  const completeStep = async (seq: number, builder: string, result: Record<string, unknown>, valueUsd?: number | null) => {
    await fetch(`/api/jobs/${jobId}/complete${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seq, result }),
    }).catch(() => {})
    onStepSigned?.({ builder, valueUsd, detail: String(result.detail ?? result.txHash ?? '') })
    void load()
  }

  const cancel = async () => {
    await fetch(`/api/jobs/${jobId}${q}`, { method: 'DELETE' }).catch(() => {})
    void load()
  }

  // Re-arm the failed step (after a policy fix, a top-up, …). Polling stopped
  // when the job went terminal — restart it so the fresh offer appears live.
  const retry = async () => {
    await fetch(`/api/jobs/${jobId}/retry${q}`, { method: 'POST' }).catch(() => {})
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => void load(), 4000)
    void load()
  }

  if (error) return <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">{error}</p>
  if (!job) return <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">Loading job…</p>

  const doneCount = job.steps.filter((s) => s.status === 'done').length
  const statusLine = jobStatusWord(job.status)
  const live = ACTIVE.has(job.status)

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
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              job.status === 'done'
                ? 'border-[color:color-mix(in_srgb,var(--done)_40%,transparent)] text-[color:var(--done)]'
                : job.status === 'failed'
                  ? 'border-[color:color-mix(in_srgb,var(--fail)_40%,transparent)] text-[color:var(--fail)]'
                  : job.status === 'waiting_signature'
                    ? 'border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] text-[color:var(--accent)]'
                    : 'border-[color:var(--line-2)] text-[color:var(--muted)]'
            }`}
          >
            {live && job.status !== 'waiting_signature' && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--live)' }} aria-hidden />
            )}
            {job.status === 'done' && <CheckCircle2 className="w-3 h-3" aria-hidden />}
            {statusLine}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden />}
        </span>
      </button>

      {/* progress — visible even collapsed; the card's heartbeat */}
      <div className={`yprog mx-3 mb-0.5 ${job.status === 'failed' ? 'yprog--fail' : job.status === 'done' ? 'yprog--full' : ''}`}>
        <div className="yprog__fill" style={{ width: `${job.steps.length ? (doneCount / job.steps.length) * 100 : 0}%` }} />
      </div>

      {expanded && (
        <div className="px-3 pb-2.5">
          {job.steps.map((step, i) => {
            const isCurrent = step.seq === job.currentStep && ACTIVE.has(job.status)
            const prevDone = i > 0 && job.steps[i - 1].status === 'done'
            const isFirst = i === 0
            const isLast = i === job.steps.length - 1
            const order = step.status === 'offered' ? orderRequestOf(step.artifact) : null
            const chain = step.status === 'offered' && !order ? txChainOf(step.artifact) : null
            const tx = step.status === 'offered' && !order && !chain ? txRequestOf(step.artifact) : null
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
            // Timeline rail: each row draws its own connector segments so
            // progress reads as a line filling in, not floating icons — the
            // segment above an icon turns emerald the moment the step before
            // it lands.
            const railUp = prevDone ? 'bg-[color:color-mix(in_srgb,var(--done)_60%,transparent)]' : 'bg-[var(--line)]'
            const railDown = step.status === 'done' ? 'bg-[color:color-mix(in_srgb,var(--done)_60%,transparent)]' : 'bg-[var(--line)]'
            return (
              <div key={step.seq} className={`flex gap-2 rounded-lg px-2 ${isCurrent ? 'bg-[color:color-mix(in_srgb,var(--fg)_4%,transparent)]' : ''}`}>
                <div className="flex flex-col items-center w-4 flex-shrink-0 self-stretch">
                  <span className={`w-px h-[7px] flex-none ${isFirst ? 'opacity-0' : railUp}`} aria-hidden />
                  <StepIcon step={step} isCurrent={isCurrent} />
                  <span className={`w-px flex-1 min-h-[7px] ${isLast ? 'opacity-0' : railDown}`} aria-hidden />
                </div>
                <div className="flex-1 min-w-0 py-1.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className={step.status === 'pending' ? 'text-[color:var(--muted-2)]' : ''}>{step.title}</span>
                    {step.valueUsd != null && <span className="mono text-[11px] text-[color:var(--muted)]">${step.valueUsd.toFixed(2)}</span>}
                    {step.kind === 'auto' && step.status !== 'failed' && (
                      <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">auto</span>
                    )}
                  </div>
                  {resultNote && (
                    <div className={`text-[11.5px] ${step.status === 'failed' ? 'text-[color:var(--fail)]' : 'text-[color:var(--muted-2)]'}`}>{resultNote.slice(0, 180)}</div>
                  )}
                  {/* A spend-policy refusal is fixable in place: the failed step
                      persisted the structured block, so offer the exact policy
                      change + a retry that rebuilds this step fresh. */}
                  {step.status === 'failed' && job.status === 'failed' && (step.result as { policyBlock?: PolicyBlockInfo } | null)?.policyBlock && (
                    <SpendPolicyFix block={(step.result as { policyBlock: PolicyBlockInfo }).policyBlock} onFixed={() => void retry()} retryLabel="Try the build again" />
                  )}
                  {/* the embedded sign surface — the SAME buttons chat uses;
                      orderRequest artifacts dispatch on their protocol */}
                  {order && order.protocol === 'opensea' && (
                    <SignNftListingButton
                      order={order}
                      onPlaced={(info) =>
                        void completeStep(
                          step.seq,
                          step.builder,
                          { detail: info.orderUid ? `Listed on OpenSea — order ${info.orderUid.slice(0, 12)}…` : 'Listed on OpenSea', explorerUrl: info.explorerUrl },
                          step.valueUsd,
                        )
                      }
                    />
                  )}
                  {order && order.protocol !== 'opensea' && (
                    <SignHlActionButton
                      order={order}
                      onPlaced={(info) => void completeStep(step.seq, step.builder, { detail: info.detail, explorerUrl: info.explorerUrl }, info.valueUsd)}
                    />
                  )}
                  {tx && (
                    <SendTxButton
                      tx={tx}
                      summary={(step.artifact as { summary?: string } | null)?.summary}
                      onConfirmed={(hash) =>
                        void completeStep(
                          step.seq,
                          step.builder,
                          { txHash: hash, txs: [{ hash, chainId: tx.chainId ?? 8453, title: step.title }] },
                          step.valueUsd,
                        )
                      }
                    />
                  )}
                  {/* multi-tx sign steps (approve → bridge/swap) ride the SAME
                      self-advancing chain card chat uses — deadline watch,
                      per-step re-quotes and all; the job step completes when
                      the FINAL tx of the chain confirms. */}
                  {chain && (
                    <SendTxChain
                      chain={chain}
                      // txs = every confirmed hash in the chain (approve AND
                      // swap AND fee), so the persisted step result carries
                      // the full signing log the shared page renders.
                      onCompleted={(info) => void completeStep(step.seq, step.builder, { txHash: info.hash, txs: info.txs }, step.valueUsd)}
                    />
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[var(--line)]">
            {job.status === 'done' ? (
              <span className="inline-flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--done)]">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                  <span>
                    <span className="mono font-semibold">${(job.valueUsd ?? 0).toFixed(2)}</span> moved — every step receipted.
                  </span>
                </span>
                {/* the aha moment, one tap from leaving the app as a link */}
                <ShareReceiptButton kind="job" refId={jobId} />
              </span>
            ) : (
              <span className="text-[11px] text-[color:var(--muted-2)]">
                {job.status === 'failed' && job.failReason
                  ? job.failReason.slice(0, 160)
                  : 'Steps are built + guard-checked only when offered; waits verify settlement.'}
              </span>
            )}
            {ACTIVE.has(job.status) && (
              <button onClick={() => void cancel()} className="text-[11px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fail)] transition-colors">
                cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
