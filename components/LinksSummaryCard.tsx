'use client'

// Dashboard Overview · the links-first headline card: your link economy at a
// glance — links live, opens, conversions, dollars moved, and what you've
// earned (half the 0.20% fee on fee-bearing conversions). Reads the same
// owner API as /dashboard/links, so the numbers can't drift. Fail-soft: any
// fetch problem renders the mint door alone rather than an error.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Link2, Plus } from 'lucide-react'
import { Card } from '@/lib/dashboard-ui'

interface LinksApi {
  links: {
    revoked: boolean
    funnel: { open: number; connect: number; built: number; signed: number }
    signedUsd: number
    signsCount: number
  }[]
  earnings: { totalEarnedUsd: number; claimedUsd: number; claimableUsd: number; minClaimUsd: number }
}

const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)

export default function LinksSummaryCard() {
  const [data, setData] = useState<LinksApi | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/intent-links', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: LinksApi) => setData(d))
      .catch(() => setFailed(true))
  }, [])

  // Hold until settled — a flash of zeros reads as "you have nothing".
  if (!data && !failed) return null

  const live = data?.links.filter((l) => !l.revoked) ?? []
  const opens = live.reduce((s, l) => s + l.funnel.open, 0)
  const signs = live.reduce((s, l) => s + l.signsCount, 0)
  const movedUsd = live.reduce((s, l) => s + l.signedUsd, 0)
  const earned = data?.earnings

  return (
    <Card className="mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[color:var(--accent)]" /> Your intent links
          </p>
          <p className="text-xs text-[color:var(--muted-2)] mt-0.5">
            A sentence anyone can act on — you keep half of Yeetful&apos;s 0.20% fee on the
            conversions your links produce.{' '}
            <Link href="/dashboard/links" className="underline underline-offset-2 decoration-dotted hover:text-white">
              Open Intent links →
            </Link>
          </p>
        </div>
        <Link
          href={`/dashboard/links?ask=${encodeURIComponent('Buy $5 of AAPL')}`}
          className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 max-lg:min-h-11 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Mint a link
        </Link>
      </div>

      {(live.length > 0 || (earned && earned.totalEarnedUsd > 0)) && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              { label: 'Links live', value: String(live.length) },
              { label: 'Opens', value: String(opens) },
              { label: 'Conversions', value: String(signs) },
              { label: 'Moved', value: usd(movedUsd) },
              {
                label: 'Earned',
                value: usd(earned?.totalEarnedUsd ?? 0),
                sub:
                  earned && earned.claimableUsd > 0
                    ? earned.claimableUsd >= earned.minClaimUsd
                      ? `${usd(earned.claimableUsd)} claimable`
                      : `claims open at $${earned.minClaimUsd}`
                    : undefined,
              },
            ] as const
          ).map((s) => (
            <div key={s.label} className="min-w-0">
              <p className="mono text-[18px] tabular-nums text-white truncate">{s.value}</p>
              <p className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] mt-0.5">
                {s.label}
              </p>
              {'sub' in s && s.sub && (
                <p className="text-[10.5px] text-[color:var(--accent)] mt-0.5">{s.sub}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
