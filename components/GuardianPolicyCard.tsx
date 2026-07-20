'use client'

// GuardianPolicyCard — a just-armed policy, live in the chat. Shows the one
// thing the user actually wants to watch: how far price is from the trigger,
// straight from the venue (never a cached guess), plus the guardian's
// heartbeat and what happened when it fired.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Pause, Play, ShieldCheck, ShieldOff } from 'lucide-react'
import ShareReceiptButton from '@/components/ShareReceiptButton'

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

  // The gauge: where the mark sits between the trigger (left, the danger end)
  // and the entry (right, the safe end). All live numbers straight from the
  // venue; renders only when both ends of the story exist. Without an entry
  // px the safe end is a fixed 15% window — the dot still moves honestly.
  const gauge = (() => {
    if (closed || live.markPx == null || live.triggerPx == null) return null
    const span =
      live.entryPx != null && Math.abs(live.entryPx - live.triggerPx) > 1e-12
        ? Math.abs(live.entryPx - live.triggerPx)
        : Math.abs(live.triggerPx) * 0.15
    if (span <= 0) return null
    const f = Math.min(1, Math.abs(live.markPx - live.triggerPx) / span)
    return { f, hasEntry: live.entryPx != null, hot: distancePct != null && Math.abs(distancePct) < 1 }
  })()

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
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              p.status === 'active'
                ? 'border-emerald-500/40 text-emerald-400'
                : closed
                  ? 'border-sky-500/40 text-sky-400'
                  : 'border-[color:var(--line-2)] text-[color:var(--muted-2)]'
            }`}
          >
            {p.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />}
            {closed ? 'closed by guardian' : p.status === 'active' ? 'watching' : p.status}
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

      {/* the watch gauge — trigger on the left (danger end), entry on the
          right; the dot is the live mark. This is the card's whole job in
          one glance: how close is the guardian to acting. */}
      {gauge && (
        <div className="pt-0.5">
          <div className="relative h-1.5 rounded-full overflow-visible"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, #f87171 30%, transparent), color-mix(in srgb, #f59e0b 16%, transparent) 35%, color-mix(in srgb, var(--fg) 7%, transparent) 75%)',
            }}
          >
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${Math.min(97, Math.max(3, gauge.f * 100))}%` }}
            >
              {p.status === 'active' && (
                <span
                  className={`absolute inset-0 rounded-full animate-ping ${gauge.hot ? 'bg-amber-400/50' : ''}`}
                  style={gauge.hot ? undefined : { background: 'color-mix(in srgb, var(--accent) 45%, transparent)' }}
                  aria-hidden
                />
              )}
              <span
                className={`relative block w-2.5 h-2.5 rounded-full border-2 border-[var(--bg)] ${gauge.hot ? 'bg-amber-400' : 'bg-[var(--accent)]'}`}
                aria-hidden
              />
            </span>
          </div>
          <div className="flex justify-between pt-1 text-[10px] mono text-[color:var(--muted-2)]">
            <span>trigger {live.triggerPx != null ? Number(live.triggerPx.toPrecision(5)) : ''}</span>
            {gauge.hasEntry && live.entryPx != null && <span>entry {Number(live.entryPx.toPrecision(5))}</span>}
          </div>
        </div>
      )}

      <div className="text-[12px] text-[color:var(--muted)] mono tabular-nums">
        {closed && lastRun ? (
          <>filled — {lastRun.reason.slice(0, 120)}{lastRun.valueUsd != null && <> · ${lastRun.valueUsd.toFixed(2)} moved</>}</>
        ) : live.markPx != null ? (
          <>
            mark {live.markPx}
            {distancePct != null && (
              <span className={Math.abs(distancePct) < 1 ? ' text-amber-400' : ''}>
                {' '}· {Math.abs(distancePct).toFixed(2)}% from trigger
              </span>
            )}
          </>
        ) : p.delegationStatus !== 'active' ? (
          <span className="inline-flex items-center gap-1"><ShieldOff className="w-3 h-3" aria-hidden /> delegation inactive</span>
        ) : (
          'watching…'
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-[color:var(--muted-2)]">
          Checked every minute · every action receipted on the{' '}
          <Link href="/dashboard/guardian" className="underline underline-offset-2 decoration-dotted">
            Guardian dashboard
          </Link>
          {p.lastChecked && <> · last check {new Date(p.lastChecked).toLocaleTimeString()}</>}
        </span>
        {/* an armed (or fired) protection is a receipt worth showing off */}
        <ShareReceiptButton kind="guardian" refId={p.id} />
      </div>
    </div>
  )
}
