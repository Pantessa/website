'use client'

// Dashboard · API Keys — BOTH credential types on one page (Stripe's
// secret/publishable split), embed keys FIRST (they're the front door):
//   · Publishable embed keys (`yfe_`) — put the Pantessa agent on your own
//     site. Attribution-only identifiers that live in host page source and
//     bill embed usage to this account. No read/spend authority by design.
//   · Secret API keys (`yf_`) — Bearer credentials for headless agents on
//     the grants API: their x402 payments run under your spend policy and
//     every receipt syncs to your ledger. Secret shows once (server stores
//     only its hash). Never in a browser.
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

  // The #embed-keys anchor target mounts client-side (behind a skeleton), so
  // the browser's own anchor scroll can land before it exists. Re-run the
  // scroll a few times while the panel streams in, then leave the user alone.
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
      <h1 className="dash__h1">API Keys</h1>
      <p className="dash__sub">
        Two kinds of keys, two different jobs. <strong className="text-white font-medium">Embed
        keys</strong> (<code>yfe_…</code>) put the Pantessa agent on your website — publishable, safe
        to ship in page source. <strong className="text-white font-medium">Secret API keys</strong>{' '}
        (<code>yf_…</code>) are for headless agents — they track your agents&apos; x402 payment
        usage and put it under your spend policy. Never expose a secret key in a browser.
        {activeOrgId ? ' API keys minted here are the org’s shared credentials (admin only).' : ''}
      </p>

      {/* Embed keys lead — they're the front door. Wallet-owned (no org
          scope) — same rule as Overview. */}
      {!activeOrgId && (
        <div id="embed-keys" className="scroll-mt-24 mb-8">
          <SectionHeading>Embed keys · yfe_ · put the agent on your site</SectionHeading>
          <EmbedsPanel />
        </div>
      )}

      <SectionHeading>Secret API keys · yf_ · track your agents&apos; x402 payments</SectionHeading>
      <ApiKeysPanel onKeysChange={setKeyCount} orgId={activeOrgId} />
      <ConnectAgentCard
        grantId={grantId}
        hasKeys={keyCount > 0}
        ledgerUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
      />
    </>
  )
}
