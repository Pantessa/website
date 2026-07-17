'use client'

// One hook answering "what's running on this wallet right now?" — jobs
// (multi-step runs) + DCA schedules (recurring buys) + guardian protections
// (autonomous stop-loss/take-profit), polled gently while a surface shows
// them. Both the rail's Jobs tab and the collapsed JOBS chip use it; at most
// one instance of each mounts at a time, so the poll load stays at a few
// light GETs per interval.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RunningJob {
  id: string
  title: string
  status: string
  valueUsd: number | null
  failReason: string | null
  createdAt: string
  steps: { seq: number; kind: string; status: string; title: string }[]
}

export interface RunningSchedule {
  id: string
  status: string
  cadence: 'day' | 'week' | 'month'
  buyUsd: number
  buyToken: string
  sellToken: string
  chainId: number
  chainName: string
  period: 'due' | 'live' | 'bought'
  liveJobId: string | null
}

export interface RunningGuard {
  id: string
  coin: string
  side: string // long | short
  kind: string // stop_loss | take_profit
  triggerMode: string // price_move_pct | price
  triggerValue: number
  status: string // active | paused | triggered | error
  lastChecked: string | null
  createdAt: string
}

/** Job statuses that count as "running now" (the badge's numerator). */
export const LIVE_JOB_STATUS = new Set(['running', 'waiting_signature', 'waiting_settlement'])

export function useRunningWork(enabled: boolean, intervalMs = 15_000) {
  const [jobs, setJobs] = useState<RunningJob[]>([])
  const [schedules, setSchedules] = useState<RunningSchedule[]>([])
  const [guards, setGuards] = useState<RunningGuard[]>([])
  const [signedOut, setSignedOut] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [jr, sr, gr] = await Promise.all([
        fetch('/api/jobs', { cache: 'no-store' }),
        fetch('/api/dca', { cache: 'no-store' }),
        fetch('/api/guardian/policies', { cache: 'no-store' }),
      ])
      if (jr.status === 401 || sr.status === 401) {
        setSignedOut(true)
        setLoaded(true)
        return
      }
      setSignedOut(false)
      if (jr.ok) setJobs(((await jr.json()) as { jobs: RunningJob[] }).jobs ?? [])
      if (sr.ok) setSchedules(((await sr.json()) as { schedules: RunningSchedule[] }).schedules ?? [])
      if (gr.ok) setGuards(((await gr.json()) as { policies: RunningGuard[] }).policies ?? [])
      setLoaded(true)
    } catch {
      /* transient miss — keep the last state */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    timer.current = setInterval(() => void refresh(), intervalMs)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [enabled, intervalMs, refresh])

  const activeJobs = jobs.filter((j) => LIVE_JOB_STATUS.has(j.status))
  // A schedule "needs you" when this period's buy is due or already prepared
  // and unsigned. Paused schedules keep their rows but never nag the badge.
  const needsYou = schedules.filter((s) => s.status === 'active' && s.period !== 'bought')
  // Guardians are set-and-forget: an active protection is healthy standing
  // state, so it never nags the badge — only an errored one does.
  const guardAlerts = guards.filter((g) => g.status === 'error')
  return { jobs, schedules, guards, activeJobs, badgeCount: activeJobs.length + needsYou.length + guardAlerts.length, signedOut, loaded, refresh }
}
