'use client'

// "Post it with proof" — the receipt's one quiet door into the community
// (squad community, lane SHARE, 2026-11-09).
//
// It sits beside the receipt's share button, right after a signed transaction
// settles, and opens the composer on the trade tab (/community?compose=trade),
// where the wallet's confirmed transactions are listed and the one just made
// is pre-picked. It renders ONLY when the receipt holds a mined transaction
// hash on a chain the proof reader can read (feed-rules proofDoorHref): never
// for a Hyperliquid order, an unsettled CoW order, or a job step with no
// transaction. The label promises what the proof gives: the post says what
// the chain confirmed, and nothing typed sits beside that.
//
// Inside a chat the door opens a new tab, so the thread it sits in is never
// unmounted mid-flow. /community is a public page, so this is a plain link.

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PROOF_DOOR_LABEL, PROOF_DOOR_TITLE, proofDoorHref } from './feed-rules'

export default function PostProofDoor({
  txs,
  newTab = true,
  className,
}: {
  /** The receipt's confirmed transactions (hash + chain id). */
  txs: readonly { hash?: unknown; chainId?: unknown }[] | null | undefined
  /** true (the default) inside a chat or a job card: the flow underneath stays mounted. */
  newTab?: boolean
  className?: string
}) {
  const href = proofDoorHref(txs)
  if (!href) return null
  const cls = cn(
    'inline-flex items-center text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] underline decoration-dotted underline-offset-2 transition-colors [@media(hover:none)]:min-h-9',
    className,
  )
  return newTab ? (
    <a href={href} target="_blank" rel="noopener" className={cls} title={PROOF_DOOR_TITLE} data-proof-door="" data-journey="Post it with proof" onClick={(e) => e.stopPropagation()}>
      {PROOF_DOOR_LABEL}
    </a>
  ) : (
    <Link href={href} className={cls} title={PROOF_DOOR_TITLE} data-proof-door="" data-journey="Post it with proof" onClick={(e) => e.stopPropagation()}>
      {PROOF_DOOR_LABEL}
    </Link>
  )
}
