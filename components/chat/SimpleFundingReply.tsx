'use client'

// /i (simple mode) rendering of the funding-offer turn — "We can make this
// happen." leads, the PLAN follows in one readable paragraph, and the
// wallet's balances (the part that filled a phone screen) sit behind one
// tap with their total in the label. The chips below stay the thing to
// press. Words are the route's own (lib/simple-reply splitFundingOfferReply).

import { useState } from 'react'
import { ChevronDown, Wallet } from 'lucide-react'
import type { FundingOfferSplit } from '@/lib/simple-reply'

export default function SimpleFundingReply({ split }: { split: FundingOfferSplit }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-simple-funding>
      <p className="text-[18px] leading-snug text-[color:var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        {split.headline}
      </p>
      {split.before && <p className="mt-2 text-[15px] leading-[1.55] text-[color:var(--chat-fg,var(--fg))]">{split.before}</p>}
      <p className="mt-2 text-[15px] leading-[1.55] text-[color:var(--chat-fg,var(--fg))]">{split.after}</p>
      <button
        type="button"
        data-holdings-fold
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-3 flex w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3 py-2.5 text-left text-[13px] text-[color:var(--muted)] hover:border-[var(--line-2)] hover:text-[color:var(--fg)] transition-colors"
      >
        <Wallet className="w-4 h-4 flex-shrink-0 text-[color:var(--accent)]" />
        <span className="min-w-0 flex-1 truncate text-[color:var(--fg)]">{split.holdingsLabel}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-[color:var(--muted-2)] transition-transform${open ? ' rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {split.holdings.map((h, i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 text-[13px] bg-[color-mix(in_srgb,var(--surf-1)_55%,transparent)]"
            >
              {h.token ? (
                <>
                  <span className="min-w-0 truncate text-[color:var(--fg)]">
                    {h.token} <span className="text-[color:var(--muted-2)]">· {h.chain}</span>
                  </span>
                  <span className="mono flex-shrink-0 text-[color:var(--muted)]">{h.usd}</span>
                </>
              ) : (
                <span className="text-[color:var(--muted)]">{h.raw}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
