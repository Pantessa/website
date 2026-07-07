'use client'

// Dashboard · Plan — the in-app view of the business model: what plan this
// wallet is on, how many YEET credits this month has spent, and the upgrade
// path. The external twin is /pricing (same lib/plans.ts config).

import PlanPanel from '@/components/PlanPanel'

export default function DashboardPlanPage() {
  return (
    <>
      <h1 className="dash__h1">Plan &amp; usage</h1>
      <p className="dash__sub">
        Plans meter <strong className="text-white font-medium">YEET credits</strong> — one credit is one
        house-model answer. On-chain and paid-MCP calls never spend credits; they settle
        pay-per-call from your wallet with receipts, same as always.
      </p>
      <PlanPanel />
    </>
  )
}
