'use client'

// Creator earnings strip + the USDC claim button. Shown as soon as a link
// has MOVED money — not only once earnings clear a cent. A creator whose
// first conversion took a fee-free route needs the accounting, not a
// missing panel. Extracted from /dashboard/links.
//
// The money reads as figures (earned / claimable / claimed, then the
// lifetime rail), not a sentence: the studio lays this bar across its full
// width, where the old inline strip ran as one long line of text.

import { useState, type ReactNode } from 'react'
import { formatEarnedUsd } from '@/lib/fees'
import type { Earnings } from '@/lib/intent-links-ui'
import { notifyLinksChanged } from '@/lib/links-changed'

function Figure({ label, value, tone = 'fg', note }: { label: string; value: string; tone?: 'accent' | 'fg' | 'muted'; note?: ReactNode }) {
  const ink = tone === 'accent' ? 'text-[color:var(--accent)]' : tone === 'muted' ? 'text-[color:var(--muted)]' : 'text-[color:var(--fg)]'
  return (
    <div className="min-w-0">
      <dt className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">{label}</dt>
      <dd className={`mt-1.5 mono text-[20px] leading-none tabular-nums ${ink}`}>{value}</dd>
      {note && <dd className="mt-1.5 max-w-[300px] text-[12px] leading-snug text-[color:var(--muted)]">{note}</dd>}
    </div>
  )
}

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
  const claimsOpen = earnings.claimableUsd >= earnings.minClaimUsd
  const referred = earnings.referredWallets ?? 0

  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4 sm:px-5${className ? ` ${className}` : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
        <dl className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <Figure label="Earned" value={formatEarnedUsd(earnings.totalEarnedUsd)} tone="accent" />
          <Figure label="Claimable" value={formatEarnedUsd(earnings.claimableUsd)} />
          <Figure label="Claimed" value={`$${earnings.claimedUsd.toFixed(2)}`} tone="muted" />
          {referred > 0 && (
            <Figure
              label="Lifetime rail"
              value={`${referred} wallet${referred === 1 ? '' : 's'}`}
              note={
                <>
                  your links brought · earned{' '}
                  <span className="mono text-[color:var(--accent)]">{formatEarnedUsd(earnings.referredEarnedUsd ?? 0)}</span> on
                  their later trades
                </>
              }
            />
          )}
        </dl>
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button"
            disabled={!claimsOpen}
            onClick={() =>
              void fetch('/api/intent-links/claims', { method: 'POST' })
                .then(async (r) => {
                  const d = (await r.json().catch(() => ({}))) as { error?: string; amountUsd?: number; note?: string }
                  if (d.error) setClaimMsg(d.error)
                  else if (typeof d.amountUsd === 'number') setClaimMsg(`Claim filed for $${d.amountUsd.toFixed(2)}${d.note ? ` — ${d.note}` : ''}`)
                  else setClaimMsg(r.ok ? 'Claim filed.' : 'The claim didn’t go through — try again in a moment.')
                  notifyLinksChanged()
                  onClaimed?.()
                })
                // A network failure used to reject unhandled: no message, a
                // button that looked ignored. Say so instead.
                .catch(() => setClaimMsg('Could not reach the claims desk — check your connection and try again.'))
            }
            className="btn btn--solid text-[12px] disabled:opacity-50"
            title={claimsOpen ? 'Claim as USDC on Base' : `Claims open at $${earnings.minClaimUsd}`}
          >
            Claim USDC
          </button>
          {/* A greyed button with the reason only in a tooltip read as broken. */}
          {!claimsOpen && (
            <span className="mono text-[10.5px] text-[color:var(--muted-2)]">claims open at ${earnings.minClaimUsd}</span>
          )}
        </div>
      </div>
      {claimMsg && <p className="mt-3 text-[12px] text-[color:var(--muted-2)]">{claimMsg}</p>}
      {/* The out-earn instrument: one week here vs the same week's ref-code
          payout. Shown once any recent week carried money — a creator
          deciding whether to keep posting reads cadence, not lifetime. */}
      {(earnings.weekly?.some((w) => w.signedUsd > 0) ?? false) && (
        <div className="mt-4 pt-3 border-t border-[var(--line)] flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[12px] text-[color:var(--muted)]">
          <span className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)]">
            By week · vs your ref codes
          </span>
          {earnings.weekly!.map((w) => (
            <span key={w.weekStart} className="whitespace-nowrap">
              <span className="mono text-[color:var(--muted-2)]">wk {w.weekStart.slice(5)}</span>{' '}
              <span className="mono text-[color:var(--accent)]">{formatEarnedUsd(w.earnedUsd)}</span>
              <span className="text-[color:var(--muted-2)]"> · ${Math.round(w.signedUsd)} moved</span>
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 max-w-[900px] text-[11px] leading-relaxed text-[color:var(--muted-2)]">
        Half of Pantessa&apos;s venue fee on swaps and stock buys — from your links, and from
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
      </p>
    </div>
  )
}
