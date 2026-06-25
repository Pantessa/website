'use client'

// First-run "Get started" checklist on the dashboard Overview. Turns a blank
// account into a guided path to the first paid call and first earnings. Each
// step's done-state is read from live data (the stats the Overview already
// loaded + a light earnings fetch), so it ticks off on its own. Hides once
// everything's done or the user dismisses it.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { Card, type Stats } from '@/lib/dashboard-ui'

const DISMISS_KEY = 'yf_onboarding_dismissed'

export default function OnboardingChecklist({ stats }: { stats: Stats }) {
  const [earnCalls, setEarnCalls] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      /* storage blocked — just show it */
    }
  }, [])

  useEffect(() => {
    fetch('/api/dashboard/earnings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEarnCalls(d?.kpis?.callsServed ?? 0))
      .catch(() => setEarnCalls(0))
  }, [])

  const steps = [
    {
      label: 'Approve an agent',
      hint: 'Pick the MCP services your wallet is allowed to pay.',
      done: (stats.grant?.allowCount ?? 0) > 0,
      href: '/dashboard/approvals',
      cta: 'Approve',
    },
    {
      label: 'Connect an agent',
      hint: 'Mint an API key — that key is your agent.',
      done: (stats.agents?.connected ?? 0) > 0,
      href: '/dashboard/keys',
      cta: 'Mint a key',
    },
    {
      label: 'Run your first paid call',
      hint: 'Fund your wallet, then ask the router anything.',
      done: (stats.kpis?.calls ?? 0) > 0,
      href: '/chat',
      cta: 'Open chat',
    },
    {
      label: 'Connect an MCP to earn',
      hint: 'Report paid calls from your own MCP and earn per call.',
      done: (earnCalls ?? 0) > 0,
      href: '/docs/earn',
      cta: 'Start earning',
    },
  ]

  const completed = steps.filter((s) => s.done).length
  const allDone = completed === steps.length
  if (dismissed || allDone) return null

  const next = steps.find((s) => !s.done)

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Get started</p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            {completed} of {steps.length} done — a few steps to your first paid call and first
            earnings.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss the getting-started checklist"
          className="flex-shrink-0 -mr-1 -mt-1 p-1 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-400 transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ul className="mt-3 divide-y divide-white/5">
        {steps.map((s) => {
          const isNext = next === s
          return (
            <li key={s.label} className="flex items-center gap-2.5 py-2 min-h-11">
              {s.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-[color:var(--muted-2)] flex-shrink-0" />
              )}
              <span className="min-w-0">
                <span className={s.done ? 'text-xs text-[color:var(--muted-2)] line-through' : 'text-xs text-white'}>
                  {s.label}
                </span>
                {isNext && <span className="block text-[11px] text-[color:var(--muted-2)] mt-0.5">{s.hint}</span>}
              </span>
              {isNext && (
                <Link
                  href={s.href}
                  className="ml-auto flex-shrink-0 inline-flex items-center text-xs font-medium px-3 py-1.5 max-lg:min-h-11 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  {s.cta} →
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
