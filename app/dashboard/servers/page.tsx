'use client'

// Dashboard › Servers — the same x402 agent directory as the marketing home,
// minus the hero. Add agents to the runner, open a detail page, then jump to
// chat via the floating ActiveServerBar. Lives inside the dashboard shell so
// signed-in users browse + select without leaving the app.

import ServerDirectory from '@/components/ServerDirectory'
import ActiveServerBar from '@/components/ActiveServerBar'

export default function DashboardServersPage() {
  return (
    <>
      <h1 className="dash__h1">Servers</h1>
      <p className="dash__sub">
        Browse x402 agents, add them to your runner, then start a chat — they pay per call from your
        expense account.
      </p>

      <ServerDirectory />
      <ActiveServerBar />
    </>
  )
}
