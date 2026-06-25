'use client'

// A zero-cost "see what a paid call looks like" demo for the chat empty state.
// It reveals a realistic but SIMULATED settled receipt — no wallet, no payment,
// no network call, clearly labeled a demo. Lets a brand-new visitor understand
// the pay-per-call + receipt model in one click before funding anything.

import { useState } from 'react'
import { CheckCircle2, Play, ExternalLink } from 'lucide-react'

export default function SampleCallDemo() {
  const [shown, setShown] = useState(false)

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 max-lg:min-h-10 rounded-lg border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white transition-colors"
      >
        <Play className="w-3.5 h-3.5" />
        See a sample paid call (demo)
      </button>
    )
  }

  return (
    <div className="mt-4 w-full max-w-md text-left rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="mono text-[10px] uppercase tracking-wider text-amber-400 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5">
          Demo · simulated
        </span>
        <span className="mono text-[10px] text-[color:var(--muted-2)]">no USDC moved</span>
      </div>

      <p className="text-xs text-[color:var(--muted)]">
        <span className="text-[color:var(--muted-2)]">You ask:</span> What&apos;s the current price of
        ETH?
      </p>
      <p className="text-xs text-white mt-2 leading-relaxed">
        ETH is trading around <span className="font-medium">$3,480</span>, up ~2.1% on the day. Routed
        to the cheapest proven source and paid per call.
      </p>

      {/* Mirrors the real MessageReceipts footnote shape. */}
      <div className="mt-2.5 pt-2 border-t border-[var(--line)] space-y-1">
        <div className="text-[11px] mono text-[color:var(--muted)]">💸 $0.0050 over 1 x402 call</div>
        <div className="flex items-center gap-2 text-[11px] mono text-[color:var(--muted-2)] min-w-0">
          <span className="text-emerald-400">✓</span>
          <span className="text-[color:var(--muted)] truncate">Yeetful · Claude</span>
          <span className="flex-shrink-0">$0.0050</span>
          <span className="flex-shrink-0 inline-flex items-center gap-0.5 opacity-70" title="A real call links to Basescan here">
            0x8af8…2983 <ExternalLink className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] text-[color:var(--muted-2)] flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        That&apos;s a real call&apos;s receipt — connect a wallet and ask anything to make it yours.
      </p>
    </div>
  )
}
