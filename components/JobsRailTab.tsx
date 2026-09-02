'use client'

// The rail's Jobs tab — every standing thing on this wallet, in one glance:
// guardian protections (autonomous stop-loss/take-profit), recurring buys
// (DCA schedules) with their current-period state, then jobs (multi-step
// runs) newest-first. Born from a real confusion: a schedule armed in chat
// was invisible afterwards, so "you already have a weekly buy" read as
// "something bought itself". This tab is the standing answer.
//
// Row actions are ICON BUTTONS that act DIRECTLY (Nate 2026-07-28: the
// prefill detour made "cancel" look like it did nothing, and the verb row
// read dense) — pause/resume/trash hit their owner-gated API and the list
// refreshes on the spot; trash confirms first (the guardian-remove rule:
// one misclick never silently unprotects/retires anything). Only "buy now"
// still routes through the composer — it opens a signable buy, and the
// signature is the user's anyway.
// Clicking the row BODY opens the job detail card (store.jobDetail): the
// live position/PnL around the job + its step card — for any job kind.

import { CalendarClock, CheckCircle2, Inbox as InboxIcon, Loader2, Pause, PenLine, Play, ShieldCheck, Trash2, XCircle, ZapOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { declineCard } from '@/lib/decline-client'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { cadenceLabel, dcaRunChip, type DcaCadence } from '@/lib/dca'
import ShareReceiptButton from '@/components/ShareReceiptButton'
import { ChartHoverButton } from '@/components/TokenChartButton'
import { LIVE_JOB_STATUS, useRunningWork, type InboxIntent, type RunningGuard, type RunningJob, type RunningSchedule } from '@/lib/use-running-work'
import { jobStatusWord } from '@/lib/step-status'

function IconBtn({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={label}
      aria-label={label}
      className={cn(
        'grid h-6 w-6 place-items-center rounded-md text-[color:var(--muted-2)] transition-colors',
        danger ? 'hover:text-[color:var(--fail)] hover:bg-[color:color-mix(in_srgb,var(--fail)_10%,transparent)]' : 'hover:text-white hover:bg-[var(--surf-1)]',
      )}
    >
      {children}
    </button>
  )
}

function jobDot(status: string) {
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--done)] flex-shrink-0" aria-hidden />
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-[color:var(--fail)] flex-shrink-0" aria-hidden />
  if (status === 'waiting_signature') return <PenLine className="w-3.5 h-3.5 text-[color:var(--accent)] flex-shrink-0" aria-hidden />
  if (LIVE_JOB_STATUS.has(status)) return <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--muted)] flex-shrink-0" aria-hidden />
  return <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--muted-2)] flex-shrink-0" aria-hidden />
}

function scheduleState(s: RunningSchedule): { word: string; tone: string } {
  if (s.status === 'paused') return { word: 'paused', tone: 'text-[color:var(--muted-2)]' }
  // Autopilot rows mirror the guardian doctrine: a HEALTHY armed schedule
  // never nags — only an error reads as needs-you.
  if (s.mode === 'auto') {
    if (s.autoError) return { word: 'autopilot — needs you', tone: 'text-[color:var(--fail)]' }
    if (s.period === 'bought') return { word: 'autopilot — bought this period', tone: 'text-[color:var(--done)]' }
    return { word: 'autopilot — armed', tone: 'text-[color:var(--done)]' }
  }
  if (s.period === 'bought') return { word: 'bought this period', tone: 'text-[color:var(--done)]' }
  if (s.period === 'live') return { word: 'buy prepared — sign it', tone: 'text-[color:var(--accent)]' }
  return { word: 'due now', tone: 'text-amber-400' }
}

function guardState(g: RunningGuard): { word: string; tone: string } {
  if (g.status === 'active') return { word: 'watching', tone: 'text-[color:var(--done)]' }
  if (g.status === 'paused') return { word: 'paused', tone: 'text-[color:var(--muted-2)]' }
  if (g.status === 'triggered') return { word: 'fired — closing', tone: 'text-[color:var(--accent)]' }
  return { word: g.status, tone: 'text-[color:var(--fail)]' }
}

function guardLabel(g: RunningGuard): string {
  const kind = g.kind === 'stop_loss' ? 'Stop-loss' : 'Take-profit'
  return `${kind} · ${g.coin} ${g.side}`
}

export default function JobsRailTab({ onAct }: { onAct?: () => void }) {
  const router = useRouter()
  const { setComposerPrefill, setJobDetail } = useYeetfulStore()
  const { jobs, schedules, guards, inbox, signedOut, loaded, refresh } = useRunningWork(true)
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  // Declined cards vanish immediately (the poll confirms within 15s); the
  // set keeps a mid-poll ghost from flashing back.
  const [declinedSlugs, setDeclinedSlugs] = useState<Set<string>>(new Set())
  const [decliningSlug, setDecliningSlug] = useState<string | null>(null)
  const declineInbox = async (slug: string) => {
    if (!address || decliningSlug) return
    setDecliningSlug(slug)
    try {
      await declineCard(slug, address, signMessageAsync)
      setDeclinedSlugs((s) => new Set(s).add(slug))
      refresh()
    } catch {
      /* refusal shown by the wallet/server dialog path; the card stays */
    } finally {
      setDecliningSlug(null)
    }
  }

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

  // Intents ADDRESSED to the connected wallet (M5) — the U1 receiving moment.
  // One tap opens the guarded /i runtime; the signature is the only gate. The
  // section renders even signed-out: the inbox rides connect-to-act (#553),
  // so a connected-but-unsigned wallet still sees what arrived for it.
  const InboxSection = () =>
    inbox.filter((it) => !declinedSlugs.has(it.slug)).length === 0 ? null : (
      <>
        <p className="px-2.5 pt-1 pb-1 text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)]">For you</p>
        {inbox.filter((it) => !declinedSlugs.has(it.slug)).map((it: InboxIntent) => (
          <div
            key={it.slug}
            role="button"
            tabIndex={0}
            onClick={() => {
              router.push(`/i/${it.slug}`)
              onAct?.()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                router.push(`/i/${it.slug}`)
                onAct?.()
              }
            }}
            className="group w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5"
          >
            <span className="flex items-start gap-2">
              <InboxIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[color:var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{it.ask}</span>
                {/* THE ROSTER (R2): a hired agent's proposal wears its
                    mandate badge — the card says WHICH mandate is speaking.
                    Canonical DB-stored text only (T2). */}
                {it.roster && (
                  <span className="mt-0.5 block truncate text-[10px]">
                    <span className="mono uppercase tracking-wider text-[color:var(--accent)]">{it.roster.label}</span>
                    <span className="text-[color:var(--muted-2)]">{` · "${it.roster.mandate}" · $${it.roster.capUsd} cap`}</span>
                  </span>
                )}
                <span className="block text-[10px] text-[color:var(--muted-2)]">
                  {/* JS string, not JSX text: the SWC entity-space bug ate the
                      space before "·" when this read `&amp;` (rendered
                      "Risk Bot· tap"). */}
                  {it.from ? `from ${it.from}` : it.roster ? 'from your hired agent' : 'addressed to this wallet'}
                  {' · tap to review & sign'}
                </span>
              </span>
              {/* The DECLINE verb (doors run) — before this, an ignored card
                  blocked its manager forever (the one-card fence). One tap:
                  session declines silently; otherwise one personal_sign over
                  the server's own consent bytes. Never benches the agent. */}
              <IconBtn
                label="Decline — the card leaves your inbox; the sender sees 'declined', not silence"
                danger
                onClick={() => void declineInbox(it.slug)}
              >
                {decliningSlug === it.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              </IconBtn>
            </span>
          </div>
        ))}
      </>
    )

  if (signedOut) {
    return (
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <InboxSection />
        <p className="px-3 py-6 text-center text-xs text-[color:var(--muted-2)]">
          Sign in with your wallet to see the jobs and recurring buys armed on it.
        </p>
      </div>
    )
  }

  if (jobs.length === 0 && schedules.length === 0 && guards.length === 0 && inbox.length === 0) {
    return (
      <p className="px-3 py-6 text-xs leading-relaxed text-[color:var(--muted-2)]">
        Nothing running yet. Recurring buys (“buy $10 of AAPL every week”),
        protections (“protect my SYRUP long with a 10% stop loss”) and
        multi-step jobs land here the moment you arm one — with every state
        visible, and nothing signed without you.
      </p>
    )
  }

  // Protections are the only rows whose actions hit their API directly
  // (pause/resume/remove — same owner-gated PATCH/DELETE the chat card
  // uses); there's nothing to compose or sign, so no prefill detour.
  const setGuardStatus = async (id: string, status: 'active' | 'paused') => {
    await fetch(`/api/guardian/policies/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {})
    void refresh()
  }
  // One misclick must never silently unprotect a leveraged position.
  const removeGuard = async (g: RunningGuard) => {
    if (!window.confirm(`Remove the ${guardLabel(g).toLowerCase()}? The position stays open with no protection.`)) return
    await fetch(`/api/guardian/policies/${g.id}`, { method: 'DELETE' }).catch(() => {})
    void refresh()
  }

  const GuardRow = ({ g }: { g: RunningGuard }) => {
    const st = guardState(g)
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => { router.push('/dashboard/guardian'); onAct?.() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            router.push('/dashboard/guardian')
            onAct?.()
          }
        }}
        title="Open the Guardian dashboard — live trigger distance and every check receipt"
        className="px-2.5 py-2 rounded-xl hover:bg-[var(--surf-1)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className={cn('w-3.5 h-3.5 flex-shrink-0', g.status === 'active' ? 'text-[color:var(--done)]' : 'text-[color:var(--muted-2)]')} aria-hidden />
          <span className="flex-1 min-w-0 text-xs font-medium truncate">{guardLabel(g)}</span>
          <span className={cn('text-[10px] mono whitespace-nowrap', st.tone)}>{st.word}</span>
        </div>
        <div className="ml-[22px] mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-[color:var(--muted-2)] mono">
            {g.triggerMode === 'price' ? `@ ${g.triggerValue}` : `${g.triggerValue}% from entry`} · checked every minute
          </span>
          <span className="flex-1" />
          {g.status === 'active' && (
            <IconBtn label="Pause this protection" onClick={() => void setGuardStatus(g.id, 'paused')}><Pause className="h-3 w-3" /></IconBtn>
          )}
          {g.status === 'paused' && (
            <IconBtn label="Resume watching" onClick={() => void setGuardStatus(g.id, 'active')}><Play className="h-3 w-3" /></IconBtn>
          )}
          {g.status !== 'triggered' && (
            <IconBtn label="Remove this protection" danger onClick={() => void removeGuard(g)}><Trash2 className="h-3 w-3" /></IconBtn>
          )}
        </div>
      </div>
    )
  }

  // Schedule manage — same direct-API pattern as protections; cancel is
  // terminal so it confirms first, and the refreshed list drops the row
  // (the GET only returns active|paused).
  const manageSchedule = async (id: string, op: 'pause' | 'resume' | 'cancel') => {
    await fetch(`/api/dca/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op }),
    }).catch(() => {})
    void refresh()
  }
  const cancelSchedule = async (s: RunningSchedule) => {
    if (!window.confirm(`Cancel the $${s.buyUsd} ${s.buyToken} ${cadenceLabel(s.cadence as DcaCadence)} buy? This retires the schedule.`)) return
    await manageSchedule(s.id, 'cancel')
  }
  const disarmAutopilot = async (s: RunningSchedule) => {
    if (!window.confirm(`Turn off autopilot for the $${s.buyUsd} ${s.buyToken} buy? It drops back to confirm-mode — you sign each period again.`)) return
    await fetch(`/api/dca/${s.id}/arm`, { method: 'DELETE' }).catch(() => {})
    void refresh()
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
        className="group px-2.5 py-2 rounded-xl hover:bg-[var(--surf-1)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--muted)]" aria-hidden />
          <span className="flex-1 min-w-0 text-xs font-medium truncate">
            ${s.buyUsd} {s.buyToken} · {cadenceLabel(s.cadence as DcaCadence)}
          </span>
          <ChartHoverButton symbol={s.buyToken} />
          <span className={cn('text-[10px] mono whitespace-nowrap', st.tone)}>{st.word}</span>
        </div>
        <div className="ml-[22px] mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-[color:var(--muted-2)]">{s.chainName}</span>
          <span className="flex-1" />
          {s.status === 'active' && s.period === 'due' && s.mode !== 'auto' && (
            <button onClick={(e) => { e.stopPropagation(); prefill(chip.prompt) }} className="text-[10.5px] mono text-[color:var(--accent)] hover:underline">
              buy now
            </button>
          )}
          {s.status === 'active' && s.mode === 'auto' && (
            <IconBtn label="Turn off autopilot (back to confirm-mode)" onClick={() => void disarmAutopilot(s)}><ZapOff className="h-3 w-3" /></IconBtn>
          )}
          {s.status === 'active' ? (
            <IconBtn label="Pause this recurring buy" onClick={() => void manageSchedule(s.id, 'pause')}><Pause className="h-3 w-3" /></IconBtn>
          ) : (
            <IconBtn label="Resume this recurring buy" onClick={() => void manageSchedule(s.id, 'resume')}><Play className="h-3 w-3" /></IconBtn>
          )}
          <IconBtn label="Cancel this recurring buy" danger onClick={() => void cancelSchedule(s)}><Trash2 className="h-3 w-3" /></IconBtn>
          {/* a standing order is the product's best receipt — one tap out */}
          <ShareReceiptButton kind="dca" refId={s.id} />
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
            {doneCount}/{j.steps.length} · {jobStatusWord(j.status)}
          </span>
          {j.valueUsd != null && j.valueUsd > 0 && <span className="mono">${j.valueUsd.toFixed(2)}</span>}
          <span className="flex-1" />
          <span className="mono">{new Date(j.createdAt).toLocaleDateString()}</span>
        </div>
        {/* The same progress object the JobCard breathes — a rail row is the
            card at a distance, not a different species. */}
        <div className={cn('yprog ml-[22px] mt-1.5', j.status === 'failed' && 'yprog--fail', j.status === 'done' && 'yprog--full')}>
          <div className="yprog__fill" style={{ width: `${j.steps.length ? (doneCount / j.steps.length) * 100 : 0}%` }} />
        </div>
        {j.status === 'failed' && j.failReason && (
          <p className="ml-[22px] mt-0.5 text-[10px] leading-snug text-[color:var(--fail)] line-clamp-2">{j.failReason}</p>
        )}
      </div>
    )
  }

  const activeFirst = [...jobs].sort((a, b) => Number(LIVE_JOB_STATUS.has(b.status)) - Number(LIVE_JOB_STATUS.has(a.status)))

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-3">
      <InboxSection />
      {guards.length > 0 && (
        <>
          <p className={cn('px-2.5 pb-1 text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)]', inbox.length > 0 ? 'pt-2' : 'pt-1')}>Protections</p>
          {guards.map((g) => (
            <GuardRow key={g.id} g={g} />
          ))}
        </>
      )}
      {schedules.length > 0 && (
        <>
          <p className={cn('px-2.5 pb-1 text-[10px] mono uppercase tracking-wider text-[color:var(--muted-2)]', guards.length > 0 ? 'pt-2' : 'pt-1')}>Recurring buys</p>
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
        can never spend on their own. Protections can only close the position
        they guard (reduce-only), never open or move funds.
      </p>
    </div>
  )
}
