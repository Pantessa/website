'use client'

// Home-page tie-in for /activity: two live network numbers appended to the
// directory stat bar, sourced from the SAME /api/activity payload the
// activity page uses (one query path, CDN-cached). Renders nothing until
// data arrives — the bar must not jump or show zeros while loading.

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function NetworkPulse() {
  const [stats, setStats] = useState<{ settledUsd: number; settledCalls: number } | null>(null)

  useEffect(() => {
    void fetch('/api/activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.stats && setStats(d.stats))
      .catch(() => {})
  }, [])

  if (!stats || stats.settledCalls === 0) return null

  return (
    <>
      <span className="dir__sep">/</span>
      <Link
        href="/activity"
        className="dir__stat group max-lg:min-h-10 max-lg:!items-center"
        title="View all network activity"
      >
        <span className="dir__statnum mono">${stats.settledUsd.toFixed(2)}</span>
        <span className="dir__statlbl group-hover:text-white transition-colors">
          settled on-network →
        </span>
      </Link>
    </>
  )
}
