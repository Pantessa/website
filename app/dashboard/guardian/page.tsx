'use client'

// Dashboard · Guardian — autonomy without custody. Approve a scoped agent
// key on your Hyperliquid account (trade-only; the venue bars withdrawals),
// arm stop-loss / take-profit policies, and every action the loop takes is
// deterministic-built, guard-checked, and receipted below.

import GuardianPanel from '@/components/GuardianPanel'

export default function DashboardGuardianPage() {
  return (
    <>
      <h1 className="dash__h1">Guardian</h1>
      <p className="dash__sub">
        Give your agent a job, not your keys. The guardian watches your Hyperliquid positions around the clock and
        closes them when your rules say so — through the same deterministic build + guardrail gate as every Yeetful
        transaction, with a receipt for every decision. Your wallet keeps custody; the delegation expires on its own
        and revokes in one click.
      </p>
      <GuardianPanel />
    </>
  )
}
