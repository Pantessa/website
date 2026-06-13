'use client'

// Dashboard · API Keys — the directly-linkable key page: mint/list/revoke
// plus the connect-an-agent snippet once a key and grant exist.

import { useEffect, useState } from 'react'
import ApiKeysPanel from '@/components/ApiKeysPanel'
import ConnectAgentCard from '@/components/ConnectAgentCard'
import { useOrgStore } from '@/lib/org-store'
import type { Stats } from '@/lib/dashboard-ui'

export default function DashboardKeysPage() {
  const { activeOrgId } = useOrgStore()
  const [keyCount, setKeyCount] = useState(0)
  const [grantId, setGrantId] = useState<string | null>(null)

  useEffect(() => {
    void fetch(`/api/dashboard/stats${activeOrgId ? `?org=${activeOrgId}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Stats | null) => setGrantId(s?.grant?.id ?? null))
  }, [activeOrgId])

  return (
    <>
      <h1 className="dash__h1">API Keys</h1>
      <p className="dash__sub">
        Bearer credentials for headless agents — the SDK uses one to sync receipts into this
        dashboard. The secret shows once at mint.
        {activeOrgId ? ' Keys minted here are the org’s shared credentials (admin only).' : ''}
      </p>
      <ApiKeysPanel onKeysChange={setKeyCount} orgId={activeOrgId} />
      <ConnectAgentCard
        grantId={grantId}
        hasKeys={keyCount > 0}
        ledgerUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
      />
    </>
  )
}
