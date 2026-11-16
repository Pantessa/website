// Dashboard · Growth · Outreach — the desk Nate messages scanned accounts from (admin-only).
// The data is admin-gated server-side (GET /api/admin/outreach); the dashboard layout sends a
// signed-out visitor home. Nothing on this page sends a message.
import type { Metadata } from 'next'
import OutreachDesk from '@/components/admin/outreach/OutreachDesk'

export const metadata: Metadata = { title: 'Outreach', robots: { index: false, follow: false } }

export default function OutreachPage() {
  return <OutreachDesk />
}
