'use client'

// Dashboard · Embeds — the embed owner's analytics: asks, outcomes,
// transactions (with chain + explorer links), dead-end sessions, and the
// "upgrade your MCP" work order. Data: GET /api/embeds/insights.
// Key management (mint/revoke + install prompt) lives on /dashboard/keys.

import Link from 'next/link'
import EmbedInsights from '@/components/EmbedInsights'

export default function DashboardEmbedsPage() {
  return (
    <>
      <h1 className="dash__h1">Embeds</h1>
      <p className="dash__sub">
        Every keyed embed reports its turns here — what visitors asked, what the agent built, what
        got signed. <strong className="text-white font-medium">Dead-end conversations</strong> are
        the improvement backlog: the visitor&rsquo;s goal is a transaction, and every session that
        didn&rsquo;t reach one tells you exactly what to fix. Embed keys and the install prompt live
        in{' '}
        <Link href="/dashboard/keys#embed-keys" className="underline underline-offset-2 decoration-dotted hover:text-white">
          Keys
        </Link>
        .
      </p>
      <EmbedInsights />
    </>
  )
}
