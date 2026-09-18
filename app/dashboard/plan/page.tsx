'use client'

// Dashboard · Plan & usage — the in-app view of the business model (pricing
// v2): where this wallet's house answers come from, and the bring-your-own
// API key setting. The external twin is /pricing (same lib/plans.ts config).

import PlanPanel from '@/components/PlanPanel'

export default function DashboardPlanPage() {
  return (
    <>
      <h1 className="dash__h1">Plan &amp; usage</h1>
      <p className="dash__sub">
        Looking and trading are free of any plan. The one thing with a meter is the{' '}
        <strong className="text-[color:var(--fg)] font-medium">house model</strong>: a few answers are free every day,
        every trade you sign earns more, and your own API key makes them unlimited.
      </p>
      <PlanPanel />
    </>
  )
}
