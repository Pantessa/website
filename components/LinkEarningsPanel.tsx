'use client'

// Creator earnings strip + the USDC claim button. Shown as soon as a link
// has MOVED money — not only once earnings clear a cent. A creator whose
// first conversion took a fee-free route needs the accounting, not a
// missing panel. Extracted from /dashboard/links.

import { useState } from 'react'
import { formatEarnedUsd } from '@/lib/fees'
import type { Earnings } from '@/lib/intent-links-ui'

export function LinkEarningsPanel({
  earnings,
  onClaimed,
  className,
}: {
  earnings: Earnings
  onClaimed?: () => void
  className?: string
}) {
  const [claimMsg, setClaimMsg] = useState<string | null>(null)

  return (
    <div
      className={`rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2${className ? ` ${className}` : ''}`}
    >
      <span className="text-[13px] text-[color:var(--muted)]">
        Earned <span className="mono text-[color:var(--accent)]">{formatEarnedUsd(earnings.totalEarnedUsd)}</span>
        {' · '}claimed <span className="mono">${earnings.claimedUsd.toFixed(2)}</span>
        {' · '}claimable <span className="mono text-[color:var(--fg)]">{formatEarnedUsd(earnings.claimableUsd)}</span>
      </span>
      <button
        type="button"
        disabled={earnings.claimableUsd < earnings.minClaimUsd}
        onClick={() =>
          void fetch('/api/intent-links/claims', { method: 'POST' })
            .then((r) => r.json())
            .then((d: { error?: string; amountUsd?: number; note?: string }) => {
              setClaimMsg(d.error ?? `Claim filed for $${d.amountUsd?.toFixed(2)} — ${d.note ?? ''}`)
              onClaimed?.()
            })
        }
        className="btn btn--solid text-[12px] disabled:opacity-50"
        title={earnings.claimableUsd < earnings.minClaimUsd ? `Claims open at $${earnings.minClaimUsd}` : 'Claim as USDC on Base'}
      >
        Claim USDC
      </button>
      {claimMsg && <span className="text-[12px] text-[color:var(--muted-2)]">{claimMsg}</span>}
      {(earnings.referredWallets ?? 0) > 0 && (
        <span className="text-[12px] text-[color:var(--muted)]">
          Lifetime rail: <span className="mono text-[color:var(--fg)]">{earnings.referredWallets}</span> wallet
          {earnings.referredWallets === 1 ? '' : 's'} your links brought
          {' · '}earned <span className="mono text-[color:var(--accent)]">{formatEarnedUsd(earnings.referredEarnedUsd ?? 0)}</span> on
          their later trades
        </span>
      )}
      <span className="text-[11px] text-[color:var(--muted-2)] w-full">
        Half of Yeetful&apos;s venue fee on swaps and stock buys — from your links, and from
        every later fee-bearing trade by wallets your links first brought (lifetime, first
        touch). Sales, transfers, stakes, and bridges are always fee-free. Paid as USDC on
        Base from ${earnings.minClaimUsd}.
        {/* The honest zero: money moved, none of it through a fee-bearing
            venue. Without this line the panel just reads $0.00. */}
        {earnings.totalSignedUsd > 0 && earnings.totalFeeBearingUsd <= 0 && (
          <>
            {' '}
            <span className="text-[color:var(--fg)]">
              Your ${earnings.totalSignedUsd.toFixed(2)} moved so far went through fee-free
              routes, so it earned nothing — a swap or stock buy is what pays.
            </span>
          </>
        )}
      </span>
    </div>
  )
}
