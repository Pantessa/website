'use client'

// The job detail card. Clicking a job (or recurring buy) in the rail opens
// this overlay instead of dumping the user into the composer: the user's
// LIVE position around the job (PnL, stake, health factor, holdings — from
// /api/jobs/[id]/context), the one line the job needs them to know (a step
// waiting on their signature, a due period), and the job's own step card
// with its embedded sign buttons. Any job kind: the context endpoint derives
// from the steps' builders, and unknown builders still get the generic rows.
//
// Schedule (DCA) actions keep the rail's contract: they PREFILL the composer
// and close — the user always sends and signs themselves.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarClock, ListChecks, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { cadenceLabel, dcaRunChip, type DcaCadence } from '@/lib/dca'
import JobCard from '@/components/JobCard'

interface ContextRow {
  label: string
  value: string
  sub?: string
  tone?: 'pos' | 'neg'
}

interface JobContext {
  headline?: { value: string; caption: string; tone?: 'pos' | 'neg' }
  rows: ContextRow[]
  note?: string
}

interface ScheduleView {
  id: string
  status: string
  cadence: DcaCadence
  buyUsd: number
  buyToken: string
  chainName: string
  period: 'due' | 'live' | 'bought'
  liveJobId: string | null
}

const toneClass = (tone?: 'pos' | 'neg') =>
  tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-[color:var(--fg)]'

function ContextBlock({ context, loading }: { context: JobContext | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-[color:var(--muted-2)]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading your live position…
      </div>
    )
  }
  if (!context) return null
  return (
    <div className="space-y-2">
      {context.headline && (
        <div className="pb-1">
          <div className={cn('text-2xl font-semibold tracking-tight', toneClass(context.headline.tone))}>
            {context.headline.value}
          </div>
          <div className="text-[11px] text-[color:var(--muted-2)]">{context.headline.caption}</div>
        </div>
      )}
      {context.rows.length > 0 && (
        <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
          {context.rows.map((row, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[12px] text-[color:var(--fg)] truncate">{row.label}</div>
                {row.sub && <div className="text-[10.5px] text-[color:var(--muted-2)] truncate">{row.sub}</div>}
              </div>
              <div className={cn('mono text-[12px] whitespace-nowrap', toneClass(row.tone))}>{row.value}</div>
            </div>
          ))}
        </div>
      )}
      {context.note && (
        <p className="text-[11.5px] leading-relaxed text-[color:var(--muted)]">{context.note}</p>
      )}
    </div>
  )
}

export default function JobDetailOverlay() {
  const router = useRouter()
  const { jobDetail, setJobDetail, setComposerPrefill } = useYeetfulStore()
  const [context, setContext] = useState<JobContext | null>(null)
  const [schedule, setSchedule] = useState<ScheduleView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const close = useCallback(() => setJobDetail(null), [setJobDetail])

  // A schedule action lands in the composer — never auto-sends.
  const prefill = (prompt: string) => {
    setComposerPrefill(prompt)
    close()
    router.push('/chat')
  }

  const loadContext = useCallback(async () => {
    if (!jobDetail) return
    setLoading(true)
    setError('')
    try {
      const url = jobDetail.type === 'job' ? `/api/jobs/${jobDetail.id}/context` : `/api/dca/${jobDetail.id}/context`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        setError(res.status === 401 ? 'Sign in to see this.' : 'Could not load the details.')
        return
      }
      const data = (await res.json()) as { context: JobContext; schedule?: ScheduleView }
      setContext(data.context ?? null)
      setSchedule(data.schedule ?? null)
    } catch {
      setError('Could not load the details.')
    } finally {
      setLoading(false)
    }
  }, [jobDetail])

  // Fresh snapshot per open (state also resets so a previous job's numbers
  // never flash under a new title).
  useEffect(() => {
    setContext(null)
    setSchedule(null)
    if (jobDetail) void loadContext()
  }, [jobDetail, loadContext])

  // Esc closes.
  useEffect(() => {
    if (!jobDetail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jobDetail, close])

  if (typeof document === 'undefined') return null

  const chip = schedule ? dcaRunChip({ id: schedule.id, buyUsd: schedule.buyUsd, buyToken: schedule.buyToken, cadence: schedule.cadence }) : null

  return createPortal(
    <AnimatePresence>
      {jobDetail && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-[10vh]"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={jobDetail.type === 'dca' ? 'Recurring buy details' : 'Job details'}
            className="jobdetail__panel w-full max-w-lg rounded-2xl border border-[var(--line-2)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-[var(--line)]">
              {jobDetail.type === 'dca' ? (
                <CalendarClock className="w-4 h-4 text-[color:var(--muted)]" aria-hidden />
              ) : (
                <ListChecks className="w-4 h-4 text-[color:var(--muted)]" aria-hidden />
              )}
              <span className="flex-1 text-[13px] font-medium truncate">
                {jobDetail.type === 'dca'
                  ? schedule
                    ? `$${schedule.buyUsd} → ${schedule.buyToken} ${cadenceLabel(schedule.cadence)} on ${schedule.chainName}`
                    : 'Recurring buy'
                  : 'Job'}
              </span>
              <button
                onClick={close}
                aria-label="Close"
                className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              {error && <p className="text-[12px] text-[color:var(--muted-2)]">{error}</p>}
              <ContextBlock context={context} loading={loading} />

              {/* schedule actions — the rail's prefill contract */}
              {jobDetail.type === 'dca' && schedule && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {schedule.status === 'active' && schedule.period === 'due' && chip && (
                    <button
                      onClick={() => prefill(chip.prompt)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--line-2)] text-[11px] font-medium text-[color:var(--accent)] hover:bg-white/[0.04] transition-colors"
                    >
                      {chip.label}
                    </button>
                  )}
                  {schedule.status === 'active' ? (
                    <button
                      onClick={() => prefill(`pause my ${schedule.buyToken} dca`)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-white transition-colors"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      onClick={() => prefill(`resume my ${schedule.buyToken} dca`)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-white transition-colors"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    onClick={() => prefill(`cancel my ${schedule.buyToken} dca`)}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-[11px] text-[color:var(--muted)] hover:text-red-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* the job's own live card — steps, sign buttons, cancel/retry.
                  A signed step refreshes the position block (the numbers just
                  changed). For a schedule, this is the period's live job. */}
              {jobDetail.type === 'job' && (
                <JobCard jobId={jobDetail.id} onStepSigned={() => void loadContext()} />
              )}
              {jobDetail.type === 'dca' && schedule?.liveJobId && (
                <JobCard jobId={schedule.liveJobId} onStepSigned={() => void loadContext()} />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
