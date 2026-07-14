'use client'

// GuardianPolicyCard — a just-armed policy, live in the chat. Shows the one
// thing the user actually wants to watch: how far price is from the trigger,
// straight from the venue (never a cached guess), plus the guardian's
// heartbeat and what happened when it fired.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Pause, Play, ShieldCheck, ShieldOff } from 'lucide-react'

interface PolicyView {
  policy: {
    id: string
    coin: string
    side: string
    kind: string
    triggerMode: string
    triggerValue: number
    status: string
    lastChecked: string | null
    delegationStatus: string
  }
  live: { markPx: number | null; entryPx: number | null; triggerPx: number | null }
  lastRun: { action: string; reason: string; valueUsd: number | null; createdAt: string } | null
}

const WATCHING = new Set(['active', 'paused', 'triggered'])

export default function GuardianPolicyCard({ policyId }: { policyId: string }) {
  const [view, setView] = useState<PolicyView | null>(null)
  const [gone, setGone] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guardian/policies/${policyId}`, { cache: 'no-store' })
      if (!res.ok) {
        if (res.status === 404) setGone(true)
        return
      }
      setView((await res.json()) as PolicyView)
    } catch {
      /* keep last state */
    }
  }, [policyId])

  useEffect(() => {
    void load()
    timer.current = setInterval(() => void load(), 30_000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  useEffect(() => {
    if (view && !WATCHING.has(view.policy.status) && timer.current) clearInterval(timer.current)
  }, [view])

  const setStatus = async (status: 'active' | 'paused') => {
    await fetch(`/api/guardian/policies/${policyId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {})
    void load()
  }

  if (gone) return null
  if (!view) {
    return (
      <div className="mt-2.5 rounded-xl border border-[var(--line)] px-3 py-2 text-[12px] text-[color:var(--muted-2)] inline-flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> arming…
      </div>
    )
  }

  const { policy: p, live, lastRun } = view
  const kindLabel = p.kind === 'stop_loss' ? 'Stop-loss' : 'Take-profit'
  const distancePct =
    live.markPx != null && live.triggerPx != null && live.markPx > 0
      ? ((live.triggerPx - live.markPx) / live.markPx) * 100
      : null
  const closed = p.status === 'done' && lastRun?.action === 'closed'

  return (
    <div className="mt-2.5 rounded-xl border border-[var(--line)] px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-2 text-[12.5px]">
          <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${p.status === 'active' ? 'text-emerald-400' : 'text-[color:var(--muted-2)]'}`} aria-hidden />
          <span className="font-medium">
            {kindLabel} · {p.coin} {p.side}
          </span>
          <span className="mono text-[11px] text-[color:var(--muted-2)]">
            {p.triggerMode === 'price' ? `@ ${p.triggerValue}` : `${p.triggerValue}% from entry`}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              p.status === 'active'
                ? 'border-emerald-500/40 text-emerald-400'
                : closed
                  ? 'border-sky-500/40 text-sky-400'
                  : 'border-[color:var(--line-2)] text-[color:var(--muted-2)]'
            }`}
          >
            {closed ? 'closed by guardian' : p.status}
          </span>
          {p.status === 'active' && (
            <button onClick={() => void setStatus('paused')} title="Pause" className="text-[color:var(--muted-2)] hover:text-[color:var(--fg)]">
              <Pause className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
          {p.status === 'paused' && (
            <button onClick={() => void setStatus('active')} title="Resume" className="text-[color:var(--muted-2)] hover:text-[color:var(--fg)]">
              <Play className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </span>
      </div>

      <div className="text-[12px] text-[color:var(--muted)] mono tabular-nums">
        {closed && lastRun ? (
          <>filled — {lastRun.reason.slice(0, 120)}{lastRun.valueUsd != null && <> · ${lastRun.valueUsd.toFixed(2)} moved</>}</>
        ) : live.markPx != null ? (
          <>
            mark {live.markPx}
            {live.triggerPx != null && <> · trigger {Number(live.triggerPx.toPrecision(5))}</>}
            {distancePct != null && (
              <span className={Math.abs(distancePct) < 1 ? ' text-amber-400' : ''}>
                {' '}· {Math.abs(distancePct).toFixed(2)}% away
              </span>
            )}
          </>
        ) : p.delegationStatus !== 'active' ? (
          <span className="inline-flex items-center gap-1"><ShieldOff className="w-3 h-3" aria-hidden /> delegation inactive</span>
        ) : (
          'watching…'
        )}
      </div>

      <div className="text-[11px] text-[color:var(--muted-2)]">
        Checked every minute · every action receipted on the{' '}
        <Link href="/dashboard/guardian" className="underline underline-offset-2 decoration-dotted">
          Guardian dashboard
        </Link>
        {p.lastChecked && <> · last check {new Date(p.lastChecked).toLocaleTimeString()}</>}
      </div>
    </div>
  )
}
