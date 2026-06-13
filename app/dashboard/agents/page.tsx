'use client'

// Dashboard · Agents — the spender side of the control plane. Approvals
// answers "which services may my account PAY"; this page answers "which apps
// may SPEND on my behalf, and how much per day". An agent is an app connected
// through the yeetful SDK, authenticated by one of your API keys.

import Link from 'next/link'
import AgentsPanel from '@/components/AgentsPanel'
import { useOrgStore } from '@/lib/org-store'

export default function DashboardAgentsPage() {
  const { activeOrgId } = useOrgStore()
  return (
    <>
      <h1 className="dash__h1">Agents</h1>
      <p className="dash__sub">
        Apps connected through the <span className="mono">yeetful</span> SDK. Each holds one of
        {activeOrgId ? " the org's " : ' your '}
        <Link href="/dashboard/keys" className="underline underline-offset-2 decoration-dotted">API keys</Link>,
        syncs its receipts here, and gets a daily budget — separate from the per-service{' '}
        <Link href="/dashboard/approvals" className="underline underline-offset-2 decoration-dotted">approvals</Link>,
        which control where the money may go.
      </p>
      <AgentsPanel orgId={activeOrgId} />
    </>
  )
}
