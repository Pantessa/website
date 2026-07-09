'use client'

// Overview · slim embeds pointer — key management (mint/revoke, install
// prompt, site roster) lives on /dashboard/keys with the API keys, one Keys
// page for both credential types. This card keeps the pivot onboarding pitch
// until a first embed key exists, then collapses to at-a-glance numbers.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Globe } from 'lucide-react'
import { Card, CardTitle, SkeletonCard } from '@/lib/dashboard-ui'

interface EmbedKeyRow {
  id: string
  sites: { turns: number }[]
}

export default function EmbedsSummaryCard() {
  const [keys, setKeys] = useState<EmbedKeyRow[] | null>(null)

  useEffect(() => {
    void fetch('/api/embed-keys', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((d: { keys?: EmbedKeyRow[] }) => setKeys(d.keys ?? []))
      .catch(() => setKeys([]))
  }, [])

  if (!keys) return <SkeletonCard className="mb-6" />

  // No key yet → the onboarding pitch, minting now happens on the Keys page.
  if (keys.length === 0) {
    return (
      <Card className="mb-6">
        <CardTitle serif eyebrow="EMBED YEETFUL — THE 2-MINUTE INSTALL">
          One agent on your site
        </CardTitle>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[color:var(--muted)] max-w-[70ch]">
          Put the full Yeetful chat — compose MCPs, guardrails, receipts, signing with the
          visitor&rsquo;s own wallet — on any site. Create a{' '}
          <strong className="text-white font-medium">public embed key</strong> (safe in page
          source), paste one prompt into Claude, and your embeds report back here.
        </p>
        <div className="mt-4">
          <Link href="/dashboard/keys#embed-keys" className="btn btn--solid">
            Create your embed key
          </Link>
        </div>
      </Card>
    )
  }

  const sites = keys.flatMap((k) => k.sites)
  const turns = sites.reduce((n, s) => n + s.turns, 0)
  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap min-w-0">
        <span className="flex items-center gap-2.5 min-w-0">
          <Globe className="w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)]" />
          <span className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">Embedded chat</p>
            <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
              {keys.length} key{keys.length === 1 ? '' : 's'} · {sites.length} site
              {sites.length === 1 ? '' : 's'} · {turns} turn{turns === 1 ? '' : 's'}
            </p>
          </span>
        </span>
        <span className="flex items-center gap-4 flex-shrink-0">
          <Link
            href="/dashboard/keys#embed-keys"
            className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2"
          >
            Manage keys →
          </Link>
          <Link
            href="/dashboard/embeds"
            className="mono text-[12px] text-[color:var(--accent)] hover:underline underline-offset-2"
          >
            Analytics →
          </Link>
        </span>
      </div>
    </Card>
  )
}
