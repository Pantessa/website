// /dashboard/desk/[id] — one governed desk: Policy · Desks · Keys · Approvals ·
// Blotter · Statement · Settings (squad five-million, CONSOLE lane,
// 2026-11-03). The server reads the contract's vocabulary and hands it down;
// the client reads GET /api/tenants/:id, which answers 404 for a wallet that
// is not one of the tenant's admins (the same answer as no tenant).
import type { Metadata } from 'next'
import TenantConsole from '@/components/desk/TenantConsole'
import { deskVocab } from '@/components/desk/vocab.server'

export const metadata: Metadata = {
  title: 'Tenant · Desk console · Pantessa',
  robots: { index: false, follow: false },
}

export default async function TenantConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TenantConsole tenantId={id} vocab={deskVocab()} />
}
