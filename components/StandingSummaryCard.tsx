'use client'

// Dashboard Overview · standing intents at a glance: running jobs, recurring
// buys, and guardian protections — the money that moves while the user is
// away. Same live source as the chat rail's Jobs tab (lib/use-running-work),
// so the counts can't drift from what the rail shows. Hidden entirely when
// nothing is armed — the onboarding checklist owns the empty-state story.

import Link from 'next/link'
import { CalendarClock, ListChecks, ShieldCheck } from 'lucide-react'
import { Card } from '@/lib/dashboard-ui'
import { LIVE_JOB_STATUS, useRunningWork } from '@/lib/use-running-work'

export default function StandingSummaryCard() {
  const { jobs, schedules, guards, loaded } = useRunningWork(true, 60_000)
  if (!loaded) return null

  const liveJobs = jobs.filter((j) => LIVE_JOB_STATUS.has(j.status))
  const watching = guards.filter((g) => g.status === 'active')
  if (liveJobs.length === 0 && schedules.length === 0 && guards.length === 0) return null

  const items = [
    {
      icon: ListChecks,
      label: `${liveJobs.length} running job${liveJobs.length === 1 ? '' : 's'}`,
      show: liveJobs.length > 0,
      href: '/chat',
      cta: 'Open the rail',
    },
    {
      icon: CalendarClock,
      label: `${schedules.length} recurring buy${schedules.length === 1 ? '' : 's'}`,
      show: schedules.length > 0,
      href: '/chat',
      cta: 'Open the rail',
    },
    {
      icon: ShieldCheck,
      label: `${watching.length}/${guards.length} protection${guards.length === 1 ? '' : 's'} watching`,
      show: guards.length > 0,
      href: '/dashboard/guardian',
      cta: 'Guardian',
    },
  ].filter((i) => i.show)

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Standing intents</p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            Working between your visits — every buy and close still signs from your wallet or your
            delegated guardian key.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {items.map((i) => (
            <Link
              key={i.label}
              href={i.href}
              className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)] hover:text-white transition-colors"
              title={i.cta}
            >
              <i.icon className="w-3.5 h-3.5 text-[color:var(--accent)]" /> {i.label}
            </Link>
          ))}
        </div>
      </div>
    </Card>
  )
}
