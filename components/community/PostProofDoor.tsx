'use client'

// "Post it with proof" — the receipt's one quiet door into the community
// (squad community, lane SHARE, 2026-11-09).
//
// It sits beside the receipt's share button, right after a signed transaction
// settles, and opens the composer on the trade tab (/community?compose=trade),
// where the wallet's confirmed transactions are listed and the one just made
// is pre-picked. It renders ONLY when the turn built a same-chain swap and the
// receipt holds its mined transaction hash on a chain the proof reader can
// read (feed-rules proofDoorHref): never for a Hyperliquid order, a CoW
// order, a send, a deposit, a bridge or a cross-chain swap (the proof reader
// takes only a transaction that swapped one asset for another). The label promises what the proof gives: the post says what
// the chain confirmed, and nothing typed sits beside that.
//
// Inside a chat the door opens a new tab, so the thread it sits in is never
// unmounted mid-flow. /community is a public page, so this is a plain link.

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PROOF_DOOR_LABEL, PROOF_DOOR_TITLE } from './feed-rules'

export default function PostProofDoor({
  href,
  newTab = true,
  className,
}: {
  /** feed-rules proofDoorHref (a chat turn) or jobProofDoorHref (a done job): null = no door. */
  href: string | null
  /** true (the default) inside a chat or a job card: the flow underneath stays mounted. */
  newTab?: boolean
  className?: string
}) {
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
