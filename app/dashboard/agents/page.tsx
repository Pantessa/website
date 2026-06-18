'use client'

// Dashboard · Agents — the spender side of the control plane. Approvals
// answers "which services may my account PAY"; this page answers "which apps
// may SPEND on my behalf, and how much per day". An agent is an app connected
// through the yeetful SDK, authenticated by one of your API keys.

import Link from 'next/link'
import AgentsPanel from '@/components/AgentsPanel'
import MyServersPanel from '@/components/MyServersPanel'
import { useOrgStore } from '@/lib/org-store'

export default function DashboardAgentsPage() {
  const { activeOrgId } = useOrgStore()
  return (
    <>
      <h1 className="dash__h1">Agents</h1>
      <p className="dash__sub">
        The two sides of your account: <strong className="text-white font-medium">Payers</strong> are apps
        connected through the <span className="mono">yeetful</span> SDK that spend{activeOrgId ? " the org's " : ' your '}
        funds; <strong className="text-white font-medium">Payees</strong> are the MCP servers you operate and
        collect on. Budgets are set here; where money may go is governed by{' '}
        <Link href="/dashboard/approvals" className="underline underline-offset-2 decoration-dotted">approvals</Link>.
      </p>

      {/* Two-sided ledger: payers (spenders) | payees (claimed servers).
          Single column on small screens; min-w-0 so the grid tracks shrink
          instead of sizing to max-content. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 min-w-0">
        <section className="min-w-0">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
            Payers · your agents
          </h2>
          <AgentsPanel orgId={activeOrgId} />
        </section>
        <section className="min-w-0">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
            Payees · your MCP servers
          </h2>
          <MyServersPanel />
        </section>
      </div>
    </>
  )
}
