'use client'

// The rail's Jobs tab — every standing thing on this wallet, in one glance:
// recurring buys (DCA schedules) with their current-period state, then jobs
// (multi-step runs) newest-first. Born from a real confusion: a schedule
// armed in chat was invisible afterwards, so "you already have a weekly buy"
// read as "something bought itself". This tab is the standing answer.
//
// Acting on a row PREFILLS the composer (store.composerPrefill) — the same
// contract as /chat?prompt=: the user always sends and signs themselves.
// Clicking the row BODY opens the job detail card (store.jobDetail): the
// live position/PnL around the job + its step card — for any job kind.

import { CalendarClock, CheckCircle2, Loader2, PenLine, ShieldCheck, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { cadenceLabel, dcaRunChip, type DcaCadence } from '@/lib/dca'
import { LIVE_JOB_STATUS, useRunningWork, type RunningJob, type RunningSchedule } from '@/lib/use-running-work'

function jobDot(status: string) {
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" aria-hidden />
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" aria-hidden />
  if (status === 'waiting_signature') return <PenLine className="w-3.5 h-3.5 text-[color:var(--accent)] flex-shrink-0" aria-hidden />
  if (LIVE_JOB_STATUS.has(status)) return <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--muted)] flex-shrink-0" aria-hidden />
  return <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--muted-2)] flex-shrink-0" aria-hidden />
}

const jobStatusWord: Record<string, string> = {
  running: 'running',
  waiting_signature: 'needs your signature',
  waiting_settlement: 'settling…',
  done: 'done',
  failed: 'failed',
  canceled: 'canceled',
}

function scheduleState(s: RunningSchedule): { word: string; tone: string } {
  if (s.status === 'paused') return { word: 'paused', tone: 'text-[color:var(--muted-2)]' }
  if (s.period === 'bought') return { word: 'bought this period', tone: 'text-emerald-400' }
  if (s.period === 'live') return { word: 'buy prepared — sign it', tone: 'text-[color:var(--accent)]' }
  return { word: 'due now', tone: 'text-amber-400' }
}

export default function JobsRailTab({ onAct }: { onAct?: () => void }) {
  const router = useRouter()
  const { setComposerPrefill, setJobDetail } = useYeetfulStore()
  const { jobs, schedules, signedOut, loaded } = useRunningWork(true)

  // A row's action lands in the composer — never auto-sends.
  const prefill = (prompt: string) => {
    setComposerPrefill(prompt)
    router.push('/chat')
    onAct?.()
  }

  // The row body opens the detail card (position, PnL, pending signatures).
  const openDetail = (detail: { type: 'job' | 'dca'; id: string }) => {
    setJobDetail(detail)
    onAct?.()
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-[color:var(--muted-2)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking what’s running…
      </div>
    )
  }

  if (signedOut) {
    return (
      <p className="px-3 py-6 text-center text-xs text-[color:var(--muted-2)]">
        Sign in with your wallet to see the jobs and recurring buys armed on it.
      </p>
    )
  }

  if (jobs.length === 0 && schedules.length === 0) {
    return (
      <p className="px-3 py-6 text-xs leading-relaxed text-[color:var(--muted-2)]">
        Nothing running yet. Recurring buys (“buy $10 of AAPL every week”) and
        multi-step jobs land here the moment you arm one — with every state
        visible, and nothing signed without you.
      </p>
    )
  }

  const ScheduleRow = ({ s }: { s: RunningSchedule }) => {
    const st = scheduleState(s)
    const chip = dcaRunChip({ id: s.id, buyUsd: s.buyUsd, buyToken: s.buyToken, cadence: s.cadence as DcaCadence })
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openDetail({ type: 'dca', id: s.id })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openDetail({ type: 'dca', id: s.id })
          }
        }}
        title="Open this recurring buy — what it's bought, your position, this period's state"
        className="px-2.5 py-2 rounded-xl hover:bg-[var(--surf-1)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted)]" aria-hidden />
          <span className="flex-1 min-w-0 text-xs font-medium truncate">
            ${s.buyUsd} {s.buyToken} · {cadenceLabel(s.cadence as DcaCadence)}
          </span>
          <span className={cn('text-[10px] mono whitespace-nowrap', st.tone)}>{st.word}</span>
        </div>
        <div className="ml-[22px] mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-[color:var(--muted-2)]">{s.chainName}</span>
          <span className="flex-1" />
          {s.status === 'active' && s.period === 'due' && (
            <button onClick={(e) => { e.stopPropagation(); prefill(chip.prompt) }} className="text-[10.5px] mono text-[color:var(--accent)] hover:underline">
              buy now
            </button>
          )}
          {s.status === 'active' ? (
            <button onClick={(e) => { e.stopPropagation(); prefill(`pause my ${s.buyToken} dca`) }} className="text-[10.5px] mono text-[color:var(--muted-2)] hover:text-white transition-colors">
              pause
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); prefill(`resume my ${s.buyToken} dca`) }} className="text-[10.5px] mono text-[color:var(--muted-2)] hover:text-white transition-colors">
              resume
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); prefill(`cancel my ${s.buyToken} dca`) }} className="text-[10.5px] mono text-[color:var(--muted-2)] hover:text-red-400 transition-colors">
            cancel
          </button>
        </div>
      </div>
    )
  }

  const JobRow = ({ j }: { j: RunningJob }) => {
    const doneCount = j.steps.filter((x) => x.status === 'done').length
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openDetail({ type: 'job', id: j.id })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openDetail({ type: 'job', id: j.id })
          }
        }}
        title="Open this job — your live position around it, every step, anything it needs from you"
        className="px-2.5 py-2 rounded-xl hover:bg-[var(--surf-1)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {jobDot(j.status)}
          <span className="flex-1 min-w-0 text-xs truncate" title={j.title}>
            {j.title}
          </span>
        </div>
        <div className="ml-[22px] mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--muted-2)]">
          <span className="mono">
            {doneCount}/{j.steps.length} · {jobStatusWord[j.status] ?? j.status}
          </span>
          {j.valueUsd != null && j.valueUsd > 0 && <span className="mono">${j.valueUsd.toFixed(2)}</span>}
          <span className="flex-1" />
          <span className="mono">{new Date(j.createdAt).toLocaleDateString()}</span>
        </div>
        {j.status === 'failed' && j.failReason && (
          <p className="ml-[22px] mt-0.5 text-[10px] leading-snug text-red-400/90 line-clamp-2">{j.failReason}</p>
        )}
      </div>
    )
  }

  const activeFirst = [...jobs].sort((a, b) => Number(LIVE_JOB_STATUS.has(b.status)) - Number(LIVE_JOB_STATUS.has(a.status)))

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3">
      {schedules.length > 0 && (
        <>
          <p className="px-2.5 pt-1 pb-1 text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)]">Recurring buys</p>
          {schedules.map((s) => (
            <ScheduleRow key={s.id} s={s} />
          ))}
        </>
      )}
      {activeFirst.length > 0 && (
        <>
          <p className="px-2.5 pt-2 pb-1 text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)]">Jobs</p>
          {activeFirst.map((j) => (
            <JobRow key={j.id} j={j} />
          ))}
        </>
      )}
      <p className="px-2.5 pt-2 text-[10px] leading-relaxed text-[color:var(--muted-2)] border-t border-[var(--line)] mt-2">
        Every buy is built fresh and signs from your wallet — schedules and jobs
        can never spend on their own.
      </p>
    </div>
  )
}
