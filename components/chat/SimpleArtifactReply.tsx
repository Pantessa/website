'use client'

// /i (simple mode) rendering of an artifact-bearing reply: the human line
// first — "Swap 20 USDC → ~0.0105 ETH · on Base · fee 0.5% · your wallet
// signs" — then the router/pool/slippage sentences behind a quiet details
// disclosure. The card below stays the one thing to press.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SimpleReplySplit } from '@/lib/simple-reply'

export default function SimpleArtifactReply({ split }: { split: SimpleReplySplit }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-simple-reply>
      <p className="text-[15px] leading-snug text-[color:var(--fg)]">{split.lead}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-1.5 inline-flex items-center gap-1 mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform${open ? ' rotate-180' : ''}`} />
        {open ? 'Hide details' : 'Details — venue, pool, slippage'}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-[color:var(--muted)]">
          {split.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
