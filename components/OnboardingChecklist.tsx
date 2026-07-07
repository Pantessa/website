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

interface EmbedSignal {
  keys: number
  turns: number
  deadEnds: number
}

export default function OnboardingChecklist({ stats }: { stats: Stats }) {
  const [embed, setEmbed] = useState<EmbedSignal | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      /* storage blocked — just show it */
    }
  }, [])

  // The pivot journey ticks off live embed analytics: minted a key → the chat
  // took real turns → you acted on the dead-ends (self-heal).
  useEffect(() => {
    fetch('/api/embeds/insights', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setEmbed({
          keys: d?.keys?.length ?? 0,
          turns: d?.totals?.turns ?? 0,
          deadEnds: d?.totals?.deadEndSessions ?? 0,
        }),
      )
      .catch(() => setEmbed({ keys: 0, turns: 0, deadEnds: 0 }))
  }, [])

  const e = embed ?? { keys: 0, turns: 0, deadEnds: 0 }
  const steps = [
    {
      label: 'Mount the chat on your site',
      hint: 'Mint an embed key above, drop in five lines, and compose a few MCPs.',
      done: e.keys > 0,
      href: '/docs/embed',
      cta: 'Get the snippet',
    },
    {
      label: 'See what your visitors ask',
      hint: 'Every turn is recorded — asks, outcomes, the transactions it built.',
      done: e.turns > 0,
      href: '/dashboard/embeds',
      cta: 'View insights',
    },
    {
      label: 'Improve your MCPs from real asks',
      hint: 'Dead-end asks become a Claude Code upgrade prompt — the self-heal loop.',
      done: e.turns > 0 && e.deadEnds === 0,
      href: '/health',
      cta: 'Check MCP health',
    },
    {
      label: 'Let your own agent pay (optional)',
      hint: 'Wire the yeetful SDK so an agent can pay per call under a spend cap.',
      done: (stats.agents?.connected ?? 0) > 0,
      href: '/docs/quickstart',
      cta: 'Read quickstart',
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
            {completed} of {steps.length} done — from mounting the chat to healing your MCPs from
            real usage.
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
