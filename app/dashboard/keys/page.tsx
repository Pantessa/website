'use client'

// Dashboard · Keys — BOTH credential types on one page (Stripe's
// secret/publishable split):
//   · Secret API keys (`yf_`) — Bearer credentials for headless agents; the
//     secret shows once, the server stores only its hash. Never in a browser.
//   · Publishable embed keys (`yfe_`) — attribution-only identifiers that live
//     in host page source and bill embed usage to this account. No read/spend
//     authority by design.
// Embed keys belong to a wallet, so the embed section hides in org scope.

import { useEffect, useState } from 'react'
import ApiKeysPanel from '@/components/ApiKeysPanel'
import ConnectAgentCard from '@/components/ConnectAgentCard'
import EmbedsPanel from '@/components/EmbedsPanel'
import { useOrgStore } from '@/lib/org-store'
import type { Stats } from '@/lib/dashboard-ui'

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
      {children}
    </h2>
  )
}

export default function DashboardKeysPage() {
  const { activeOrgId } = useOrgStore()
  const [keyCount, setKeyCount] = useState(0)
  const [grantId, setGrantId] = useState<string | null>(null)

  useEffect(() => {
    void fetch(`/api/dashboard/stats${activeOrgId ? `?org=${activeOrgId}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Stats | null) => setGrantId(s?.grant?.id ?? null))
  }, [activeOrgId])

  // The #embed-keys anchor target sits below panels that mount async, so the
  // browser's own anchor scroll lands short. Re-run the scroll a few times
  // while the panels above stream in (~1.5s), then leave the user alone.
  useEffect(() => {
    if (window.location.hash !== '#embed-keys') return
    let runs = 0
    const t = setInterval(() => {
      document.getElementById('embed-keys')?.scrollIntoView({ block: 'start' })
      if (++runs >= 6) clearInterval(t)
    }, 250)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <h1 className="dash__h1">Keys</h1>
      <p className="dash__sub">
        Two kinds, opposite power levels. <strong className="text-white font-medium">Secret API
        keys</strong> (<code>yf_…</code>) authenticate your headless agents — never expose one in a
        browser. <strong className="text-white font-medium">Publishable embed keys</strong>{' '}
        (<code>yfe_…</code>) are safe in page source — they only attribute embedded-chat usage to
        your account.
        {activeOrgId ? ' API keys minted here are the org’s shared credentials (admin only).' : ''}
      </p>

      <SectionHeading>Secret API keys · yf_ · for agents &amp; servers</SectionHeading>
      <ApiKeysPanel onKeysChange={setKeyCount} orgId={activeOrgId} />
      <ConnectAgentCard
        grantId={grantId}
        hasKeys={keyCount > 0}
        ledgerUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
      />

      {/* Embed keys are wallet-owned (no org scope) — same rule as Overview. */}
      {!activeOrgId && (
        <div id="embed-keys" className="scroll-mt-24 mt-8">
          <SectionHeading>Publishable embed keys · yfe_ · for your website</SectionHeading>
          <EmbedsPanel />
        </div>
      )}
    </>
  )
}
