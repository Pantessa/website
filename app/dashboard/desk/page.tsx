// /dashboard/desk — the desk console: the tenants this wallet owns or
// administers, and the door to create one (squad five-million, CONSOLE lane,
// 2026-11-03). A server page so the contract's vocabulary (lib/tenant/spec,
// which imports node:crypto) is read here and handed to the client as plain
// props; the dashboard layout is the SIWE gate (a signed-out visitor is sent
// home), and every number on the page comes from GET /api/tenants.
import type { Metadata } from 'next'
import DeskList from '@/components/desk/DeskList'
import { deskVocab } from '@/components/desk/vocab.server'

export const metadata: Metadata = {
  title: 'Desk console · Pantessa',
  description: 'Run a governed desk: tenants, the default-deny policy, desk keys, approvals, the hash-chained blotter and the monthly statement.',
  robots: { index: false, follow: false },
}

export default function DeskConsolePage() {
  return (
    <>
      <h1 className="dash__h1">Desk console</h1>
      <p className="dash__sub">
        Your governed desks. Compliance writes the policy, a second admin approves it, agents trade with scoped desk keys,
        and every event lands on a blotter you can verify and export.
      </p>
      <DeskList vocab={deskVocab()} />
    </>
  )
}
